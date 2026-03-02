const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { buildSystemPrompt } = require('../utils/sbParsers');
const { parseDescriptionInput } = require('../utils/parseDescription');
const { mapUnitsToBets } = require('../utils/mapUnits');
const { pendingScans } = require('../utils/pendingScans');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bet')
        .setDescription('Bet commands')

        // AI-powered scan subcommand
        .addSubcommand(sub =>
            sub
                .setName('post')
                .setDescription('Scan a betslip screenshot with AI and auto-create bet entries')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Unit size(s) and optional note e.g. "Kam 1u 0.25u 0.15u" or "1 unit"')
                        .setRequired(true)
                )
                .addAttachmentOption(opt =>
                    opt.setName('screenshot')
                        .setDescription('Betslip screenshot')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('link')
                        .setDescription('Optional: Link to add to the bet')
                        .setRequired(false)
                )
        )

        // Manual entry subcommand (original post logic)
        .addSubcommand(sub =>
            sub
                .setName('manual')
                .setDescription('Manually enter a bet with all details')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Bet description')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('risk')
                        .setDescription('Risk (units)')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('sport')
                        .setDescription('Sport (NFL, NBA, etc.)')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('odds')
                        .setDescription('Odds (e.g., -110, +150)')
                        .setRequired(true)
                )
                .addAttachmentOption(opt =>
                    opt.setName('screenshot')
                        .setDescription('Optional: Screenshot of the bet')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('link')
                        .setDescription('Optional: Link to add to the bet')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'post') return handleScanCommand(interaction);
        if (sub === 'manual') return handlePostCommand(interaction);
    }
};

// ============================================================
// POST COMMAND - DIRECT SLASH COMMAND HANDLING
// ============================================================
async function handlePostCommand(interaction) {
    // Defer reply immediately to prevent double-clicks from executing twice
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const username = interaction.user.username;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const sport = interaction.options.getString('sport');
    const odds = interaction.options.getNumber('odds');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');
    const link = interaction.options.getString('link');

    // Validate inputs
    if (isNaN(risk) || isNaN(odds)) {
        return interaction.editReply({
            content: 'Risk and odds must be valid numbers.'
        });
    }

    const { calculatePayout } = require('../utils/calcPayout');
    const payout = calculatePayout(risk, odds);
    const id = randomUUID();
    const timestamp = Date.now();

    try {
        // Fetch auto-notify role for this channel
        const { rows } = await pool.query(
            `SELECT notify_role_id 
             FROM capper_info 
             WHERE channel_id = $1`,
            [interaction.channel.id]
        );

        const notifyRoleId = rows[0]?.notify_role_id;

        // Build message for the channel
        let message = '';
        if (notifyRoleId) {
            message += `<@&${notifyRoleId}>\n\n`;
        }
        message += `**${description}**\n`;
        message += `Risk: **${risk}u**\n\n`;

        // Build components
        const components = [];
        if (link) {
            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Link')
                    .setStyle(ButtonStyle.Link)
                    .setURL(link)
                    .setEmoji('🔗')
            );
            components.push(linkRow);
        }

        // Send message to channel FIRST (before inserting to DB)
        const files = screenshotAttachment ? [screenshotAttachment.url] : [];
        const sent = await interaction.channel.send({
            content: message,
            files,
            components,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
        });

        // Post to capper's private tracker channel SECOND (before inserting to DB)
        const trackerMessageId = await postBetToTrackerChannel(interaction.client, userId, id, description, risk, sport, odds, screenshotAttachment?.url, link);

        // Only INSERT into database AFTER both messages are successfully posted
        await pool.query(
            `INSERT INTO bets 
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
            [id, userId, username, description, sport, risk, odds, payout, timestamp, sent.id, sent.channel.id, trackerMessageId || null]
        );

        return interaction.editReply({
            content: '✅ Bet posted successfully!'
        });

    } catch (err) {
        console.error('Error posting bet:', err);
        
        // Send DM to admin about the failure
        try {
            const adminId = process.env.ADMIN_OVERRIDE_ID;
            if (adminId) {
                const admin = await interaction.client.users.fetch(adminId).catch(() => null);
                if (admin) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Bet Posting Failed')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'User', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                            { name: 'Bet Description', value: description, inline: false },
                            { name: 'Details', value: `Sport: ${sport}\nRisk: ${risk}u\nOdds: ${odds}`, inline: false },
                            { name: 'Error', value: `\`\`\`${err.message}\`\`\``, inline: false }
                        )
                        .setTimestamp();
                    
                    await admin.send({ embeds: [embed] }).catch(() => {});
                }
            }
        } catch (dmErr) {
            console.error('Failed to send error DM:', dmErr);
        }
        
        return interaction.editReply({
            content: 'Error saving your bet.'
        });
    }
}

// Post bet to tracker channel
async function postBetToTrackerChannel(client, userId, betId, description, risk, sport, odds, screenshotUrl, link) {
    try {
        const { rows } = await pool.query(
            `SELECT tracker_channel_id FROM capper_info WHERE user_id = $1`,
            [userId]
        );

        const trackerChannelId = rows[0]?.tracker_channel_id;
        if (!trackerChannelId) return;

        const trackerChannel = await client.channels.fetch(trackerChannelId);
        if (!trackerChannel) return;

        const { EmbedBuilder } = require('discord.js');
        const { calculatePayout } = require('../utils/calcPayout');

        // Build embed
        const payout = calculatePayout(risk, odds);
        const embed = new EmbedBuilder()
            .setTitle(description)
            .setColor(0x3498db)
            .addFields(
                { name: 'Sport', value: sport, inline: true },
                { name: 'Risk', value: `${risk}u`, inline: true },
                { name: 'Odds', value: odds.toString(), inline: true },
                { name: 'Payout', value: `${payout}u`, inline: true }
            )
            .setTimestamp();

        // Settle buttons (row 1)
        const settleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_tracker_win_${betId}`)
                .setLabel('Win')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_loss_${betId}`)
                .setLabel('Loss')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_push_${betId}`)
                .setLabel('Push')
                .setStyle(ButtonStyle.Secondary)
        );

        // Action buttons (row 2)
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_bet_${betId}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`delete_bet_${betId}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
        );

        const files = screenshotUrl ? [screenshotUrl] : [];
        const trackerMsg = await trackerChannel.send({
            embeds: [embed],
            components: [settleRow, actionRow],
            files
        });
        
        // Return tracker message ID
        return trackerMsg.id;
    } catch (err) {
        console.error('Error posting to tracker channel:', err);
    }
}

// ============================================================
// SCAN COMMAND - AI-POWERED BETSLIP PARSING
// ============================================================
async function handleScanCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const username = interaction.user.username;
    const descriptionText = interaction.options.getString('description');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');
    const link = interaction.options.getString('link');

    // ── 1. Fetch & base64 encode the screenshot ─────────────────
    let imageBase64;
    let imageMediaType = 'image/jpeg';
    try {
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');

        const fetchBuffer = (url) => new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const lib = parsedUrl.protocol === 'https:' ? https : http;
            lib.get(url, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
                res.on('error', reject);
            }).on('error', reject);
        });

        const { buffer, contentType } = await fetchBuffer(screenshotAttachment.url);
        imageBase64 = buffer.toString('base64');
        if (contentType.includes('png')) imageMediaType = 'image/png';
        else if (contentType.includes('gif')) imageMediaType = 'image/gif';
        else if (contentType.includes('webp')) imageMediaType = 'image/webp';
        else imageMediaType = 'image/jpeg';
    } catch (fetchErr) {
        console.error('Failed to fetch screenshot:', fetchErr);
        return interaction.editReply({ content: '⚠️ Could not load the screenshot. Please try again.' });
    }

    // ── 2. Call Claude API ───────────────────────────────────────
    let parsedBets;
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            system: buildSystemPrompt(),
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: imageMediaType,
                                data: imageBase64
                            }
                        },
                        {
                            type: 'text',
                            text: 'Parse this betslip screenshot and return only a JSON array.'
                        }
                    ]
                }
            ]
        });

        const rawText = response.content[0].text.trim();
        parsedBets = JSON.parse(rawText);

        if (!Array.isArray(parsedBets) || parsedBets.length === 0) {
            throw new Error('Empty or non-array response from Claude');
        }
    } catch (claudeErr) {
        console.error('Claude parse error:', claudeErr);
        return interaction.editReply({ content: '⚠️ Could not parse the screenshot. Please try `/bet manual` instead.' });
    }

    // ── 3. Parse description for units + note ───────────────────
    const { units, note } = parseDescriptionInput(descriptionText);

    if (units.length === 0) {
        return interaction.editReply({ content: '⚠️ Could not find any unit sizes in your description. Include values like `1u`, `0.5u`, etc.' });
    }

    // ── 4. Map units to bets ─────────────────────────────────────
    const mappedBets = mapUnitsToBets(units, parsedBets);

    // ── 5. Fetch notify role for preview ─────────────────────────
    const { rows: capperRows } = await pool.query(
        `SELECT notify_role_id FROM capper_info WHERE channel_id = $1`,
        [interaction.channel.id]
    );
    const notifyRoleId = capperRows[0]?.notify_role_id || null;

    // ── 6. Build preview embed ───────────────────────────────────
    const previewLines = mappedBets.map((bet, i) =>
        `**${i + 1}.** ${bet.description} | \`${bet.odds > 0 ? '+' : ''}${bet.odds}\` | **${bet.risk}u**`
    );

    if (note) previewLines.unshift(`**${note}**\n`);

    const previewEmbed = new EmbedBuilder()
        .setTitle('🔍 Betslip Preview — Confirm to Post')
        .setColor(0xF39C12)
        .setDescription(previewLines.join('\n'))
        .setFooter({ text: 'This preview expires in 5 minutes' })
        .setTimestamp();

    const previewComponents = [];

    if (link) {
        previewComponents.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Link')
                    .setStyle(ButtonStyle.Link)
                    .setURL(link)
                    .setEmoji('🔗')
            )
        );
    }

    previewComponents.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`scan_confirm_${interaction.id}`)
                .setLabel('Looks Good ✅')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`scan_cancel_${interaction.id}`)
                .setLabel('Cancel ❌')
                .setStyle(ButtonStyle.Danger)
        )
    );

    // ── 7. Store pending scan with 5-min TTL ─────────────────────
    const ttl = setTimeout(() => {
        pendingScans.delete(interaction.id);
    }, 5 * 60 * 1000);

    pendingScans.set(interaction.id, {
        bets: mappedBets,
        screenshotUrl: screenshotAttachment.url,
        link,
        userId,
        username,
        channelId: interaction.channel.id,
        note,
        notifyRoleId,
        ttl
    });

    return interaction.editReply({
        embeds: [previewEmbed],
        files: [screenshotAttachment.url],
        components: previewComponents
    });
}

// Exported so scan-confirm interaction can use it
module.exports.postBetToTrackerChannel = postBetToTrackerChannel;
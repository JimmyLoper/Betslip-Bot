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
const { calculatePayout } = require('../utils/calcPayout');
const { pendingOdds } = require('../utils/pendingOdds');

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

        // DM admin with screenshot so they can learn from the failure
        try {
            const adminId = process.env.ADMIN_OVERRIDE_ID;
            if (adminId) {
                const admin = await interaction.client.users.fetch(adminId).catch(() => null);
                if (admin) {
                    const { EmbedBuilder } = require('discord.js');
                    const rawOutput = claudeErr?.message || 'Unknown error';
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ AI Parse Failed')
                        .setColor(0xF39C12)
                        .addFields(
                            { name: 'User', value: `<@${userId}> (${userId})`, inline: false },
                            { name: 'Description Input', value: descriptionText, inline: false },
                            { name: 'Error', value: `\`\`\`${rawOutput}\`\`\``, inline: false }
                        )
                        .setTimestamp();
                    await admin.send({ embeds: [embed], files: [screenshotAttachment.url] }).catch(() => {});
                }
            }
        } catch (dmErr) {
            console.error('Failed to send parse error DM:', dmErr);
        }

        return interaction.editReply({ content: '⚠️ Could not parse the screenshot. Please try `/bet manual` instead.' });
    }

    // ── 3. Parse description for units + note ───────────────────
    const { units, note } = parseDescriptionInput(descriptionText);

    if (units.length === 0) {
        return interaction.editReply({ content: '⚠️ Could not find any unit sizes in your description. Include values like `1u`, `0.5u`, etc.' });
    }

    // ── 4. Map units to bets ─────────────────────────────────────
    const mappedBets = mapUnitsToBets(units, parsedBets);

    // ── 5. Fetch notify role + tracker channel ───────────────────
    const { rows: capperRows } = await pool.query(
        `SELECT notify_role_id, tracker_channel_id FROM capper_info WHERE channel_id = $1`,
        [interaction.channel.id]
    );
    const notifyRoleId = capperRows[0]?.notify_role_id || null;
    const trackerChannelId = capperRows[0]?.tracker_channel_id || null;

    const timestamp = Date.now();

    try {
        // ── 6. Build and send public channel message ─────────────────
        let publicMessage = '';
        if (notifyRoleId) publicMessage += `<@&${notifyRoleId}>\n\n`;
        if (note) publicMessage += `**${note}**\n`;
        mappedBets.forEach(bet => {
            publicMessage += `${bet.risk}u\n`;
        });
        publicMessage += '\n';

        const publicComponents = [];
        if (link) {
            publicComponents.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(link)
                        .setEmoji('🔗')
                )
            );
        }

        const sent = await interaction.channel.send({
            content: publicMessage,
            files: screenshotAttachment.url ? [screenshotAttachment.url] : [],
            components: publicComponents,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
        });

        // ── 7. Post each bet to tracker + insert into DB ─────────────
        const zeroOddsBets = [];

        for (const bet of mappedBets) {
            const betId = randomUUID();
            const payout = calculatePayout(bet.risk, bet.odds);

            const trackerMessageId = await postBetToTrackerChannel(
                interaction.client,
                userId,
                betId,
                bet.description,
                bet.risk,
                bet.sport,
                bet.odds,
                screenshotAttachment.url,
                link
            );

            await pool.query(
                `INSERT INTO bets
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
                [betId, userId, username, bet.description, bet.sport, bet.risk, bet.odds, payout, timestamp, sent.id, sent.channel.id, trackerMessageId || null]
            );

            if (bet.odds === 0) {
                zeroOddsBets.push({ betId, trackerMessageId, description: bet.description, risk: bet.risk, sport: bet.sport, screenshotUrl: screenshotAttachment.url, link });
            }
        }

        // ── 8. Prompt for odds if any bets had no readable odds ───────
        if (zeroOddsBets.length > 0 && trackerChannelId) {
            const ttl = setTimeout(() => pendingOdds.delete(interaction.id), 10 * 60 * 1000);
            pendingOdds.set(interaction.id, { bets: zeroOddsBets, trackerChannelId, ttl });

            return interaction.editReply({
                content: `✅ ${mappedBets.length > 1 ? `${mappedBets.length} bets` : 'Bet'} posted! Odds weren’t found in the screenshot — click below to add them.`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`parlay_odds_btn_${interaction.id}`)
                            .setLabel('📊 Enter Odds')
                            .setStyle(ButtonStyle.Primary)
                    )
                ]
            });
        }

        return interaction.editReply({ content: `✅ ${mappedBets.length > 1 ? `${mappedBets.length} bets` : 'Bet'} posted successfully!` });

    } catch (err) {
        console.error('Error posting scan bets:', err);

        // DM admin on failure
        try {
            const adminId = process.env.ADMIN_OVERRIDE_ID;
            if (adminId) {
                const admin = await interaction.client.users.fetch(adminId).catch(() => null);
                if (admin) {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Scan Bet Post Failed')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'User', value: `<@${userId}> (${userId})`, inline: false },
                            { name: 'Bets', value: mappedBets.map(b => `${b.description} | ${b.odds} | ${b.risk}u`).join('\n'), inline: false },
                            { name: 'Error', value: `\`\`\`${err.message}\`\`\``, inline: false }
                        )
                        .setTimestamp();
                    await admin.send({ embeds: [embed], files: [screenshotAttachment.url] }).catch(() => {});
                }
            }
        } catch (dmErr) {
            console.error('Failed to send error DM:', dmErr);
        }

        return interaction.editReply({ content: '❌ Error posting bets. Please try `/bet manual` instead.' });
    }
}

// Exported so scan-confirm interaction can use it
module.exports.postBetToTrackerChannel = postBetToTrackerChannel;
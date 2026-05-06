const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const { buildSystemPrompt } = require('../utils/sbParsers');
const { parseDescriptionInput } = require('../utils/parseDescription');
const { mapUnitsToBets } = require('../utils/mapUnits');
const { calculatePayout } = require('../utils/calcPayout');
const { postBetToTrackerChannel } = require('./bet');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin-only commands')

        // /admin addbet — AI scan, posts only to tracker (silent)
        .addSubcommand(sub =>
            sub
                .setName('addbet')
                .setDescription('Silently scan a betslip with AI and add bet(s) to the capper tracker only')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Unit size(s) e.g. "1u 0.5u" or "2u"')
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

        // /admin resetbet
        // ------------------------------------------------------------ 
        .addSubcommand(sub =>
            sub
                .setName('resetbet')
                .setDescription('Reset a settled bet back to pending and restore its tracker message buttons')
                .addStringOption(opt =>
                    opt.setName('tracker_message_id')
                        .setDescription('Tracker message ID of the bet to reset')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const overrideId = process.env.ADMIN_OVERRIDE_ID;

        // Permission gating
        if (interaction.user.id !== overrideId) {
            return interaction.reply({
                content: 'You are not authorized to use admin commands.',
                ephemeral: true
            });
        }

        if (sub === 'addbet') return handleAddBet(interaction);
        if (sub === 'resetbet') return handleResetBet(interaction);
    }
};

// ============================================================
// ADD BET HANDLER — AI-powered scan, tracker-only (silent)
// ============================================================
async function handleAddBet(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channelId = interaction.channel.id;
    const descriptionText = interaction.options.getString('description');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');
    const link = interaction.options.getString('link');

    // Look up capper for this channel
    const { rows: capperRows } = await pool.query(
        `SELECT user_id, username FROM capper_info WHERE channel_id = $1`,
        [channelId]
    );

    if (capperRows.length === 0) {
        return interaction.editReply({ content: '❌ This channel is not assigned to a capper.' });
    }

    const { user_id: userId, username } = capperRows[0];

    // ── 1. Fetch & base64 encode the screenshot ──────────────────
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
        console.error('[Admin] Failed to fetch screenshot:', fetchErr.message);
        return interaction.editReply({ content: '⚠️ Could not load the screenshot. Please try again.' });
    }

    // ── 2. Call Claude to parse the betslip ───────────────────────
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
                            source: { type: 'base64', media_type: imageMediaType, data: imageBase64 }
                        },
                        { type: 'text', text: 'Parse this betslip screenshot and return only a JSON array.' }
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
        console.error('[Admin] Claude parse error:', claudeErr.message);
        return interaction.editReply({ content: '⚠️ Could not parse the screenshot. Check the image and try again.' });
    }

    // ── 3. Parse description for unit sizes ───────────────────────
    const { units, note, eachUnit, unitMap } = parseDescriptionInput(descriptionText);

    if (units.length === 0) {
        return interaction.editReply({ content: '⚠️ Could not find any unit sizes. Include values like `1u`, `0.5u`, etc.' });
    }

    // ── 4. Map units to bets ──────────────────────────────────────
    const mappedBets = mapUnitsToBets(units, parsedBets, eachUnit, unitMap);
    const timestamp = Date.now();

    try {
        // Post each bet to the tracker channel only — no public channel message
        for (const bet of mappedBets) {
            const betId = randomUUID();
            // Use 0 if Claude couldn't read odds; admin can fix via tracker edit
            const odds = bet.odds || 0;
            const payout = calculatePayout(bet.risk, odds);

            const trackerMessageId = await postBetToTrackerChannel(
                interaction.client,
                userId,
                betId,
                bet.description,
                bet.risk,
                bet.sport,
                odds,
                screenshotAttachment.url,
                link
            );

            await pool.query(
                `INSERT INTO bets
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
                [betId, userId, username, bet.description, bet.sport, bet.risk, odds, payout, timestamp, null, channelId, trackerMessageId || null]
            );
        }

        return interaction.editReply({
            content: `✅ ${mappedBets.length > 1 ? `${mappedBets.length} bets` : 'Bet'} silently added to tracker for **${username}**.`
        });
    } catch (err) {
        console.error('[Admin] Error inserting bets:', err.message);
        return interaction.editReply({ content: '❌ Error saving bets to the tracker.' });
    }
}




// ============================================================
// RESET BET HANDLER
// ============================================================
async function handleResetBet(interaction) {
    const trackerMessageId = interaction.options.getString('tracker_message_id');
    const { ButtonBuilder, ButtonStyle, EmbedBuilder, ActionRowBuilder } = require('discord.js');

    try {
        // Fetch bet by tracker message ID
        const { rows } = await pool.query(
            `SELECT id, bet_description, sport, risk, odds, payout, user_id FROM bets WHERE tracker_message_id = $1`,
            [trackerMessageId]
        );

        if (rows.length === 0) {
            return interaction.reply({
                content: '❌ Bet not found with that tracker message ID.',
                ephemeral: true
            });
        }

        const bet = rows[0];

        // Update bet: set result to 'pending', clear graded_by and graded_at
        await pool.query(
            `UPDATE bets SET result = 'pending', graded_by = NULL, graded_at = NULL WHERE id = $1`,
            [bet.id]
        );

        // Find tracker channel via capper_info
        const { rows: capperRows } = await pool.query(
            `SELECT tracker_channel_id FROM capper_info WHERE user_id = $1`,
            [bet.user_id]
        );

        if (capperRows.length === 0 || !capperRows[0].tracker_channel_id) {
            return interaction.reply({
                content: '✅ Bet reset to pending, but tracker message could not be updated.',
                ephemeral: true
            });
        }

        const trackerChannelId = capperRows[0].tracker_channel_id;
        const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
        const trackerMsg = await trackerChannel.messages.fetch(trackerMessageId);

        // Rebuild the embed
        const embed = new EmbedBuilder()
            .setTitle(bet.bet_description)
            .setColor(0x3498db)
            .addFields(
                { name: 'Sport', value: bet.sport, inline: true },
                { name: 'Risk', value: `${bet.risk}u`, inline: true },
                { name: 'Odds', value: bet.odds.toString(), inline: true },
                { name: 'Payout', value: `${bet.payout}u`, inline: true }
            )
            .setTimestamp();

        // Rebuild settle buttons
        const settleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_tracker_win_${bet.id}`)
                .setLabel('Win')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_loss_${bet.id}`)
                .setLabel('Loss')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_push_${bet.id}`)
                .setLabel('Push')
                .setStyle(ButtonStyle.Secondary)
        );

        // Rebuild action buttons
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_bet_${bet.id}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`delete_bet_${bet.id}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
        );

        // Update the message
        await trackerMsg.edit({
            content: '',
            embeds: [embed],
            components: [settleRow, actionRow]
        });

        return interaction.reply({
            content: `✅ Bet reset to pending and tracker message updated.`,
            ephemeral: true
        });

    } catch (err) {
        console.error('Error resetting bet:', err);
        return interaction.reply({
            content: '❌ Error resetting bet. Check if tracker message ID is valid.',
            ephemeral: true
        });
    }
}
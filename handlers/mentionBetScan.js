const Anthropic = require('@anthropic-ai/sdk');
const { randomUUID } = require('crypto');
const db = require('../utils/db');
const { parseDescriptionInput } = require('../utils/parseDescription');
const { buildSystemPrompt } = require('../utils/sbParsers');
const { mapUnitsToBets } = require('../utils/mapUnits');
const { calculatePayout } = require('../utils/calcPayout');
const { postBetToTrackerChannel } = require('../commands/bet');
const { fetchImageBuffer, resolveMediaType } = require('../utils/fetchImage');

const adminId = process.env.ADMIN_OVERRIDE_ID;

// ============================================================
// SHARED: PROCESS A BOT-MENTION MESSAGE AS A BET SCAN
// Returns true if bets were tracked, false if skipped/failed.
// ============================================================
async function processMentionBet(message, client) {
    // Only act in registered bet channels
    const { rows: capperRows } = await db.query(
        `SELECT notify_role_id, tracker_channel_id FROM capper_info WHERE channel_id = $1`,
        [message.channelId]
    );
    if (capperRows.length === 0) return false;

    const userId = message.author.id;
    const username = message.author.username;

    // Strip all mentions from content to isolate the description/units text
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();

    const { units, note, eachUnit, unitMap } = parseDescriptionInput(cleanContent);
    const attachment = message.attachments.first();

    // ── No units or no screenshot → fall back to admin DM notification ──
    if (units.length === 0 || !attachment) {

        if (!adminId) return false;
        const admin = await client.users.fetch(adminId).catch(() => null);
        if (!admin) return false;

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('Bot Mentioned!')
            .setDescription(`Someone mentioned the bot in ${message.guild?.name || 'DM'}`)
            .addFields(
                { name: 'User', value: `${message.author} (${message.author.id})`, inline: false },
                { name: 'Channel', value: message.channel?.toString() || 'DM', inline: false },
                { name: 'Message', value: message.content.substring(0, 1024), inline: false }
            )
            .setColor(0xFFA500)
            .setTimestamp()
            .setFooter({ text: `Message ID: ${message.id}` });

        await admin.send({ embeds: [embed] }).catch(err => console.error('Failed to send DM:', err));
        return false;
    }

    // ── BET SCAN FLOW ────────────────────────────────────────────────────

    // 1. Fetch & base64 encode the screenshot
    let imageBase64, imageMediaType;
    try {
        const { buffer, contentType } = await fetchImageBuffer(attachment.url);
        imageBase64 = buffer.toString('base64');
        imageMediaType = resolveMediaType(contentType);
    } catch (fetchErr) {
        console.error('Failed to fetch screenshot from mention message:', fetchErr);
        await message.author.send('⚠️ Could not read your screenshot. Please check the screenshot and try again.').catch(() => {});
        return false;
    }

    // 2. Call Claude API
    let parsedBets;
    try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2500,
            system: buildSystemPrompt(),
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
                    { type: 'text', text: 'Parse this betslip screenshot and return only a JSON array.' }
                ]
            }]
        });

        const rawText = response.content[0].text.trim();
        parsedBets = JSON.parse(rawText);
        if (!Array.isArray(parsedBets) || parsedBets.length === 0) throw new Error('Empty or non-array response');
    } catch (claudeErr) {
        console.error('Claude parse error (mention flow):', claudeErr);
        await message.author.send('⚠️ Could not parse your betslip. Please check the screenshot and try again.').catch(() => {});
        return false;
    }

    // 3. Map units to bets
    const mappedBets = mapUnitsToBets(units, parsedBets, eachUnit, unitMap);
    const timestamp = Date.now();

    // 4. Post each bet to tracker + insert into DB (no public channel post)
    for (const bet of mappedBets) {
        const betId = randomUUID();
        const payout = calculatePayout(bet.risk, bet.odds);

        const trackerMessageId = await postBetToTrackerChannel(
            client,
            userId,
            betId,
            bet.description,
            bet.risk,
            bet.sport,
            bet.odds,
            attachment.url,
            null
        );

        await db.query(
            `INSERT INTO bets
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
            [betId, userId, username, bet.description, bet.sport, bet.risk, bet.odds, payout, timestamp, message.id, message.channelId, trackerMessageId || null]
        );
    }

    // No public post — tracker channel message serves as confirmation
    return true;
}

// ============================================================
// BOT MENTION → BET SCAN (or admin notification fallback)
// ============================================================
async function handleMentionMessageCreate(message, client) {
    try {
        if (message.author?.bot) return;

        // Skip replies — only handle direct mentions
        if (message.reference) return;

        if (!message.mentions.has(client.user.id)) return;
        if (message.mentions.everyone) return;

        await processMentionBet(message, client);
    } catch (err) {
        console.error('Error in mention bet scan handler:', err);
    }
}

// ============================================================
// MESSAGE EDIT → BET SCAN (catches forgotten units added later)
// ============================================================
async function handleMentionMessageUpdate(oldMessage, newMessage, client) {
    try {
        // Fetch full message if partial
        if (newMessage.partial) {
            newMessage = await newMessage.fetch().catch(() => null);
            if (!newMessage) return;
        }

        if (newMessage.author?.bot) return;
        if (newMessage.reference) return;
        if (!newMessage.mentions.has(client.user.id)) return;
        if (newMessage.mentions.everyone) return;

        // Guard: skip if this message has already been tracked
        const { rows } = await db.query(
            `SELECT 1 FROM bets WHERE message_id = $1 LIMIT 1`,
            [newMessage.id]
        );
        if (rows.length > 0) return;

        await processMentionBet(newMessage, client);
    } catch (err) {
        console.error('Error in messageUpdate bet scan handler:', err);
    }
}

module.exports = { handleMentionMessageCreate, handleMentionMessageUpdate };

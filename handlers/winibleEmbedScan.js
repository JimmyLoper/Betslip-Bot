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

// Shared admin-failure DM, mirrors the pattern in mentionBetScan.js / bet.js
async function dmAdmin(client, title, fields) {
    if (!adminId) return;
    const admin = await client.users.fetch(adminId).catch(() => null);
    if (!admin) return;

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xFF0000)
        .addFields(fields)
        .setTimestamp();

    await admin.send({ embeds: [embed] }).catch(err => console.error('Failed to send admin DM:', err));
}

// ============================================================
// WINIBLE BOT EMBED → BET SCAN
// Detects Winible bot posts in a registered capper channel (or their
// live-play channel), parses the accompanying screenshot with Claude,
// and tracks the resulting bet(s).
// ============================================================
async function winibleEmbedScan(message) {
    const client = message.client;

    try {
        // ── Detection ──────────────────────────────────────────────
        if (!message.author?.bot) return;
        if (message.author.id !== process.env.WINIBLE_BOT_ID) return;
        if (message.embeds.length === 0) return;

        const { rows: capperRows } = await db.query(
            `SELECT user_id, username, capper_name, tracker_channel_id,
                    channel_id, live_play_channel_id, notify_role_id
             FROM capper_info
             WHERE channel_id = $1 OR live_play_channel_id = $1`,
            [message.channel.id]
        );
        const capper = capperRows[0];
        if (!capper) return;

        const isLivePlay = message.channel.id === capper.live_play_channel_id ? 1 : 0;

        // ── Extract description/units from the raw content above the embed ──
        const { units, eachUnit, unitMap } = parseDescriptionInput(message.content);
        if (units.length === 0) {
            console.warn(`Winible embed scan: no units found in message ${message.id} (channel ${message.channel.id})`);
            return;
        }

        // ── Extract screenshot ─────────────────────────────────────
        const screenshotUrl = message.embeds[0].image?.url || message.embeds[0].thumbnail?.url;
        if (!screenshotUrl) {
            console.warn(`Winible embed scan: no image found in embed for message ${message.id}`);
            return;
        }

        // ── Fetch & base64 encode the screenshot ───────────────────
        let imageBase64, imageMediaType;
        try {
            const { buffer, contentType } = await fetchImageBuffer(screenshotUrl);
            imageBase64 = buffer.toString('base64');
            imageMediaType = resolveMediaType(contentType);
        } catch (fetchErr) {
            console.error('Failed to fetch Winible screenshot:', fetchErr);
            await dmAdmin(client, '⚠️ Winible Screenshot Fetch Failed', [
                { name: 'Capper', value: capper.capper_name || capper.username || capper.user_id, inline: false },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: false },
                { name: 'Message ID', value: message.id, inline: false },
                { name: 'Error', value: `\`\`\`${fetchErr.message}\`\`\``, inline: false }
            ]);
            return;
        }

        // ── Call Claude ─────────────────────────────────────────────
        let parsedBets;
        try {
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 2000,
                system: buildSystemPrompt(),
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
                        { type: 'text', text: 'Parse this betslip screenshot and return only a JSON array.' }
                    ]
                }]
            });

            const textBlock = response.content.find(block => block.type === 'text');
            if (!textBlock || !textBlock.text) throw new Error('No text content in Claude response');
            const rawText = textBlock.text.trim();
            // Claude sometimes self-corrects mid-response and prints a second array — take the last (final) one.
            const jsonMatches = rawText.match(/\[[\s\S]*?\]/g);
            if (!jsonMatches || jsonMatches.length === 0) throw new Error('No JSON array found in Claude response');
            parsedBets = JSON.parse(jsonMatches[jsonMatches.length - 1]);
            if (!Array.isArray(parsedBets) || parsedBets.length === 0) throw new Error('Empty or non-array response');
        } catch (claudeErr) {
            console.error('Claude parse error (Winible embed flow):', claudeErr);
            await dmAdmin(client, '⚠️ Winible Betslip Parse Failed', [
                { name: 'Capper', value: capper.capper_name || capper.username || capper.user_id, inline: false },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: false },
                { name: 'Message ID', value: message.id, inline: false },
                { name: 'Error', value: `\`\`\`${claudeErr.message}\`\`\``, inline: false }
            ]);
            return;
        }

        // ── Map units to bets ────────────────────────────────────────
        const mappedBets = mapUnitsToBets(units, parsedBets, eachUnit, unitMap);
        const timestamp = Date.now();

        // ── Post to tracker + insert into DB ─────────────────────────
        for (const bet of mappedBets) {
            const betId = randomUUID();
            const payout = calculatePayout(bet.risk, bet.odds);

            const trackerMessageId = await postBetToTrackerChannel(
                client,
                capper.user_id,
                betId,
                bet.description,
                bet.risk,
                bet.sport,
                bet.odds,
                screenshotUrl,
                null
            );

            await db.query(
                `INSERT INTO bets
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id, is_live_play)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13)`,
                [betId, capper.user_id, capper.username, bet.description, bet.sport, bet.risk, bet.odds, payout, timestamp, message.id, message.channel.id, trackerMessageId || null, isLivePlay]
            );
        }
    } catch (err) {
        console.error('Error in Winible embed scan handler:', err);
        await dmAdmin(client, '❌ Winible Embed Scan Failed', [
            { name: 'Message ID', value: message.id, inline: false },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: false },
            { name: 'Error', value: `\`\`\`${err.message}\`\`\``, inline: false }
        ]).catch(() => {});
    }
}

module.exports = { winibleEmbedScan };

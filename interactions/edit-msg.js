const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder
} = require('discord.js');
const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');
const { pendingEdits } = require('../utils/pendingEdits');
const { buildSystemPrompt } = require('../utils/sbParsers');

module.exports = {
    customIds: ['bet_edit_select', 'bet_edit_msg_modal'],

    async execute(interaction) {
        if (interaction.isStringSelectMenu()) {
            return handleSelectBet(interaction);
        }
        if (interaction.isModalSubmit()) {
            return handleEditModal(interaction);
        }
    }
};

// ============================================================
// SELECT MENU — USER PICKS A BET TO EDIT
// ============================================================
async function handleSelectBet(interaction) {
    const selected = interaction.values[0];
    const [betId, originId] = selected.split('__');

    // Fetch current bet details
    const { rows } = await db.query(
        `SELECT bet_description, risk, odds, message_id, channel_id FROM bets WHERE id = $1`,
        [betId]
    );

    if (rows.length === 0) {
        return interaction.reply({ content: 'Bet not found.', ephemeral: true });
    }

    const bet = rows[0];

    // Get the public message content for the description field
    let publicDesc = bet.bet_description;
    if (bet.message_id && bet.channel_id) {
        try {
            const channel = await interaction.client.channels.fetch(bet.channel_id);
            if (channel) {
                const msg = await channel.messages.fetch(bet.message_id).catch(() => null);
                if (msg) {
                    const cleaned = msg.content.replace(/<@&\d+>/g, '').trim();
                    const boldMatch = cleaned.match(/\*\*(.+?)\*\*/);
                    if (boldMatch) publicDesc = boldMatch[1];
                }
            }
        } catch (e) {
            // fallback to DB description
        }
    }

    const modal = new ModalBuilder()
        .setCustomId(`bet_edit_msg_modal_${betId}__${originId}`)
        .setTitle('Edit Bet');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(publicDesc)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.risk.toString())
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput)
    );

    return interaction.showModal(modal);
}

// ============================================================
// MODAL SUBMIT — APPLY EDITS (with optional AI re-scan)
// ============================================================
async function handleEditModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // customId = bet_edit_msg_modal_<betId>__<originId>
    const suffix = interaction.customId.replace('bet_edit_msg_modal_', '');
    const [betId, originId] = suffix.split('__');

    const newDescription = interaction.fields.getTextInputValue('description');
    const newRisk = parseFloat(interaction.fields.getTextInputValue('risk'));

    if (isNaN(newRisk) || newRisk <= 0) {
        return interaction.editReply({ content: '⚠️ Risk must be a positive number.' });
    }

    // Fetch existing bet details
    const { rows: betRows } = await db.query(
        `SELECT bet_description, sport, risk, odds, message_id, channel_id, tracker_message_id, user_id FROM bets WHERE id = $1`,
        [betId]
    );

    if (betRows.length === 0) {
        return interaction.editReply({ content: '❌ Bet not found.' });
    }

    const bet = betRows[0];
    const pending = pendingEdits.get(originId);
    const newScreenshotUrl = pending?.screenshotUrl || null;

    // ── If new screenshot provided, re-scan with Claude ─────────
    let scannedBet = null;
    if (newScreenshotUrl) {
        try {
            scannedBet = await rescanScreenshot(newScreenshotUrl);
        } catch (scanErr) {
            console.error('Re-scan failed:', scanErr);
            return interaction.editReply({ content: '⚠️ Could not parse the new screenshot. Edit cancelled.' });
        }
    }

    // Determine final values — scanned data overrides tracker fields, modal overrides public fields
    const finalBetDescription = scannedBet?.description || bet.bet_description;
    const finalSport = scannedBet?.sport || bet.sport;
    const finalOdds = scannedBet?.odds != null ? scannedBet.odds : bet.odds;
    const finalBetType = scannedBet?.betType || null;
    const finalPayout = calculatePayout(newRisk, finalOdds);

    // ── 1. Update database ──────────────────────────────────────
    await db.query(
        `UPDATE bets SET bet_description = $1, sport = $2, risk = $3, odds = $4, payout = $5 WHERE id = $6`,
        [finalBetDescription, finalSport, newRisk, finalOdds, finalPayout, betId]
    );

    // ── 2. Update public channel message ────────────────────────
    if (bet.message_id && bet.channel_id) {
        try {
            const channel = await interaction.client.channels.fetch(bet.channel_id);
            if (channel) {
                const originalMsg = await channel.messages.fetch(bet.message_id).catch(() => null);
                if (originalMsg) {
                    // Check if this message has multiple bets (scan batch)
                    const { rows: siblingBets } = await db.query(
                        `SELECT id, bet_description, risk FROM bets WHERE message_id = $1 ORDER BY timestamp ASC`,
                        [bet.message_id]
                    );

                    // Fetch notify role for this channel
                    const { rows: capperRows } = await db.query(
                        `SELECT notify_role_id FROM capper_info WHERE channel_id = $1`,
                        [bet.channel_id]
                    );
                    const notifyRoleId = capperRows[0]?.notify_role_id || null;

                    let newContent;
                    if (siblingBets.length === 1) {
                        // Single bet (manual) — rebuild full message
                        newContent = '';
                        if (notifyRoleId) newContent += `<@&${notifyRoleId}>\n\n`;
                        newContent += `**${newDescription}**\n`;
                        newContent += `Risk: **${newRisk}u**\n\n`;
                    } else {
                        // Multi-bet (scan batch) — update the specific unit line
                        const betIndex = siblingBets.findIndex(b => b.id === betId);
                        const lines = originalMsg.content.split('\n');

                        // Find unit lines (lines that match Xu pattern)
                        const unitLineIndices = [];
                        for (let i = 0; i < lines.length; i++) {
                            if (/^\d+(\.\d+)?u$/.test(lines[i].trim())) {
                                unitLineIndices.push(i);
                            }
                        }

                        if (betIndex >= 0 && betIndex < unitLineIndices.length) {
                            lines[unitLineIndices[betIndex]] = `${newRisk}u`;
                        }

                        // Also update the bold note line if description changed
                        for (let i = 0; i < lines.length; i++) {
                            const boldMatch = lines[i].match(/^\*\*(.+?)\*\*$/);
                            if (boldMatch) {
                                lines[i] = `**${newDescription}**`;
                                break;
                            }
                        }

                        newContent = lines.join('\n');
                    }

                    const editPayload = {
                        content: newContent,
                        components: originalMsg.components,
                        allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
                    };

                    if (newScreenshotUrl) {
                        editPayload.files = [newScreenshotUrl];
                        editPayload.attachments = [];
                    }

                    await originalMsg.edit(editPayload);
                }
            }
        } catch (err) {
            console.error('Error updating public channel message:', err);
        }
    }

    // ── 3. Update tracker embed ─────────────────────────────────
    if (bet.tracker_message_id && bet.user_id) {
        try {
            const { rows: trackerRows } = await db.query(
                `SELECT tracker_channel_id FROM capper_info WHERE user_id = $1`,
                [bet.user_id]
            );
            const trackerChannelId = trackerRows[0]?.tracker_channel_id;
            if (trackerChannelId) {
                const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
                if (trackerChannel) {
                    const trackerMsg = await trackerChannel.messages.fetch(bet.tracker_message_id).catch(() => null);
                    if (trackerMsg) {
                        const embed = new EmbedBuilder()
                            .setTitle(finalBetDescription)
                            .setColor(0x3498db)
                            .addFields(
                                { name: 'Sport', value: finalSport, inline: true },
                                { name: 'Risk', value: `${newRisk}u`, inline: true },
                                { name: 'Odds', value: finalOdds.toString(), inline: true },
                                { name: 'Payout', value: `${finalPayout}u`, inline: true }
                            )
                            .setTimestamp(trackerMsg.embeds[0]?.timestamp ? new Date(trackerMsg.embeds[0].timestamp) : undefined);

                        const editPayload = { embeds: [embed], components: trackerMsg.components };

                        if (newScreenshotUrl) {
                            editPayload.files = [newScreenshotUrl];
                            editPayload.attachments = [];
                        }

                        await trackerMsg.edit(editPayload);
                    }
                }
            }
        } catch (err) {
            console.error('Error updating tracker message:', err);
        }
    }

    // Clean up pending edit data
    if (pending) {
        clearTimeout(pending.ttl);
        pendingEdits.delete(originId);
    }

    const parts = ['✅ Bet updated successfully!'];
    if (scannedBet) parts.push(`AI re-scanned: **${finalBetDescription}** | ${finalOdds > 0 ? '+' : ''}${finalOdds} | ${finalSport}`);
    return interaction.editReply({ content: parts.join('\n') });
}

// ============================================================
// RE-SCAN SCREENSHOT WITH CLAUDE
// ============================================================
async function rescanScreenshot(screenshotUrl) {
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

    const { buffer, contentType } = await fetchBuffer(screenshotUrl);
    const imageBase64 = buffer.toString('base64');
    let imageMediaType = 'image/jpeg';
    if (contentType.includes('png')) imageMediaType = 'image/png';
    else if (contentType.includes('gif')) imageMediaType = 'image/gif';
    else if (contentType.includes('webp')) imageMediaType = 'image/webp';

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
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
    const parsedBets = JSON.parse(rawText);

    if (!Array.isArray(parsedBets) || parsedBets.length === 0) {
        throw new Error('Empty or non-array response from Claude');
    }

    // Return the first bet (the user selected one specific bet to edit)
    return parsedBets[0];
}

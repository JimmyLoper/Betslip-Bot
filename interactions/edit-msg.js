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
        `SELECT bet_description, risk, odds FROM bets WHERE id = $1`,
        [betId]
    );

    if (rows.length === 0) {
        return interaction.reply({ content: 'Bet not found.', ephemeral: true });
    }

    const { bet_description, risk, odds } = rows[0];

    const modal = new ModalBuilder()
        .setCustomId(`bet_edit_msg_modal_${betId}__${originId}`)
        .setTitle('Edit Bet');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(bet_description)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setValue(risk.toString())
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput)
    );

    return interaction.showModal(modal);
}

// ============================================================
// MODAL SUBMIT — APPLY EDITS
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
        `SELECT bet_description, risk, odds, message_id, channel_id, tracker_message_id, user_id FROM bets WHERE id = $1`,
        [betId]
    );

    if (betRows.length === 0) {
        return interaction.editReply({ content: '❌ Bet not found.' });
    }

    const bet = betRows[0];
    const newPayout = calculatePayout(newRisk, bet.odds);

    // ── 1. Update database ──────────────────────────────────────
    await db.query(
        `UPDATE bets SET bet_description = $1, risk = $2, payout = $3 WHERE id = $4`,
        [newDescription, newRisk, newPayout, betId]
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

                    // Check for pending screenshot replacement
                    const pending = pendingEdits.get(originId);
                    const newScreenshotUrl = pending?.screenshotUrl || null;

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
                        // Find position of this bet in the batch
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
                            .setTitle(newDescription)
                            .setColor(0x3498db)
                            .addFields(
                                { name: 'Sport', value: trackerMsg.embeds[0]?.fields?.find(f => f.name === 'Sport')?.value || 'N/A', inline: true },
                                { name: 'Risk', value: `${newRisk}u`, inline: true },
                                { name: 'Odds', value: bet.odds.toString(), inline: true },
                                { name: 'Payout', value: `${newPayout}u`, inline: true }
                            )
                            .setTimestamp(trackerMsg.embeds[0]?.timestamp ? new Date(trackerMsg.embeds[0].timestamp) : undefined);

                        const editPayload = { embeds: [embed], components: trackerMsg.components };

                        // Also replace tracker screenshot if new one provided
                        const pending = pendingEdits.get(originId);
                        if (pending?.screenshotUrl) {
                            editPayload.files = [pending.screenshotUrl];
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
    const pending = pendingEdits.get(originId);
    if (pending) {
        clearTimeout(pending.ttl);
        pendingEdits.delete(originId);
    }

    return interaction.editReply({ content: '✅ Bet updated successfully!' });
}

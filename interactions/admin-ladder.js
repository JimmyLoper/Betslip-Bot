const pool = require('../utils/db');
const { randomUUID } = require('crypto');
const { calculatePayout } = require('../utils/calcPayout');
const {
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');

// TODO: Convert admin ladder to full command-line inputs instead of modal workflow
// Allow /admin addladder to accept step count and bet details as options directly

module.exports = {
    customIds: [
        'admin_ladder_step_count',
        'admin_ladder_step_modal',
        'admin_ladder_next_step',
        'admin_ladder_final_sport',
        'admin_ladder_final_button'
    ],

    async execute(interaction) {
        const customId = interaction.customId;

        if (customId === 'admin_ladder_step_count') {
            return handleAdminLadderStepCount(interaction);
        }
        if (customId.startsWith('admin_ladder_step_modal')) {
            return handleAdminLadderStepModal(interaction);
        }
        if (customId.startsWith('admin_ladder_next_step')) {
            return handleAdminLadderNextStep(interaction);
        }
        if (customId === 'admin_ladder_final_sport') {
            return handleAdminLadderFinalSportButton(interaction);
        }
        if (customId === 'admin_ladder_final_sport_modal') {
            return handleAdminLadderFinalSportModal(interaction);
        }
    }
};

// ============================================================
// ADMIN LADDER STEP COUNT
// ============================================================
async function handleAdminLadderStepCount(interaction) {
    const totalSteps = parseInt(interaction.values[0], 10);

    interaction.client.ladderCache ??= new Map();
    interaction.client.ladderCache.set(interaction.user.id, {
        steps: [],
        totalSteps,
        channelId: interaction.channel.id
    });

    const modal = new ModalBuilder()
        .setCustomId(`admin_ladder_step_modal_1_${totalSteps}`)
        .setTitle(`Step 1 of ${totalSteps}`);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Bet Description')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds (e.g., -110, +150)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const messageIdInput = new TextInputBuilder()
        .setCustomId('message_id')
        .setLabel('Message ID (from betslip)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput),
        new ActionRowBuilder().addComponents(messageIdInput)
    );

    await interaction.showModal(modal);
}

// ============================================================
// ADMIN LADDER STEP MODAL
// ============================================================
async function handleAdminLadderStepModal(interaction) {
    try {
        const customIdParts = interaction.customId.split('_');
        const stepNumber = parseInt(customIdParts[4], 10);
        const totalSteps = parseInt(customIdParts[5], 10);

        const description = interaction.fields.getTextInputValue('description');
        const risk = parseFloat(interaction.fields.getTextInputValue('risk'));
        const odds = parseFloat(interaction.fields.getTextInputValue('odds'));
        const messageId = interaction.fields.getTextInputValue('message_id');

        if (isNaN(risk) || isNaN(odds)) {
            return interaction.reply({
                content: '❌ Risk and odds must be numbers.',
                ephemeral: true
            });
        }

        const cache = interaction.client.ladderCache?.get(interaction.user.id);
        if (!cache) {
            return interaction.reply({
                content: '❌ Ladder session expired.',
                ephemeral: true
            });
        }

        cache.steps.push({ description, risk, odds, messageId, stepNumber });

        if (stepNumber === totalSteps) {
            const modal = new ModalBuilder()
                .setCustomId('admin_ladder_final_sport_modal')
                .setTitle('Final Step - Ladder Details');

            const sportInput = new TextInputBuilder()
                .setCustomId('sport')
                .setLabel('Sport (NFL, NBA, etc.)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(sportInput));

            return interaction.showModal(modal);
        }

        const nextButton = new ButtonBuilder()
            .setCustomId(`admin_ladder_next_step_${stepNumber + 1}_${totalSteps}`)
            .setLabel('Next Step')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(nextButton);

        return interaction.reply({
            content: `✅ Step ${stepNumber} saved. Click **Next Step** to continue.`,
            components: [row],
            ephemeral: true
        });
    } catch (err) {
        console.error('Error in admin-ladder-step-modal:', err);
        return interaction.reply({
            content: '❌ An error occurred processing your step.',
            ephemeral: true
        });
    }
}

// ============================================================
// ADMIN LADDER NEXT STEP
// ============================================================
async function handleAdminLadderNextStep(interaction) {
    try {
        const customIdParts = interaction.customId.split('_');
        const stepNumber = parseInt(customIdParts[4], 10);
        const totalSteps = parseInt(customIdParts[5], 10);

        const modal = new ModalBuilder()
            .setCustomId(`admin_ladder_step_modal_${stepNumber}_${totalSteps}`)
            .setTitle(`Step ${stepNumber} of ${totalSteps}`);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Bet Description')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const riskInput = new TextInputBuilder()
            .setCustomId('risk')
            .setLabel('Risk (units)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const oddsInput = new TextInputBuilder()
            .setCustomId('odds')
            .setLabel('Odds (e.g., -110, +150)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const messageIdInput = new TextInputBuilder()
            .setCustomId('message_id')
            .setLabel('Message ID (from betslip)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(riskInput),
            new ActionRowBuilder().addComponents(oddsInput),
            new ActionRowBuilder().addComponents(messageIdInput)
        );

        await interaction.showModal(modal);
    } catch (err) {
        console.error('Error in admin-ladder-next-step:', err);
        await interaction.reply({
            content: '❌ An error occurred showing the next step.',
            ephemeral: true
        });
    }
}

// ============================================================
// ADMIN LADDER FINAL BUTTON
// ============================================================
async function handleAdminLadderFinalSportButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('admin_ladder_final_sport_modal')
        .setTitle('Final Step - Ladder Details');

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport (NFL, NBA, etc.)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(sportInput));

    await interaction.showModal(modal);
}

// ============================================================
// ADMIN LADDER FINAL SPORT MODAL
// ============================================================
async function handleAdminLadderFinalSportModal(interaction) {
    const sport = interaction.fields.getTextInputValue('sport');

    const cache = interaction.client.ladderCache?.get(interaction.user.id);
    if (!cache || !cache.steps.length) {
        return interaction.reply({
            content: '❌ Ladder session expired.',
            ephemeral: true
        });
    }

    try {
        const { rows } = await pool.query(
            `SELECT user_id, username, tracker_channel_id FROM channel_notify_roles WHERE channel_id = $1`,
            [cache.channelId]
        );

        if (rows.length === 0) {
            return interaction.reply({
                content: '❌ Channel not assigned to a capper.',
                ephemeral: true
            });
        }

        const capperId = rows[0].user_id;
        const capperUsername = rows[0].username;
        const trackerChannelId = rows[0].tracker_channel_id;
        const timestamp = Date.now();

        const insertedIds = [];
        for (const step of cache.steps) {
            const payout = calculatePayout(step.risk, step.odds);
            const betId = randomUUID();

            await pool.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, channel_id, message_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11)`,
                [
                    betId,
                    capperId,
                    capperUsername,
                    step.description,
                    sport,
                    step.risk,
                    step.odds,
                    payout,
                    timestamp,
                    cache.channelId,
                    step.messageId
                ]
            );

            insertedIds.push(betId);
        }

        if (trackerChannelId) {
            try {
                const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
                if (trackerChannel) {
                    for (let i = 0; i < cache.steps.length; i++) {
                        const step = cache.steps[i];
                        const betId = insertedIds[i];
                        const payout = calculatePayout(step.risk, step.odds);

                        const embed = new EmbedBuilder()
                            .setTitle(`Ladder Step ${i + 1}`)
                            .setDescription(step.description)
                            .setColor(0x3498db)
                            .addFields(
                                { name: 'Sport', value: sport, inline: true },
                                { name: 'Risk', value: `${step.risk}u`, inline: true },
                                { name: 'Odds', value: step.odds.toString(), inline: true },
                                { name: 'Payout', value: `${payout}u`, inline: true }
                            )
                            .setTimestamp();

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

                        const trackerMsg = await trackerChannel.send({
                            embeds: [embed],
                            components: [settleRow, actionRow]
                        });
                        
                        // Update bet with tracker message ID
                        await pool.query(
                            `UPDATE bets SET tracker_message_id = $1 WHERE id = $2`,
                            [trackerMsg.id, betId]
                        );
                    }
                }
            } catch (err) {
                console.error('Error posting to tracker channel:', err);
            }
        }

        interaction.client.ladderCache.delete(interaction.user.id);

        return interaction.reply({
            content: `✅ Ladder with ${cache.steps.length} steps posted to tracker for **${capperUsername}** (Sport: **${sport}**).`,
            ephemeral: true
        });

    } catch (err) {
        console.error('Error inserting admin ladder:', err);
        return interaction.reply({
            content: '❌ Error inserting ladder bets.',
            ephemeral: true
        });
    }
}

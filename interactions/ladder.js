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

module.exports = {
    customIds: [
        'ladder_step_count',
        'ladder_step_modal',
        'ladder_next_step',
        'ladder_final_step',
        'ladder_final_modal'
    ],

    async execute(interaction) {
        const customId = interaction.customId;

        if (customId === 'ladder_step_count') {
            return handleLadderStepCount(interaction);
        }
        if (customId.startsWith('ladder_step_modal')) {
            return handleLadderStepModal(interaction);
        }
        if (customId.startsWith('ladder_next_step')) {
            return handleLadderNextStep(interaction);
        }
        if (customId === 'ladder_final_step') {
            return handleLadderFinalStep(interaction);
        }
        if (customId === 'ladder_final_modal') {
            return handleLadderFinalModal(interaction);
        }
    }
};

// ============================================================
// LADDER STEP COUNT
// ============================================================
async function handleLadderStepCount(interaction) {
    const totalSteps = parseInt(interaction.values[0], 10);

    if (!interaction.client.ladderCache) {
        interaction.client.ladderCache = new Map();
    }

    interaction.client.ladderCache.set(interaction.user.id, {
        steps: [],
        totalSteps
    });

    const modal = new ModalBuilder()
        .setCustomId('ladder_step_modal_1')
        .setTitle('Ladder Step 1');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description for Step 1')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk for Step 1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds for Step 1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput)
    );

    await interaction.showModal(modal);
}

// ============================================================
// LADDER STEP MODAL
// ============================================================
async function handleLadderStepModal(interaction) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const stepNumber = parseInt(parts[3], 10);

    const description = interaction.fields.getTextInputValue('description');
    const risk = interaction.fields.getTextInputValue('risk');
    const odds = interaction.fields.getTextInputValue('odds');

    if (!interaction.client.ladderCache) {
        interaction.client.ladderCache = new Map();
    }

    const userId = interaction.user.id;
    let steps = interaction.client.ladderCache.get(userId) || { steps: [], totalSteps: 0 };

    steps.steps.push({
        step: stepNumber,
        description,
        risk,
        odds
    });

    interaction.client.ladderCache.set(userId, steps);

    if (stepNumber < steps.totalSteps) {
        const button = new ButtonBuilder()
            .setCustomId(`ladder_next_step_${stepNumber + 1}_${steps.totalSteps}`)
            .setLabel(`Next Step (${stepNumber + 1}/${steps.totalSteps})`)
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        return interaction.reply({
            content: `✅ Step ${stepNumber} saved. Click below for the next step.`,
            components: [row],
            flags: 'Ephemeral'
        });
    }

    const finalButton = new ButtonBuilder()
        .setCustomId('ladder_final_step')
        .setLabel('Complete Ladder')
        .setStyle(ButtonStyle.Success);

    const finalRow = new ActionRowBuilder().addComponents(finalButton);

    return interaction.reply({
        content: `✅ Step ${stepNumber} saved. Click below to complete the ladder.`,
        components: [finalRow],
        flags: 'Ephemeral'
    });
}

// ============================================================
// LADDER NEXT STEP
// ============================================================
async function handleLadderNextStep(interaction) {
    const parts = interaction.customId.split('_');
    const stepNumber = parseInt(parts[3], 10);
    const totalSteps = parseInt(parts[4], 10);

    const modal = new ModalBuilder()
        .setCustomId(`ladder_step_modal_${stepNumber}`)
        .setTitle(`Ladder Step ${stepNumber}`);

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel(`Description for Step ${stepNumber}`)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel(`Risk for Step ${stepNumber}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel(`Odds for Step ${stepNumber}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput)
    );

    await interaction.showModal(modal);
}

// ============================================================
// LADDER FINAL STEP
// ============================================================
async function handleLadderFinalStep(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('ladder_final_modal')
        .setTitle('Complete Your Ladder');

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const descInput = new TextInputBuilder()
        .setCustomId('overall_description')
        .setLabel('Overall Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(sportInput),
        new ActionRowBuilder().addComponents(descInput)
    );

    return interaction.showModal(modal);
}

// ============================================================
// LADDER FINAL MODAL
// ============================================================
async function handleLadderFinalModal(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const channelId = interaction.channel.id;

    const sport = interaction.fields.getTextInputValue('sport');
    const overallDescription = interaction.fields.getTextInputValue('overall_description') || 'Ladder Bet';

    if (!interaction.client.ladderCache) {
        return interaction.reply({
            content: '❌ Ladder session expired.',
            ephemeral: true
        });
    }

    const cache = interaction.client.ladderCache.get(userId);
    if (!cache || !cache.steps.length) {
        return interaction.reply({
            content: '❌ Ladder session expired.',
            ephemeral: true
        });
    }

    try {
        const timestamp = Date.now();
        const insertedIds = [];

        for (const step of cache.steps) {
            const payout = calculatePayout(step.risk, step.odds);
            const betId = randomUUID();
            insertedIds.push(betId);

            await pool.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
                [
                    betId,
                    userId,
                    username,
                    step.description,
                    sport,
                    step.risk,
                    step.odds,
                    payout,
                    timestamp
                ]
            );
        }

        // Fetch tracker channel if it exists
        const { rows: trackerRows } = await pool.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [userId]
        );

        const trackerChannelId = trackerRows[0]?.tracker_channel_id;

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
                                .setCustomId(`settle_win_${betId}`)
                                .setLabel('Win')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`settle_loss_${betId}`)
                                .setLabel('Loss')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId(`settle_push_${betId}`)
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

                        await trackerChannel.send({
                            embeds: [embed],
                            components: [settleRow, actionRow]
                        });
                    }
                }
            } catch (err) {
                console.error('Error posting to tracker channel:', err);
            }
        }

        interaction.client.ladderCache.delete(userId);

        const yesButton = new ButtonBuilder()
            .setCustomId(`add_link_yes_${randomUUID()}`)
            .setLabel('Yes')
            .setStyle(ButtonStyle.Success);

        const noButton = new ButtonBuilder()
            .setCustomId(`add_link_no_${randomUUID()}`)
            .setLabel('No')
            .setStyle(ButtonStyle.Secondary);

        const linkRow = new ActionRowBuilder().addComponents(yesButton, noButton);

        return interaction.reply({
            content: '✅ Ladder posted! You may also upload a screenshot in this channel within 3 minutes. Would you like to add a link?',
            components: [linkRow],
            ephemeral: true
        });

    } catch (err) {
        console.error('Error completing ladder:', err);
        return interaction.reply({
            content: '❌ Error posting ladder.',
            ephemeral: true
        });
    }
}

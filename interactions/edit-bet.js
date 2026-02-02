const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder
} = require('discord.js');
const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['edit_bet', 'edit_bet_modal'],

    async execute(interaction) {
        if (interaction.customId.startsWith('edit_bet_modal')) {
            return handleEditBetModal(interaction);
        }

        return handleEditBet(interaction);
    }
};

// ============================================================
// EDIT BET BUTTON
// ============================================================
async function handleEditBet(interaction) {
    const overrideId = process.env.ADMIN_OVERRIDE_ID;

    // Check if user is admin
    if (interaction.user.id !== overrideId) {
        return interaction.reply({
            content: '❌ Only admins can edit bets.',
            ephemeral: true
        });
    }

    const betId = interaction.customId.split('_')[2];

    // Fetch current bet details
    const { rows } = await db.query(
        `SELECT bet_description, sport, risk, odds FROM bets WHERE id = $1`,
        [betId]
    );

    if (rows.length === 0) {
        return interaction.reply({
            content: 'Bet not found.',
            ephemeral: true
        });
    }

    const { bet_description, sport, risk, odds } = rows[0];

    // Show modal with current values prefilled
    const modal = new ModalBuilder()
        .setCustomId(`edit_bet_modal_${betId}`)
        .setTitle('Edit Bet');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(bet_description)
        .setRequired(true);

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport')
        .setStyle(TextInputStyle.Short)
        .setValue(sport)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setValue(risk.toString())
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds')
        .setStyle(TextInputStyle.Short)
        .setValue(odds.toString())
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(sportInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput)
    );

    return interaction.showModal(modal);
}

// ============================================================
// EDIT BET MODAL
// ============================================================
async function handleEditBetModal(interaction) {
    const betId = interaction.customId.split('_')[3];

    const newDescription = interaction.fields.getTextInputValue('description');
    const newSport = interaction.fields.getTextInputValue('sport');
    const newRisk = parseFloat(interaction.fields.getTextInputValue('risk'));
    const newOdds = parseInt(interaction.fields.getTextInputValue('odds'), 10);

    // Calculate new payout
    const payout = calculatePayout(newRisk, newOdds);

    try {
        // Fetch bet details to get tracker message info and user_id
        const { rows: betRows } = await db.query(
            `SELECT tracker_message_id, user_id FROM bets WHERE id = $1`,
            [betId]
        );

        if (betRows.length === 0) {
            return interaction.reply({
                content: '❌ Bet not found.',
                ephemeral: true
            });
        }

        const { tracker_message_id, user_id } = betRows[0];

        // Fetch tracker channel from channel_notify_roles
        const { rows: channelRows } = await db.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [user_id]
        );

        if (channelRows.length === 0 || !channelRows[0].tracker_channel_id) {
            return interaction.reply({
                content: '❌ Tracker channel not found for this bet.',
                ephemeral: true
            });
        }

        const tracker_channel_id = channelRows[0].tracker_channel_id;

        // Update bet in database
        await db.query(
            `UPDATE bets 
             SET bet_description = $1, sport = $2, risk = $3, odds = $4, payout = $5
             WHERE id = $6`,
            [newDescription, newSport, newRisk, newOdds, payout, betId]
        );

        // Update the tracker message embed if it exists
        if (tracker_message_id && tracker_channel_id) {
            try {
                const trackerChannel = await interaction.client.channels.fetch(tracker_channel_id);
                if (trackerChannel) {
                    const message = await trackerChannel.messages.fetch(tracker_message_id);
                    if (message) {
                        const embed = new EmbedBuilder()
                            .setTitle(newDescription)
                            .setColor(0x3498db)
                            .addFields(
                                { name: 'Sport', value: newSport, inline: true },
                                { name: 'Risk', value: `${newRisk}u`, inline: true },
                                { name: 'Odds', value: newOdds.toString(), inline: true },
                                { name: 'Payout', value: `${payout}u`, inline: true }
                            )
                            .setTimestamp();

                        await message.edit({ embeds: [embed] });
                    }
                }
            } catch (err) {
                console.error('Error updating tracker message:', err);
            }
        }

        return interaction.reply({
            content: `✅ Bet updated successfully!`,
            ephemeral: true
        });
    } catch (err) {
        console.error('Error updating bet:', err);
        return interaction.reply({
            content: 'Error updating bet.',
            ephemeral: true
        });
    }
}

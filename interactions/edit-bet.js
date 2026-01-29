const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');
const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['edit_bet'],

    async execute(interaction) {
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
};

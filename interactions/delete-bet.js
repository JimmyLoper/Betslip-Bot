const db = require('../utils/db');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    customIds: ['delete_bet'],

    async execute(interaction) {
        const overrideId = process.env.ADMIN_OVERRIDE_ID;

        // Check if user is admin
        if (interaction.user.id !== overrideId) {
            return interaction.reply({
                content: '❌ Only admins can delete bets.',
                ephemeral: true
            });
        }

        const parts = interaction.customId.split('_');
        const betId = parts[2];

        // Show confirmation dialog
        const confirmBtn = new ButtonBuilder()
            .setCustomId(`delete_bet_confirm_${betId}`)
            .setLabel('Confirm Delete')
            .setStyle(ButtonStyle.Danger);

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`delete_bet_cancel_${betId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

        return interaction.update({
            content: '⚠️ Are you sure you want to delete this bet? This action cannot be undone.',
            components: [row],
            ephemeral: true
        });
    }
};

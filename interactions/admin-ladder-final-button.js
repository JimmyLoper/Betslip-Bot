const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    customIds: ['admin_ladder_final_sport'],
    async execute(interaction) {
        try {
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
        } catch (err) {
            console.error('Error in admin-ladder-final-button:', err);
            await interaction.reply({
                content: '❌ An error occurred showing the final step.',
                ephemeral: true
            });
        }
    }
};

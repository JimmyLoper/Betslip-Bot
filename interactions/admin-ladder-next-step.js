const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    customIds: ['admin_ladder_next_step'],
    async execute(interaction) {
        try {
            const customIdParts = interaction.customId.split('_');
            const stepNumber = parseInt(customIdParts[4], 10);
            const totalSteps = parseInt(customIdParts[5], 10);

            // Show the next step modal
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
};

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    customIds: ['admin_ladder_step_modal'],
    async execute(interaction) {
        try {
            const customIdParts = interaction.customId.split('_');
            const stepNumber = parseInt(customIdParts[4], 10);
            const totalSteps = parseInt(customIdParts[5], 10);

            const description = interaction.fields.getTextInputValue('description');
            const risk = parseFloat(interaction.fields.getTextInputValue('risk'));
            const odds = parseFloat(interaction.fields.getTextInputValue('odds'));
            const messageId = interaction.fields.getTextInputValue('message_id');

            // Validate inputs
            if (isNaN(risk) || isNaN(odds)) {
                return interaction.reply({
                    content: '❌ Risk and odds must be numbers.',
                    ephemeral: true
                });
            }

            // Get ladder cache
            const cache = interaction.client.ladderCache?.get(interaction.user.id);
            if (!cache) {
                return interaction.reply({
                    content: '❌ Ladder session expired.',
                    ephemeral: true
                });
            }

            // Store this step
            cache.steps.push({ description, risk, odds, messageId, stepNumber });

            // If this is the final step, show "Complete Ladder" button
            if (stepNumber === totalSteps) {
                const completeButton = new ButtonBuilder()
                    .setCustomId('admin_ladder_final_sport')
                    .setLabel('Complete Ladder')
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder().addComponents(completeButton);

                return interaction.reply({
                    content: `✅ Step ${stepNumber} saved. Click **Complete Ladder** to finish.`,
                    components: [row],
                    ephemeral: true
                });
            }

            // Otherwise, show "Next Step" button
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
};
const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

module.exports = {
    customIds: ['ladder_step_modal'], // prefix match handled manually

    async execute(interaction) {
        const customId = interaction.customId; 
        // Format: ladder_step_modal_<step>_<total>

        const parts = customId.split('_'); 
        const stepNumber = parseInt(parts[3], 10);
        const totalSteps = parseInt(parts[4], 10);

        // Extract modal inputs
        const description = interaction.fields.getTextInputValue('description');
        const risk = interaction.fields.getTextInputValue('risk');
        const odds = interaction.fields.getTextInputValue('odds');

        // Initialize cache if needed
        if (!interaction.client.ladderCache) {
            interaction.client.ladderCache = new Map();
        }

        const userId = interaction.user.id;

        // Retrieve existing steps or create new
        let steps = interaction.client.ladderCache.get(userId) || [];

        // Store this step
        steps.push({
            step: stepNumber,
            description,
            risk,
            odds
        });

        interaction.client.ladderCache.set(userId, steps);

        // If more steps remain → show button for next step
        if (stepNumber < totalSteps) {
            const button = new ButtonBuilder()
                .setCustomId(`ladder_next_step_${stepNumber + 1}_${totalSteps}`)
                .setLabel(`Next Step/Bet (${stepNumber + 1}/${totalSteps})`)
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            return interaction.reply({
                content: `✅ Step/Bet ${stepNumber} saved. Click below for the next step.`,
                components: [row],
                flags: 'Ephemeral'
            });
        }

        // If this was the last step → show final button
        const finalButton = new ButtonBuilder()
            .setCustomId(`ladder_final_step`)
            .setLabel('Complete Ladder/Multiple Bets')
            .setStyle(ButtonStyle.Success);

        const finalRow = new ActionRowBuilder().addComponents(finalButton);

        return interaction.reply({
            content: `✅ Step/Bet ${stepNumber} saved. Click below to complete the ladder/multiple bets.`,
            components: [finalRow],
            flags: 'Ephemeral'
        });
    }
};
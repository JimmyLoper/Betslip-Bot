const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
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

        // If more steps remain → open next modal
        if (stepNumber < totalSteps) {
            return showNextStepModal(interaction, stepNumber + 1, totalSteps);
        }

        // If this was the last step → open final modal
        return showFinalModal(interaction);
    }
};

// ------------------------------------------------------------
// SHOW NEXT STEP MODAL
// ------------------------------------------------------------
async function showNextStepModal(interaction, stepNumber, totalSteps) {
    const modal = new ModalBuilder()
        .setCustomId(`ladder_step_modal_${stepNumber}_${totalSteps}`)
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

    return interaction.showModal(modal);
}

// ------------------------------------------------------------
// SHOW FINAL MODAL (sport, link, screenshot)
// ------------------------------------------------------------
async function showFinalModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('ladder_final_modal')
        .setTitle('Overall Ladder Details');

    const overallInput = new TextInputBuilder()
        .setCustomId('overall_description')
        .setLabel('Overall Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const screenshotInput = new TextInputBuilder()
        .setCustomId('screenshot')
        .setLabel('Optional Screenshot URL')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(overallInput),
        new ActionRowBuilder().addComponents(sportInput),
        new ActionRowBuilder().addComponents(screenshotInput)
    );

    return interaction.showModal(modal);
}
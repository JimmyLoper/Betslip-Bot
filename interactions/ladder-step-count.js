const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

module.exports = {
    customIds: ['ladder_step_count'],

    async execute(interaction) {
        const selected = interaction.values[0]; // "2", "3", "4", "5"
        const totalSteps = parseInt(selected, 10);

        return showLadderStepModal(interaction, 1, totalSteps);
    }
};

// ---------------------------------------------------
// SHOW MODAL FOR A SPECIFIC STEP
// ---------------------------------------------------
async function showLadderStepModal(interaction, stepNumber, totalSteps) {
    const modal = new ModalBuilder()
        .setCustomId(`ladder_step_modal_${stepNumber}_${totalSteps}`)
        .setTitle(`Step/Bet ${stepNumber}`);

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel(`Description for Step/Bet ${stepNumber}`)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel(`Risk for Step/Bet ${stepNumber}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel(`Odds for Step/Bet ${stepNumber}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput)
    );

    return interaction.showModal(modal);
}
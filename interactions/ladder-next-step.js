const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');

module.exports = {
    customIds: ['ladder_next_step'],
    async execute(interaction) {
        const parts = interaction.customId.split('_');
        const stepNumber = parseInt(parts[3], 10);
        const totalSteps = parseInt(parts[4], 10);

        // Show the next step modal
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
};

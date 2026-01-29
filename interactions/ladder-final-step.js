const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');

module.exports = {
    customIds: ['ladder_final_step'],

    async execute(interaction) {
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

        modal.addComponents(
            new ActionRowBuilder().addComponents(overallInput),
            new ActionRowBuilder().addComponents(sportInput)
        );

        return interaction.showModal(modal);
    }
};

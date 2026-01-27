const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ------------------------------------------------------------
// SETTLE SELECT HANDLER (EPHEMERAL REPLACE)
// ------------------------------------------------------------
module.exports = {
    customIds: ['settle_select'],

    async execute(interaction) {
        const userId = interaction.user.id;
        const [_, __, ownerId] = interaction.customId.split('_');

        if (ownerId !== userId) {
            return interaction.reply({
                content: 'This menu is not for you.',
                ephemeral: true
            });
        }

        const betId = interaction.values[0];

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_result_win_${betId}`)
                .setLabel('Win')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`settle_result_loss_${betId}`)
                .setLabel('Loss')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`settle_result_push_${betId}`)
                .setLabel('Push')
                .setStyle(ButtonStyle.Secondary)
        );

        // REPLACE previous ephemeral message
        return interaction.update({
            content: 'Select the result:',
            components: [row],
            ephemeral: true
        });
    }
};
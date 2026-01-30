// ============================================================
// SETTLE SELECT HANDLER (EPHEMERAL REPLACE)
// ============================================================
module.exports = {
    customIds: ['settle_select', 'settle_select_page2', 'settle_select_page3'],

    async execute(interaction) {
        const userId = interaction.user.id;
        const parts = interaction.customId.split('_');
        const ownerId = parts[parts.length - 1]; // Last part is always the userId

        if (ownerId !== userId) {
            return interaction.reply({
                content: 'This menu is not for you.',
                ephemeral: true
            });
        }

        const betId = interaction.values[0];

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_win_${betId}`)
                .setLabel('Win')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`settle_loss_${betId}`)
                .setLabel('Loss')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`settle_push_${betId}`)
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
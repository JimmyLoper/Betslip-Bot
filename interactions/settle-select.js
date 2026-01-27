const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

module.exports = {
    customId: 'settle_select',

    async execute(interaction) {
        const betId = interaction.values[0]; // selected bet ID

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

        return interaction.reply({
            content: 'How did this bet grade?',
            components: [row],
            ephemeral: true
        });
    }
};
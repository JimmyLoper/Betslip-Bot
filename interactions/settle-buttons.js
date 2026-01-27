const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

module.exports = {
    customIds: ['settle_win', 'settle_loss', 'settle_push'], //IDs for routing (win/loss/push share handler)

    async execute(interaction) {
        const parts = interaction.customId.split('_');

        // settle_win_<betId>
        // settle_loss_<betId>
        // settle_push_<betId>
        const result = parts[1]; // win / loss / push
        const betId = parts[2];

        // Ask if they want to send a message
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_msg_yes_${betId}_${result}`)
                .setLabel('Yes')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(`settle_msg_no_${betId}_${result}`)
                .setLabel('No')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: 'Send a message to the original bet post?',
            components: [row],
            ephemeral: true
        });
    }
};
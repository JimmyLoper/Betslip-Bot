const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

module.exports = {
    customIds: ['settle_win', 'settle_loss', 'settle_push'],

    async execute(interaction) {
        const parts = interaction.customId.split('_');

        // settle_win_<betId>
        // settle_loss_<betId>
        // settle_push_<betId>
        const result = parts[1]; // win / loss / push
        const betId = parts[2];

        // ------------------------------------------------------------
        // WIN → ask if they want to send a message
        // ------------------------------------------------------------
        if (result === 'win') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`settle_msg_yes_${betId}_${result}`)
                    .setLabel('Send Message')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId(`settle_msg_no_${betId}_${result}`)
                    .setLabel('Settle Silently')
                    .setStyle(ButtonStyle.Secondary)
            );

            return interaction.update({
                content: `Do you want to send a message for this **WIN**?`,
                components: [row],
                ephemeral: true
            });
        }

        // ------------------------------------------------------------
        // LOSS or PUSH → ask if they want to send a message
        // ------------------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_msg_yes_${betId}_${result}`)
                .setLabel('Send Message')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(`settle_msg_no_${betId}_${result}`)
                .setLabel('Settle Silently')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: `Do you want to send a message for this **${result.toUpperCase()}**?`,
            components: [row],
            ephemeral: true
        });
    }
};
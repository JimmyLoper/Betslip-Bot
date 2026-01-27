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
        // WIN → always require a message → open modal immediately
        // ------------------------------------------------------------
        if (result === 'win') {
            await interaction.update({
                content: `Enter a message for this **WIN** (modal opening)...`,
                components: [],
                ephemeral: true
            });

            const modal = new ModalBuilder()
                .setCustomId(`settle_modal_${betId}_${result}`)
                .setTitle('Settle Bet Message');

            const input = new TextInputBuilder()
                .setCustomId('settle_message_input')
                .setLabel('Message to send to the bet post')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));

            return interaction.showModal(modal);
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
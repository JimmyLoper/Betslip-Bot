const pool = require('../utils/db');
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');

module.exports = {
    customIds: ['settle_msg'],

    async execute(interaction) {
        const parts = interaction.customId.split('_');

        // settle_msg_yes_<betId>_<result>
        // settle_msg_no_<betId>_<result>
        const action = parts[2]; // yes / no
        const betId = parts[3];
        const result = parts[4];
        const graderId = interaction.user.id;

        // ------------------------------------------------------------
        // NO → silent settlement
        // ------------------------------------------------------------
        if (action === 'no') {
            await pool.query(
                `UPDATE bets
                 SET result = $1,
                     graded_by = $2,
                     graded_at = $3
                 WHERE id = $4`,
                [result, graderId, Date.now(), betId]
            );

            return interaction.update({
                content: `Bet settled as **${result.toUpperCase()}**.`,
                components: [],
                ephemeral: true
            });
        }

        // ------------------------------------------------------------
        // YES → open modal
        // ------------------------------------------------------------
        await interaction.update({
            content: `Enter a message for this **${result.toUpperCase()}** (modal opening)...`,
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
};
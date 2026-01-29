const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');

module.exports = {
    customIds: ['add_link_yes', 'add_link_no'],

    async execute(interaction) {
        const customId = interaction.customId;
        const parts = customId.split('_');
        const action = parts[2]; // 'yes' or 'no'
        const betId = parts[3];

        if (action === 'no') {
            // Simply update the message to show they declined
            return interaction.update({
                content: '❌ Skipped adding a link.',
                components: [],
                ephemeral: true
            });
        }

        // Try to delete the button message
        try {
            await interaction.message.delete();
        } catch (err) {
            // ignore unknown message error
            if (err && err.code !== 10008) console.error('Could not delete link prompt message:', err);
        }

        // Show modal to add link
        // NOTE: showModal() auto-acknowledges the interaction, do NOT defer before this
        const modal = new ModalBuilder()
            .setCustomId(`add_bet_link_${betId}`)
            .setTitle('Add Link to Bet');

        const linkInput = new TextInputBuilder()
            .setCustomId('link')
            .setLabel('Bet Link (URL)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(linkInput)
        );

        return interaction.showModal(modal);
    }
};

const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const db = require('../utils/db');

module.exports = {
    customIds: ['add_link_yes', 'add_link_no', 'add_bet_link'],

    async execute(interaction) {
        if (interaction.customId.startsWith('add_bet_link')) {
            return handleAddLinkModal(interaction);
        }

        return handleAddLinkButtons(interaction);
    }
};

// ============================================================
// ADD LINK YES/NO BUTTONS
// ============================================================
async function handleAddLinkButtons(interaction) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const action = parts[2]; // 'yes' or 'no'
    const betId = parts.slice(3).join('_');

    if (action === 'no') {
        return interaction.update({
            content: 'Skipped adding a link.',
            components: [],
            ephemeral: true
        });
    }

    // YES - show modal for link input
    const modal = new ModalBuilder()
        .setCustomId(`add_bet_link_${betId}`)
        .setTitle('Add Link to Bet');

    const linkInput = new TextInputBuilder()
        .setCustomId('link')
        .setLabel('URL (e.g., https://example.com)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(linkInput));

    return interaction.showModal(modal);
}

// ============================================================
// ADD LINK MODAL
// ============================================================
async function handleAddLinkModal(interaction) {
    const betId = interaction.customId.split('_').slice(3).join('_');
    const link = interaction.fields.getTextInputValue('link');

    try {
        // Fetch bet's message info from DB
        const { rows } = await db.query(
            `SELECT message_id, channel_id FROM bets WHERE id = $1`,
            [betId]
        );

        if (rows.length === 0) {
            return interaction.reply({
                content: '❌ Bet not found.',
                ephemeral: true
            });
        }

        const { message_id, channel_id } = rows[0];

        // Fetch the original bet message and add link button
        const channel = await interaction.client.channels.fetch(channel_id);
        const message = await channel.messages.fetch(message_id);

        if (!message) {
            return interaction.reply({
                content: '❌ Original message not found.',
                ephemeral: true
            });
        }

        // Create link button
        const linkButton = new ButtonBuilder()
            .setLabel('Link')
            .setStyle(ButtonStyle.Link)
            .setURL(link)
            .setEmoji('🔗');

        const linkRow = new ActionRowBuilder().addComponents(linkButton);

        // Update message with link button
        const newComponents = [...message.components, linkRow];
        await message.edit({ components: newComponents });

        return interaction.reply({
            content: '✅ Link added successfully!',
            ephemeral: true
        });

    } catch (err) {
        console.error('Error adding link:', err);
        return interaction.reply({
            content: '❌ Error adding link to bet.',
            ephemeral: true
        });
    }
}

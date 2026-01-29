const db = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

module.exports = {
    customIds: ['add_bet_link'],

    async execute(interaction) {
        // customId format: add_bet_link_${betId}
        const betId = interaction.customId.split('_').slice(3).join('_');
        const link = interaction.fields.getTextInputValue('link');

        if (!link) {
            return interaction.reply({
                content: 'Link cannot be empty.',
                flags: 'Ephemeral'
            });
        }

        try {
            // Fetch the bet to get message_id and channel_id
            const { rows } = await db.query(
                `SELECT message_id, channel_id FROM bets WHERE id = $1`,
                [betId]
            );

            if (rows.length > 0 && rows[0].message_id) {
                try {
                    const channel = await interaction.client.channels.fetch(rows[0].channel_id);
                    const message = await channel.messages.fetch(rows[0].message_id);

                    // Add link button to the message
                    const linkButton = new ButtonBuilder()
                        .setLabel('Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(link)
                        .setEmoji('🔗');

                    const linkRow = new ActionRowBuilder().addComponents(linkButton);

                    // Update message with link button
                    await message.edit({
                        components: [linkRow]
                    });
                } catch (err) {
                    console.error('Error updating message with link:', err);
                }
            }

            // Acknowledge with success message
            return interaction.reply({
                content: '✅ Link added successfully!',
                flags: 'Ephemeral'
            });

        } catch (err) {
            console.error('Error adding link to bet:', err);
            return interaction.reply({
                content: 'Error adding link to bet.',
                flags: 'Ephemeral'
            });
        }
    }
};

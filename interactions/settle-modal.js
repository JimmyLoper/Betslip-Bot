const pool = require('../utils/db');

module.exports = {
    customIds: ['settle_modal'],

    async execute(interaction) {
        // settle_modal_<betId>_<result>
        const parts = interaction.customId.split('_');
        const betId = parts[2];
        const result = parts[3];
        const graderId = interaction.user.id;

        // Get message from modal input
        const userMessage = interaction.fields.getTextInputValue('settle_message_input');

        // Fetch original betslip message_id + channel_id
        const { rows } = await pool.query(
            `SELECT message_id, channel_id
             FROM bets
             WHERE id = $1`,
            [betId]
        );

        const messageId = rows[0]?.message_id;
        const channelId = rows[0]?.channel_id;

        // Update DB with result + grading info
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        // Reply to original bet slip
        if (messageId && channelId) {
            try {
                const channel = await interaction.client.channels.fetch(channelId);
                const original = await channel.messages.fetch(messageId);
                await original.reply({
                    content: userMessage,
                    allowedMentions: {
                        parse: ['roles', 'everyone']
                    }
            });
            } catch (err) {
                console.error('Failed to reply to original bet post:', err);
            }
        }

        return interaction.reply({
            content: `Bet settled as **${result.toUpperCase()}** and message sent.`,
            ephemeral: true
        });
    }
};
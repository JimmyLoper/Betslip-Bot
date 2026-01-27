const pool = require('../utils/db');

module.exports = {
    customIds: ['settle_modal'],

    async execute(interaction) {
        // settle_modal_<betId>_<result>
        const parts = interaction.customId.split('_');
        const betId = parts[2];
        const result = parts[3];
        const graderId = interaction.user.id;

        // Message from modal
        const userMessage = interaction.fields.getTextInputValue('settle_message_input');

        // Fetch original betslip message + channel
        const { rows } = await pool.query(
            `SELECT message_id, channel_id
             FROM bets
             WHERE id = $1`,
            [betId]
        );

        const messageId = rows[0]?.message_id;
        const channelId = rows[0]?.channel_id;

        // Fetch notify role for this channel
        const notifyQuery = await pool.query(
            `SELECT notify_role_id
             FROM channel_notify_roles
             WHERE channel_id = $1`,
            [channelId]
        );

        const notifyRoleId = notifyQuery.rows[0]?.notify_role_id;

        // Update DB with result + grading info
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        // Send auto-ping reply
        if (messageId && channelId) {
            try {
                const channel = await interaction.client.channels.fetch(channelId);
                const original = await channel.messages.fetch(messageId);

                // Build final message with auto-ping
                let finalMessage = userMessage;
                if (notifyRoleId) {
                    finalMessage = `<@&${notifyRoleId}> ${userMessage}`;
                }

                await original.reply({
                    content: finalMessage,
                    allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
                });

            } catch (err) {
                console.error('Failed to reply to original bet post:', err);
            }
        }

        return interaction.update({
            content: `Bet settled as **${result.toUpperCase()}** and message sent.`,
            ephemeral: true
        });
    }
};
const pool = require('../utils/db');

module.exports = {
    customId: 'settle_msg',

    async execute(interaction) {
        const parts = interaction.customId.split('_');

        // settle_msg_yes_<betId>_<result>
        // settle_msg_no_<betId>_<result>
        const action = parts[2]; // yes / no
        const betId = parts[3];
        const result = parts[4]; // win / loss / push

        // If NO → update DB and finish
        if (action === 'no') {
            await pool.query(
                `UPDATE bets SET result = $1 WHERE id = $2`,
                [result, betId]
            );

            return interaction.reply({
                content: `Bet settled as **${result.toUpperCase()}**.`,
                ephemeral: true
            });
        }

        // If YES → ask for message
        await interaction.reply({
            content: `Type the message you want to send. You have 2 minutes.`,
            ephemeral: true
        });

        // Wait for next message from the same user
        const msg = await interaction.channel.awaitMessages({
            filter: m => m.author.id === interaction.user.id,
            max: 1,
            time: 120000
        });

        if (!msg.size) {
            return interaction.followUp({
                content: 'Timed out. Bet was NOT settled.',
                ephemeral: true
            });
        }

        const userMessage = msg.first().content;

        // Fetch original betslip message_id
        const { rows } = await pool.query(
            `SELECT message_id FROM bets WHERE id = $1`,
            [betId]
        );

        const messageId = rows[0]?.message_id;

        // Update DB
        await pool.query(
            `UPDATE bets SET result = $1 WHERE id = $2`,
            [result, betId]
        );

        // Reply to original betslip
        if (messageId) {
            try {
                const channel = interaction.channel;
                const original = await channel.messages.fetch(messageId);
                await original.reply(userMessage);
            } catch (err) {
                console.error('Failed to reply to original post:', err);
            }
        }

        return interaction.followUp({
            content: `Bet settled as **${result.toUpperCase()}** and message sent.`,
            ephemeral: true
        });
    }
};
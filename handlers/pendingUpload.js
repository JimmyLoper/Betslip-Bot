const db = require('../utils/db');

// Listen for attachment messages from users who are in pending upload state
async function handlePendingUpload(message, client) {
    try {
        if (message.author?.bot) return;

        const pending = client.pendingUploads.get(message.author.id);
        if (!pending) return;

        if (!message.attachments || message.attachments.size === 0) return;

        // Use the first attachment
        const attachment = message.attachments.first();
        if (!attachment) return;

        const betId = pending.betId;

        // Fetch bet record to find the original message
        const { rows } = await db.query(
            `SELECT message_id, channel_id FROM bets WHERE id = $1`,
            [betId]
        );

        const row = rows[0];
        if (!row || !row.message_id || !row.channel_id) {
            // cleanup
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel) {
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        const original = await channel.messages.fetch(row.message_id).catch(() => null);
        if (!original) {
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        // Edit the original message to include the attachment
        try {
            await original.edit({
                content: original.content,
                components: original.components,
                files: [attachment.url]
            });
        } catch (err) {
            console.error('Failed to attach screenshot to bet message:', err);
        }

        // Attempt to delete the user's upload message to keep channel clean
        try {
            await message.delete();
        } catch (err) {
            // ignore delete errors
        }

        // Clear pending state
        clearTimeout(pending.timeout);
        client.pendingUploads.delete(message.author.id);

        // Try to DM the user a confirmation
        try {
            await message.author.send('Screenshot attached to your bet.');
        } catch (err) {
            // ignore DM failures
        }

    } catch (err) {
        console.error('Error handling pending upload message:', err);
    }
}

module.exports = { handlePendingUpload };

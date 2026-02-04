const {
    EmbedBuilder
} = require('discord.js');
const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['admin_editbet_modal'],

    async execute(interaction) {
        if (interaction.customId.startsWith('admin_editbet_modal')) {
            return handleAdminEditBetModal(interaction);
        }
    }
};

// ============================================================
// ADMIN EDIT BET MODAL
// ============================================================
async function handleAdminEditBetModal(interaction) {
    const betId = interaction.customId.split('_')[3];

    const newDescription = interaction.fields.getTextInputValue('description');
    const newSport = interaction.fields.getTextInputValue('sport');
    const newRisk = parseFloat(interaction.fields.getTextInputValue('risk'));
    const newOdds = parseInt(interaction.fields.getTextInputValue('odds'), 10);
    const newResult = interaction.fields.getTextInputValue('result').toLowerCase();

    // Validate result
    if (!['pending', 'win', 'loss', 'push'].includes(newResult)) {
        return interaction.reply({
            content: '❌ Invalid result. Must be: pending, win, loss, or push.',
            ephemeral: true
        });
    }

    // Calculate new payout
    const newPayout = calculatePayout(newRisk, newOdds);

    try {
        // Fetch bet details to get tracker message info and user_id
        const { rows: betRows } = await db.query(
            `SELECT tracker_message_id, user_id, result FROM bets WHERE id = $1`,
            [betId]
        );

        if (betRows.length === 0) {
            return interaction.reply({
                content: '❌ Bet not found.',
                ephemeral: true
            });
        }

        const { tracker_message_id, user_id, result: oldResult } = betRows[0];

        // Fetch tracker channel from capper_info
        const { rows: channelRows } = await db.query(
            `SELECT tracker_channel_id FROM capper_info WHERE user_id = $1`,
            [user_id]
        );

        if (channelRows.length === 0 || !channelRows[0].tracker_channel_id) {
            return interaction.reply({
                content: '❌ Tracker channel not found for this bet.',
                ephemeral: true
            });
        }

        const tracker_channel_id = channelRows[0].tracker_channel_id;

        // Update bet in database
        await db.query(
            `UPDATE bets 
             SET bet_description = $1, sport = $2, risk = $3, odds = $4, payout = $5, result = $6
             WHERE id = $7`,
            [newDescription, newSport, newRisk, newOdds, newPayout, newResult, betId]
        );

        // Update the tracker message embed and content if it exists
        if (tracker_message_id && tracker_channel_id) {
            try {
                const trackerChannel = await interaction.client.channels.fetch(tracker_channel_id);
                if (trackerChannel) {
                    const message = await trackerChannel.messages.fetch(tracker_message_id);
                    if (message) {
                        const embed = new EmbedBuilder()
                            .setTitle(newDescription)
                            .setColor(0x3498db)
                            .addFields(
                                { name: 'Sport', value: newSport, inline: true },
                                { name: 'Risk', value: `${newRisk}u`, inline: true },
                                { name: 'Odds', value: newOdds.toString(), inline: true },
                                { name: 'Payout', value: `${newPayout}u`, inline: true }
                            )
                            .setTimestamp();

                        // Handle message content update based on result change
                        let currentContent = message.content || '';
                        
                        // Remove any existing settlement text (everything starting with \n\nSettled)
                        let baseContent = currentContent.split('Settled')[0].trim();
                        
                        // Build new content based on result
                        let newContent = baseContent;
                        if (newResult !== 'pending') {
                            newContent = baseContent + `Settled as a **${newResult.toUpperCase()}**`;
                        }

                        await message.edit({
                            content: newContent,
                            embeds: [embed]
                        });
                    }
                }
            } catch (err) {
                console.error('Error updating tracker message:', err);
            }
        }

        return interaction.reply({
            content: `✅ Bet updated successfully!`,
            ephemeral: true
        });
    } catch (err) {
        console.error('Error updating bet:', err);
        return interaction.reply({
            content: 'Error updating bet.',
            ephemeral: true
        });
    }
}

const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    customIds: ['edit_bet_modal'],

    async execute(interaction) {
        const betId = interaction.customId.split('_')[3];

        const newDescription = interaction.fields.getTextInputValue('description');
        const newSport = interaction.fields.getTextInputValue('sport');
        const newRisk = parseFloat(interaction.fields.getTextInputValue('risk'));
        const newOdds = parseInt(interaction.fields.getTextInputValue('odds'), 10);

        // Calculate new payout
        const payout = calculatePayout(newRisk, newOdds);

        try {
            // Fetch bet details to get tracker message info
            const { rows: betRows } = await db.query(
                `SELECT message_id, channel_id FROM bets WHERE id = $1`,
                [betId]
            );

            if (betRows.length === 0) {
                return interaction.reply({
                    content: '❌ Bet not found.',
                    ephemeral: true
                });
            }

            const { message_id, channel_id } = betRows[0];

            // Update bet in database
            await db.query(
                `UPDATE bets 
                 SET bet_description = $1, sport = $2, risk = $3, odds = $4, payout = $5
                 WHERE id = $6`,
                [newDescription, newSport, newRisk, newOdds, payout, betId]
            );

            // Update the tracker message embed if it exists
            if (message_id && channel_id) {
                try {
                    const trackerChannel = await interaction.client.channels.fetch(channel_id);
                    if (trackerChannel) {
                        const message = await trackerChannel.messages.fetch(message_id);
                        if (message) {
                            const embed = new EmbedBuilder()
                                .setTitle(newDescription)
                                .setColor(0x3498db)
                                .addFields(
                                    { name: 'Sport', value: newSport, inline: true },
                                    { name: 'Risk', value: `${newRisk}u`, inline: true },
                                    { name: 'Odds', value: newOdds.toString(), inline: true },
                                    { name: 'Payout', value: `${payout}u`, inline: true }
                                )
                                .setTimestamp();

                            await message.edit({ embeds: [embed] });
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
};

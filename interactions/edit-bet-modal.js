const db = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');

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
            // Update bet in database
            await db.query(
                `UPDATE bets 
                 SET bet_description = $1, sport = $2, risk = $3, odds = $4, payout = $5
                 WHERE id = $6`,
                [newDescription, newSport, newRisk, newOdds, payout, betId]
            );

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

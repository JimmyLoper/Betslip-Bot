const db = require('../utils/db');

module.exports = {
    customIds: ['delete_bet_confirm', 'delete_bet_cancel'],

    async execute(interaction) {
        const overrideId = process.env.ADMIN_OVERRIDE_ID;

        // Check if user is admin
        if (interaction.user.id !== overrideId) {
            return interaction.reply({
                content: '❌ Only admins can delete bets.',
                ephemeral: true
            });
        }

        const parts = interaction.customId.split('_');
        const action = parts[2]; // 'confirm' or 'cancel'
        const betId = parts[3];

        if (action === 'cancel') {
            return interaction.update({
                content: '❌ Delete cancelled.',
                components: [],
                ephemeral: true
            });
        }

        // Delete the bet
        try {
            await db.query('DELETE FROM bets WHERE id = $1', [betId]);

            return interaction.update({
                content: '✅ Bet deleted successfully.',
                components: [],
                ephemeral: true
            });
        } catch (err) {
            console.error('Error deleting bet:', err);
            return interaction.update({
                content: '❌ Error deleting bet.',
                components: [],
                ephemeral: true
            });
        }
    }
};

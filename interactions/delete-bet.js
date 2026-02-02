const db = require('../utils/db');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    customIds: ['delete_bet', 'delete_bet_confirm', 'delete_bet_cancel'],

    async execute(interaction) {
        if (interaction.customId.startsWith('delete_bet_confirm') || interaction.customId.startsWith('delete_bet_cancel')) {
            return handleDeleteConfirm(interaction);
        }

        return handleDeleteBet(interaction);
    }
};

// ============================================================
// DELETE BET BUTTON
// ============================================================
async function handleDeleteBet(interaction) {
    const overrideId = process.env.ADMIN_OVERRIDE_ID;

    // Check if user is admin
    if (interaction.user.id !== overrideId) {
        return interaction.reply({
            content: '❌ Only admins can delete bets.',
            ephemeral: true
        });
    }

    const parts = interaction.customId.split('_');
    const betId = parts[2];

    // Show confirmation dialog
    const confirmBtn = new ButtonBuilder()
        .setCustomId(`delete_bet_confirm_${betId}`)
        .setLabel('Confirm Delete')
        .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
        .setCustomId(`delete_bet_cancel_${betId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    return interaction.update({
        content: '⚠️ Are you sure you want to delete this bet? This action cannot be undone.',
        components: [row],
        ephemeral: true
    });
}

// ============================================================
// DELETE BET CONFIRMATION
// ============================================================
async function handleDeleteConfirm(interaction) {
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
        // Rebuild original buttons
        const settleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_tracker_win_${betId}`)
                .setLabel('Win')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_loss_${betId}`)
                .setLabel('Loss')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`settle_tracker_push_${betId}`)
                .setLabel('Push')
                .setStyle(ButtonStyle.Secondary)
        );

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_bet_${betId}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`delete_bet_${betId}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
        );

        return interaction.update({
            content: '',
            components: [settleRow, actionRow]
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

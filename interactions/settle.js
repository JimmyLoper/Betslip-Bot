const pool = require('../utils/db');
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    customIds: [
        'settle_win', 'settle_loss', 'settle_push',
        'settle_tracker_win', 'settle_tracker_loss', 'settle_tracker_push',
        'settle_admin_select', 'settle_admin_select_page2', 'settle_admin_select_page3',
        'settle_admin_win', 'settle_admin_loss', 'settle_admin_push',
        'settle_select', 'settle_select_page2', 'settle_select_page3'
    ],

    async execute(interaction) {
        const customId = interaction.customId;

        // ===== ADMIN SETTLE SELECT MENUS =====
        if (customId.startsWith('settle_admin_select')) {
            return handleAdminSettleSelect(interaction);
        }

        // ===== ADMIN SETTLE BUTTONS (WIN/LOSS/PUSH) - Direct settle =====
        if (customId.startsWith('settle_admin_win') || customId.startsWith('settle_admin_loss') || customId.startsWith('settle_admin_push')) {
            return handleAdminSettleButtons(interaction);
        }

        // ===== TRACKER BUTTONS (WIN/LOSS/PUSH) - Direct settle =====
        if (customId.startsWith('settle_tracker_win') || customId.startsWith('settle_tracker_loss') || customId.startsWith('settle_tracker_push')) {
            return handleTrackerButtons(interaction);
        }

        // ===== SETTLE BUTTONS (WIN/LOSS/PUSH) - Direct settle, no message option =====
        if (customId.startsWith('settle_win') || customId.startsWith('settle_loss') || customId.startsWith('settle_push')) {
            return handleSettleButtons(interaction);
        }

        // ===== SETTLE SELECT MENU (ALL PAGES) =====
        if (customId === 'settle_select' || customId === 'settle_select_page2' || customId === 'settle_select_page3') {
            return handleSettleSelect(interaction);
        }
    }
};

// ============================================================
// ADMIN SETTLE SELECT MENU - Shows win/loss/push buttons
// ============================================================
async function handleAdminSettleSelect(interaction) {
    const userId = interaction.user.id;
    const parts = interaction.customId.split('_');
    const ownerId = parts[parts.length - 1]; // Last part is userId

    if (ownerId !== userId) {
        return interaction.reply({
            content: 'This menu is not for you.',
            ephemeral: true
        });
    }

    const betId = interaction.values[0];

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`settle_admin_win_${betId}`)
            .setLabel('Win')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`settle_admin_loss_${betId}`)
            .setLabel('Loss')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`settle_admin_push_${betId}`)
            .setLabel('Push')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({
        content: 'Select the result:',
        components: [row],
        ephemeral: true
    });
}

// ============================================================
// TRACKER BUTTONS (WIN/LOSS/PUSH) - Direct settle, no message prompt
// ============================================================
async function handleTrackerButtons(interaction) {
    // Acknowledge interaction immediately to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const parts = interaction.customId.split('_');
    // settle_tracker_win_<betId> or settle_tracker_loss_<betId> or settle_tracker_push_<betId>
    // OR old format: settle_win_<betId> or settle_loss_<betId> or settle_push_<betId>
    let result, betId;
    
    if (parts[0] === 'settle' && (parts[1] === 'tracker')) {
        result = parts[2]; // win / loss / push
        betId = parts.slice(3).join('_');
    } else {
        result = parts[1]; // win / loss / push
        betId = parts.slice(2).join('_');
    }
    
    const graderId = interaction.user.id;

    try {
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        // Remove buttons from the original tracker message and add settlement info
        const currentContent = interaction.message.content || '';
        const settledText = `\n\nSettled as a **${result.toUpperCase()}**`;
        
        await interaction.message.edit({
            content: currentContent + settledText,
            components: []
        });

        return interaction.editReply({
            content: `Bet settled as a **${result.toUpperCase()}**.`
        });
    } catch (err) {
        console.error('Error in handleTrackerButtons:', err);
        return interaction.editReply({
            content: '❌ Error settling bet.'
        });
    }
}

// ============================================================
// ADMIN SETTLE BUTTONS (WIN/LOSS/PUSH) - Direct settle, no message prompt
// ============================================================
async function handleAdminSettleButtons(interaction) {
    // Acknowledge interaction immediately to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const parts = interaction.customId.split('_');
    // settle_admin_win_<betId> or settle_admin_loss_<betId> or settle_admin_push_<betId>
    const result = parts[2]; // win / loss / push
    const betId = parts.slice(3).join('_');
    const graderId = interaction.user.id;

    try {
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        // Just update the interaction, don't modify any messages
        return interaction.editReply({
            content: `✅ Bet settled as **${result.toUpperCase()}**.`
        });
    } catch (err) {
        console.error('Error in handleAdminSettleButtons:', err);
        return interaction.editReply({
            content: '❌ Error settling bet.'
        });
    }
}

// ============================================================
// SETTLE BUTTONS (WIN/LOSS/PUSH) - Direct settle
// ============================================================
async function handleSettleButtons(interaction) {
    // Acknowledge interaction immediately to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const parts = interaction.customId.split('_');
    const result = parts[1]; // win / loss / push
    const betId = parts.slice(2).join('_');
    const graderId = interaction.user.id;

    try {
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        return interaction.editReply({
            content: `✅ Bet settled as **${result.toUpperCase()}**.`
        });
    } catch (err) {
        console.error('Error in handleSettleButtons:', err);
        return interaction.editReply({
            content: '❌ Error settling bet.'
        });
    }
}

// ============================================================
// SETTLE SELECT MENU (ALL PAGES)
// ============================================================
async function handleSettleSelect(interaction) {
    const userId = interaction.user.id;
    const parts = interaction.customId.split('_');
    const ownerId = parts[parts.length - 1]; // Last part is always the userId

    if (ownerId !== userId) {
        return interaction.reply({
            content: 'This menu is not for you.',
            ephemeral: true
        });
    }

    const betId = interaction.values[0];

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`settle_win_${betId}`)
            .setLabel('Win')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`settle_loss_${betId}`)
            .setLabel('Loss')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`settle_push_${betId}`)
            .setLabel('Push')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({
        content: 'Select the result:',
        components: [row],
        ephemeral: true
    });
}


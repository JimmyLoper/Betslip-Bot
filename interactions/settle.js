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
        'settle_select', 'settle_select_page2', 'settle_select_page3',
        'settle_msg',
        'settle_modal',
        'settle_another', 'settle_done'
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

        // ===== SETTLE BUTTONS (WIN/LOSS/PUSH) - From /bet settle or old tracker messages =====
        if (customId.startsWith('settle_win') || customId.startsWith('settle_loss') || customId.startsWith('settle_push')) {
            // If no '_cmd' flag, it's an old tracker message - use tracker handler
            if (!customId.endsWith('_cmd')) {
                return handleTrackerButtons(interaction);
            }
            // Otherwise it's from /bet settle command
            return handleSettleButtons(interaction);
        }

        // ===== SETTLE SELECT MENU (ALL PAGES) =====
        if (customId === 'settle_select' || customId === 'settle_select_page2' || customId === 'settle_select_page3') {
            return handleSettleSelect(interaction);
        }

        // ===== SETTLE MESSAGE (YES/NO) =====
        if (customId.startsWith('settle_msg')) {
            return handleSettleMsg(interaction);
        }

        // ===== SETTLE MODAL =====
        if (customId.startsWith('settle_modal')) {
            return handleSettleModal(interaction);
        }

        // ===== SETTLE ANOTHER / DONE =====
        if (customId.startsWith('settle_another') || customId.startsWith('settle_done')) {
            return handleSettleAnother(interaction);
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

        return interaction.reply({
            content: `Bet settled as a **${result.toUpperCase()}**.`,
            ephemeral: true
        });
    } catch (err) {
        console.error('Error in handleTrackerButtons:', err);
        return interaction.reply({
            content: '❌ Error settling bet.',
            ephemeral: true
        });
    }
}

// ============================================================
// ADMIN SETTLE BUTTONS (WIN/LOSS/PUSH) - Direct settle, no message prompt
// ============================================================
async function handleAdminSettleButtons(interaction) {
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
        return interaction.update({
            components: [],
            content: `✅ Bet settled as **${result.toUpperCase()}**.`
        });
    } catch (err) {
        console.error('Error in handleAdminSettleButtons:', err);
        return interaction.reply({
            content: '❌ Error settling bet.',
            ephemeral: true
        });
    }
}

// ============================================================
// SETTLE BUTTONS (WIN/LOSS/PUSH)
// ============================================================
async function handleSettleButtons(interaction) {
    const parts = interaction.customId.split('_');
    const result = parts[1]; // win / loss / push
    const isFromCmd = interaction.customId.endsWith('_cmd');
    const betId = isFromCmd ? parts.slice(2, -1).join('_') : parts.slice(2).join('_');

    if (result === 'win') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`settle_msg_yes_${betId}_${result}${isFromCmd ? '_cmd' : ''}`)
                .setLabel('Send Message')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`settle_msg_no_${betId}_${result}${isFromCmd ? '_cmd' : ''}`)
                .setLabel('No Message')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({
            content: `Do you want to reply to the original post in your channel for this **WIN**?`,
            components: [row],
            ephemeral: true
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`settle_msg_yes_${betId}_${result}${isFromCmd ? '_cmd' : ''}`)
            .setLabel('Send Message')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`settle_msg_no_${betId}_${result}${isFromCmd ? '_cmd' : ''}`)
            .setLabel('No Message')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
        content: `Do you want to reply to the original post in your channel for this **${result.toUpperCase()}**?`,
        components: [row],
        ephemeral: true
    });
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
            .setCustomId(`settle_win_${betId}_cmd`)
            .setLabel('Win')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`settle_loss_${betId}_cmd`)
            .setLabel('Loss')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`settle_push_${betId}_cmd`)
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
// SETTLE MESSAGE (YES/NO)
// ============================================================
async function handleSettleMsg(interaction) {
    const customId = interaction.customId;
    const isFromCmd = customId.endsWith('_cmd');
    const parts = customId.split('_');
    const action = parts[2]; // yes / no (after 'settle_msg')
    const sliceEnd = isFromCmd ? -2 : -1; // Exclude '_cmd' if present
    const betId = parts.slice(3, sliceEnd).join('_');
    const result = parts[parts.length - (isFromCmd ? 2 : 1)];
    const graderId = interaction.user.id;

    // Fetch tracker message details
    const { rows } = await pool.query(
        `SELECT message_id, channel_id
         FROM bets
         WHERE id = $1`,
        [betId]
    );

    const messageId = rows[0]?.message_id;
    const channelId = rows[0]?.channel_id;

    if (action === 'no') {
        await pool.query(
            `UPDATE bets
             SET result = $1,
                 graded_by = $2,
                 graded_at = $3
             WHERE id = $4`,
            [result, graderId, Date.now(), betId]
        );

        // Update tracker message with settlement info
        if (messageId && channelId) {
            try {
                const channel = await interaction.client.channels.fetch(channelId);
                const trackerMsg = await channel.messages.fetch(messageId);
                const currentContent = trackerMsg.content || '';
                const settledText = `\n\n✅ **Settled as ${result.toUpperCase()}** by <@${graderId}>`;
                
                await trackerMsg.edit({
                    content: currentContent + settledText,
                    components: []
                });
            } catch (err) {
                console.error('Failed to update tracker message:', err);
            }
        }

        // If this is from /bet settle command, show settle another
        if (isFromCmd) {
            const settleAnotherBtn = new ButtonBuilder()
                .setCustomId(`settle_another_${graderId}`)
                .setLabel('Settle Another')
                .setStyle(ButtonStyle.Primary);

            const doneBtn = new ButtonBuilder()
                .setCustomId(`settle_done_${graderId}`)
                .setLabel('Done')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(settleAnotherBtn, doneBtn);

            return interaction.update({
                content: `✅ Bet settled as **${result.toUpperCase()}**.`,
                components: [row],
                ephemeral: true
            });
        } else {
            // From tracker channel - just confirm without extra buttons
            return interaction.reply({
                content: `✅ Bet settled as **${result.toUpperCase()}**.`,
                ephemeral: true
            });
        }
    }

    const modal = new ModalBuilder()
        .setCustomId(`settle_modal_${betId}_${result}${isFromCmd ? '_cmd' : ''}`)
        .setTitle('Settle Bet Message');

    const input = new TextInputBuilder()
        .setCustomId('settle_message_input')
        .setLabel('Message to reply to original post')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
}

// ============================================================
// SETTLE MODAL
// ============================================================
async function handleSettleModal(interaction) {
    const customId = interaction.customId;
    const isFromCmd = customId.endsWith('_cmd');
    const parts = customId.split('_');
    const sliceEnd = isFromCmd ? -2 : -1;
    const betId = parts.slice(2, sliceEnd).join('_');
    const result = parts[parts.length - (isFromCmd ? 2 : 1)];
    const graderId = interaction.user.id;

    const userMessage = interaction.fields.getTextInputValue('settle_message_input');

    const { rows } = await pool.query(
        `SELECT message_id, channel_id
         FROM bets
         WHERE id = $1`,
        [betId]
    );

    const messageId = rows[0]?.message_id;
    const channelId = rows[0]?.channel_id;

    const notifyQuery = await pool.query(
        `SELECT notify_role_id
         FROM channel_notify_roles
         WHERE channel_id = $1`,
        [channelId]
    );

    const notifyRoleId = notifyQuery.rows[0]?.notify_role_id;

    await pool.query(
        `UPDATE bets
         SET result = $1,
             graded_by = $2,
             graded_at = $3
         WHERE id = $4`,
        [result, graderId, Date.now(), betId]
    );

    if (messageId && channelId) {
        try {
            const channel = await interaction.client.channels.fetch(channelId);
            const original = await channel.messages.fetch(messageId);

            let finalMessage = userMessage;
            if (notifyRoleId) {
                finalMessage = `<@&${notifyRoleId}> ${userMessage}`;
            }

            await original.reply({
                content: finalMessage,
                allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
            });

            // Update tracker message with settlement info
            const currentContent = original.content || '';
            const settledText = `\n\n✅ **Settled as ${result.toUpperCase()}** by <@${graderId}>`;
            
            await original.edit({
                content: currentContent + settledText,
                components: []
            });

        } catch (err) {
            console.error('Failed to reply to original bet post:', err);
        }
    }

    const settleAnotherBtn = new ButtonBuilder()
        .setCustomId(`settle_another_${graderId}`)
        .setLabel('Settle Another')
        .setStyle(ButtonStyle.Primary);

    const doneBtn = new ButtonBuilder()
        .setCustomId(`settle_done_${graderId}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(settleAnotherBtn, doneBtn);

    // If this is from /bet settle command, show settle another
    if (isFromCmd) {
        return interaction.update({
            content: `✅ Bet settled as **${result.toUpperCase()}** and message sent.`,
            components: [row],
            ephemeral: true
        });
    } else {
        return interaction.reply({
            content: `✅ Bet settled as **${result.toUpperCase()}** and message sent.`,
            ephemeral: true
        });
    }
}

// ============================================================
// SETTLE ANOTHER / DONE
// ============================================================
async function handleSettleAnother(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[2]; // 'another' or 'done'
    const userId = interaction.user.id;

    if (action === 'done') {
        return interaction.update({
            content: '✅ Settlement complete.',
            components: [],
            ephemeral: true
        });
    }

    const channelId = interaction.channel.id;
    const OVERRIDE_ID = process.env.ADMIN_OVERRIDE_ID;

    let rows;

    if (userId === OVERRIDE_ID) {
        const result = await pool.query(
            `SELECT id, bet_description
             FROM bets
             WHERE result = 'pending'
             AND channel_id = $1
             ORDER BY timestamp DESC`,
            [channelId]
        );
        rows = result.rows;
    } else {
        const result = await pool.query(
            `SELECT id, bet_description
             FROM bets
             WHERE user_id = $1 AND result = 'pending'
             ORDER BY timestamp DESC`,
            [userId]
        );
        rows = result.rows;
    }

    if (rows.length === 0) {
        return interaction.update({
            content: '✅ No more pending bets to settle.',
            components: [],
            ephemeral: true
        });
    }

    const options = rows.map(bet => ({
        label: bet.bet_description.substring(0, 100),
        value: bet.id
    }));

    if (options.length <= 25) {
        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_select_${userId}`)
                .setPlaceholder('Select a bet to settle')
                .addOptions(options)
        );

        return interaction.update({
            content: 'Choose a bet to settle:',
            components: [menu],
            ephemeral: true
        });
    }

    const firstPageOptions = options.slice(0, 25);
    const secondPageOptions = options.slice(25, 50);
    const thirdPageOptions = options.slice(50, 75);

    const menu1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`settle_select_${userId}`)
            .setPlaceholder(`Select a bet (Page 1 of ${Math.ceil(options.length / 25)})`)
            .addOptions(firstPageOptions)
    );

    const components = [menu1];

    if (secondPageOptions.length > 0) {
        const menu2 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_select_page2_${userId}`)
                .setPlaceholder(`Select a bet (Page 2 of ${Math.ceil(options.length / 25)})`)
                .addOptions(secondPageOptions)
        );
        components.push(menu2);
    }

    if (thirdPageOptions.length > 0) {
        const menu3 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_select_page3_${userId}`)
                .setPlaceholder(`Select a bet (Page 3 of ${Math.ceil(options.length / 25)})`)
                .addOptions(thirdPageOptions)
        );
        components.push(menu3);
    }

    return interaction.update({
        content: `Choose a bet to settle (${options.length} total):`,
        components,
        ephemeral: true
    });
}

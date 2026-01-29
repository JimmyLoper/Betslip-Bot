        const db = require('../utils/db');
const { randomUUID } = require('crypto');
const { calculatePayout } = require('../utils/calcPayout');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

module.exports = {
    customIds: ['bet_post_modal'],

    async execute(interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;

        // Extract modal inputs
        const description = interaction.fields.getTextInputValue('description');
        const risk = parseFloat(interaction.fields.getTextInputValue('risk'));
        const sport = interaction.fields.getTextInputValue('sport');
        const odds = parseInt(interaction.fields.getTextInputValue('odds'), 10);
        
        // Handle optional screenshot field
        let screenshotUrl = null;
        try {
            screenshotUrl = interaction.fields.getTextInputValue('screenshot') || null;
        } catch (err) {
            screenshotUrl = null;
        }
        
        // Link is no longer in modal - set to null
        const link = null;

        // Validate inputs
        if (isNaN(risk) || isNaN(odds)) {
            return interaction.reply({
                content: 'Risk and odds must be valid numbers.',
                flags: 'Ephemeral'
            });
        }

        const payout = calculatePayout(risk, odds);
        const id = randomUUID();
        const timestamp = Date.now();

        try {
            // Insert bet into database
            await db.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
                [id, userId, username, description, sport, risk, odds, payout, timestamp]
            );

            // Fetch auto-notify role for this channel
            const { rows } = await db.query(
                `SELECT notify_role_id 
                 FROM channel_notify_roles 
                 WHERE channel_id = $1`,
                [interaction.channel.id]
            );

            const notifyRoleId = rows[0]?.notify_role_id;

            // Build message for the channel
            let message = '';

            if (notifyRoleId) {
                message += `<@&${notifyRoleId}>\n`;
            }

            message += `**${description}**\n`;
            message += `Risk: **${risk}u**\n`;

            // Link button if provided
            let components = [];
            if (link) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(link)
                        .setEmoji('🔗')
                );
                components.push(row);
            }

            // Send message to channel using interaction.reply
            const sent = await interaction.reply({
                content: message,
                files: screenshotUrl ? [screenshotUrl] : [],
                components,
                allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined,
                fetchReply: true
            });

            // Update bet with message and channel info
            await db.query(
                `UPDATE bets SET message_id = $1, channel_id = $2 WHERE id = $3`,
                [sent.id, sent.channel.id, id]
            );

            // Post to capper's private tracker channel
            await postBetToTrackerChannel(interaction.client, userId, id, description, risk, sport, odds, screenshotUrl, link);

            // Set pending upload state so user can upload a screenshot in-channel
            try {
                const pending = interaction.client.pendingUploads;
                if (pending) {
                    const expiresAt = Date.now() + 3 * 60 * 1000;
                    const timeout = setTimeout(() => {
                        pending.delete(userId);
                    }, 3 * 60 * 1000);
                    pending.set(userId, { betId: id, expiresAt, timeout });
                }
            } catch (err) {
                console.error('Failed to set pending upload state:', err);
            }

            // Ask if they want to add a link
            const yesButton = new ButtonBuilder()
                .setCustomId(`add_link_yes_${id}`)
                .setLabel('Yes')
                .setStyle(ButtonStyle.Success);

            const noButton = new ButtonBuilder()
                .setCustomId(`add_link_no_${id}`)
                .setLabel('No')
                .setStyle(ButtonStyle.Secondary);

            const linkRow = new ActionRowBuilder().addComponents(yesButton, noButton);

            return interaction.followUp({
                content: '✅ Bet posted! You may also upload a screenshot in this channel within 3 minutes to attach it to the bet. Would you like to add a link?',
                components: [linkRow],
                flags: 'Ephemeral'
            });

        } catch (err) {
            console.error('Error posting bet:', err);
            return interaction.reply({
                content: 'Error saving your bet.',
                flags: 'Ephemeral'
            });
        }
    }
};

// Post bet to tracker channel
async function postBetToTrackerChannel(client, userId, betId, description, risk, sport, odds, screenshotUrl, link) {
    try {
        const { rows } = await db.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [userId]
        );

        const trackerChannelId = rows[0]?.tracker_channel_id;
        if (!trackerChannelId) return;

        const trackerChannel = await client.channels.fetch(trackerChannelId);
        if (!trackerChannel) return;

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(description)
            .setColor(0x3498db)
            .addFields(
                { name: 'Sport', value: sport, inline: true },
                { name: 'Risk', value: `${risk}u`, inline: true },
                { name: 'Odds', value: odds.toString(), inline: true }
            )
            .setTimestamp();

        // Settle buttons (row 1)
        const settleRow = new ActionRowBuilder().addComponents(
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

        // Action buttons (row 2)
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

        await trackerChannel.send({
            embeds: [embed],
            components: [settleRow, actionRow]
        });
    } catch (err) {
        console.error('Error posting to tracker channel:', err);
    }
}

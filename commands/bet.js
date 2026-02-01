const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { channel } = require('diagnostics_channel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bet')
        .setDescription('Bet commands')
        .addSubcommand(sub =>
            sub
                .setName('post')
                .setDescription('Post a new bet')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Bet description')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('risk')
                        .setDescription('Risk (units)')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('sport')
                        .setDescription('Sport (NFL, NBA, etc.)')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('odds')
                        .setDescription('Odds (e.g., -110, +150)')
                        .setRequired(true)
                )
                .addAttachmentOption(opt =>
                    opt.setName('screenshot')
                        .setDescription('Optional: Screenshot of the bet')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('link')
                        .setDescription('Optional: Link to add to the bet')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        return handlePostCommand(interaction);
    }
};

// ============================================================
// POST COMMAND - DIRECT SLASH COMMAND HANDLING
// ============================================================
async function handlePostCommand(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const sport = interaction.options.getString('sport');
    const odds = interaction.options.getNumber('odds');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');
    const link = interaction.options.getString('link');

    // Validate inputs
    if (isNaN(risk) || isNaN(odds)) {
        return interaction.reply({
            content: 'Risk and odds must be valid numbers.',
            ephemeral: true
        });
    }

    const { calculatePayout } = require('../utils/calcPayout');
    const payout = calculatePayout(risk, odds);
    const id = randomUUID();
    const timestamp = Date.now();

    try {
        // Insert bet into database
        await pool.query(
            `INSERT INTO bets 
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
            [id, userId, username, description, sport, risk, odds, payout, timestamp]
        );

        // Fetch auto-notify role for this channel
        const { rows } = await pool.query(
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

        // Build components
        const components = [];
        if (link) {
            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Link')
                    .setStyle(ButtonStyle.Link)
                    .setURL(link)
                    .setEmoji('🔗')
            );
            components.push(linkRow);
        }

        // Send message to channel
        const files = screenshotAttachment ? [screenshotAttachment.url] : [];
        const sent = await interaction.reply({
            content: message,
            files,
            components,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined,
            fetchReply: true
        });

        // Update bet with message and channel info
        await pool.query(
            `UPDATE bets SET message_id = $1, channel_id = $2 WHERE id = $3`,
            [sent.id, sent.channel.id, id]
        );

        // Post to capper's private tracker channel
        await postBetToTrackerChannel(interaction.client, userId, id, description, risk, sport, odds, screenshotAttachment?.url, link);

        return interaction.followUp({
            content: '✅ Bet posted successfully!',
            ephemeral: true
        });

    } catch (err) {
        console.error('Error posting bet:', err);
        return interaction.reply({
            content: 'Error saving your bet.',
            ephemeral: true
        });
    }
}

// Post bet to tracker channel
async function postBetToTrackerChannel(client, userId, betId, description, risk, sport, odds, screenshotUrl, link) {
    try {
        const { rows } = await pool.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [userId]
        );

        const trackerChannelId = rows[0]?.tracker_channel_id;
        if (!trackerChannelId) return;

        const trackerChannel = await client.channels.fetch(trackerChannelId);
        if (!trackerChannel) return;

        const { EmbedBuilder } = require('discord.js');
        const { calculatePayout } = require('../utils/calcPayout');

        // Build embed
        const payout = calculatePayout(risk, odds);
        const embed = new EmbedBuilder()
            .setTitle(description)
            .setColor(0x3498db)
            .addFields(
                { name: 'Sport', value: sport, inline: true },
                { name: 'Risk', value: `${risk}u`, inline: true },
                { name: 'Odds', value: odds.toString(), inline: true },
                { name: 'Payout', value: `${payout}u`, inline: true }
            )
            .setTimestamp();

        // Settle buttons (row 1)
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

        const files = screenshotUrl ? [screenshotUrl] : [];
        await trackerChannel.send({
            embeds: [embed],
            components: [settleRow, actionRow],
            files
        });
    } catch (err) {
        console.error('Error posting to tracker channel:', err);
    }
}

// ------------------------------------------------------------
// SETTLE HANDLER - REMOVED - Now in /admin betsettle

const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
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
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Describe your bet')
                        .setRequired(true)
                )
                .addNumberOption(option =>
                    option.setName('risk')
                        .setDescription('Units risked')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('sport')
                        .setDescription('Sport (for tracking) use multi for cross sports bets')
                        .setRequired(true)
                )
                .addNumberOption(option =>
                    option.setName('odds')
                        .setDescription('Odds when you placed the bet for tracking purposes')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('link')
                        .setDescription('Optional link to the bet')
                        .setRequired(false)
                )
                .addAttachmentOption(option =>
                    option.setName('screenshot')
                        .setDescription('Optional screenshot of the bet')
                        .setRequired(false)
                )
                
        )
        .addSubcommand(sub =>
            sub
                .setName('settle')
                .setDescription('Settle one of your pending bets')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'post') return handlePost(interaction);
        if (sub === 'settle') return handleSettle(interaction);
    }
};

// ------------------------------------------------------------
// POST HANDLER (AUTO-PING VERSION)
// ------------------------------------------------------------
async function handlePost(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const sport = interaction.options.getString('sport');
    const odds = interaction.options.getNumber('odds');
    const link = interaction.options.getString('link') || null;

    const screenshot = interaction.options.getAttachment('screenshot');
    const screenshotUrl = screenshot ? screenshot.url : null;

    // payout calc
    let payout;
    if (odds < 0) payout = (risk * 100) / Math.abs(odds);
    else payout = (risk * odds) / 100;
    payout = Number(payout.toFixed(2));

    const id = randomUUID();
    const timestamp = Date.now();

    try {
        // Insert bet
        await pool.query(
            `INSERT INTO bets 
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
            [id, userId, username, description, sport, risk, odds, payout, timestamp]
        );

        // ------------------------------------------------------------
        // FETCH AUTO-NOTIFY ROLE FOR THIS CHANNEL
        // ------------------------------------------------------------
        const channelId = interaction.channel.id;

        const { rows } = await pool.query(
            `SELECT notify_role_id 
             FROM channel_notify_roles 
             WHERE channel_id = $1`,
            [channelId]
        );

        const notifyRoleId = rows[0]?.notify_role_id;

        // ------------------------------------------------------------
        // BUILD MESSAGE
        // ------------------------------------------------------------
        let message = "";

        // Auto-ping if role exists
        if (notifyRoleId) {
            message += `<@&${notifyRoleId}>\n`;
        }

        message += `**${description}**\n`;
        message += `Risk: **${risk}u**\n`;

        // Link button
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

        // ------------------------------------------------------------
        // SEND MESSAGE WITH ALLOWED MENTIONS
        // ------------------------------------------------------------
        const sent = await interaction.reply({
            content: message,
            files: screenshotUrl ? [screenshotUrl] : [],
            components,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined,
            fetchReply: true
        });

        // Store message_id + channel_id
        await pool.query(
            `UPDATE bets SET message_id = $1, channel_id = $2 WHERE id = $3`,
            [sent.id, sent.channel.id, id]
        );

    } catch (err) {
        console.error(err);
        await interaction.reply({
            content: 'Error saving your bet.',
            ephemeral: true
        });
    }
}

// ------------------------------------------------------------
// SETTLE HANDLER
// ------------------------------------------------------------
async function handleSettle(interaction) {
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;

    // your Discord ID (override)
    const OVERRIDE_ID = process.env.ADMIN_OVERRIDE_ID;

    let rows;

    if (userId === OVERRIDE_ID) {
        // You see ALL pending bets
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
        // Everyone else sees only THEIR pending bets
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
        return interaction.reply({
            content: 'You have no pending bets.',
            ephemeral: true
        });
    }

    const options = rows.map(bet => ({
        label: bet.bet_description.substring(0, 100),
        value: bet.id
    }));

    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`settle_select_${userId}`)
            .setPlaceholder('Select a bet to settle')
            .addOptions(options)
    );

    return interaction.reply({
        content: 'Choose a bet to settle:',
        components: [menu],
        ephemeral: true
    });
}
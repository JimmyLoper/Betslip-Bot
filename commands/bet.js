const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');

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
                        .setDescription('Sport (NBA, NFL, NHL, etc.)')
                        .setRequired(true)
                )
                .addNumberOption(option =>
                    option.setName('odds')
                        .setDescription('American odds (e.g., -110, +150)')
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
                .addStringOption(option =>
                    option.setName('notify')
                        .setDescription('Notify @everyone, @here, or a role')
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
// POST HANDLER
// ------------------------------------------------------------
async function handlePost(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const sport = interaction.options.getString('sport');
    const odds = interaction.options.getNumber('odds'); // tracked only
    const link = interaction.options.getString('link') || null;

    const screenshot = interaction.options.getAttachment('screenshot');
    const screenshotUrl = screenshot ? screenshot.url : null;

    let notify = interaction.options.getString('notify') || '';
    let notifyText = '';

    if (notify) {
        notify = notify.toLowerCase();
        if (notify === 'everyone') notifyText = '@everyone';
        else if (notify === 'here') notifyText = '@here';
        else notifyText = notify;
    }

    // payout calc (profit only)
    let payout;
    if (odds < 0) payout = (risk * 100) / Math.abs(odds);
    else payout = (risk * odds) / 100;
    payout = Number(payout.toFixed(2));

    const id = randomUUID();
    const timestamp = Date.now();

    try {
        await pool.query(
            `INSERT INTO bets 
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
            [id, userId, username, description, sport, risk, odds, payout, timestamp]
        );

        // ------------------------------------------------------------
        // PLAYBOOK-FRIENDLY MESSAGE (NO ODDS SHOWN)
        // ------------------------------------------------------------
        const PLAYBOOK_ID = '1408438245594763375'; // replace with real ID


        let message = notifyText ? `${notifyText}\n` : '';
        message += `<@${PLAYBOOK_ID}>\n`; // REAL mention
        message += `**${description}**\n`;
        message += `Risk: **${risk}u**\n`;
        message += `Sport: **${sport}**\n`;
        

        // Send message and capture it
        const sent = await interaction.reply({
            content: message,
            files: screenshotUrl ? [screenshotUrl] : [],
            fetchReply: true
        });

        // Store message_id
        await pool.query(
            `UPDATE bets SET message_id = $1 WHERE id = $2`,
            [sent.id, id]
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

    const { rows } = await pool.query(
        `SELECT id, bet_description 
         FROM bets 
         WHERE user_id = $1 AND result = 'pending'`,
        [userId]
    );

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
            .setCustomId('settle_select')
            .setPlaceholder('Select a bet to settle')
            .addOptions(options)
    );

    await interaction.reply({
        content: 'Choose a bet to settle:',
        components: [menu],
        ephemeral: true
    });
}
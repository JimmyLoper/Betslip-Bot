const { SlashCommandBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const pool = require('../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin-only commands')

        // ------------------------------------------------------------
        // /admin addbet
        // ------------------------------------------------------------
        .addSubcommand(sub =>
            sub
                .setName('addbet')
                .setDescription('Silently add a bet for the capper of this channel')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Bet description')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('risk')
                        .setDescription('Units risked')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('odds')
                        .setDescription('American odds (e.g. -110, +150)')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('Message ID of the betslip')
                        .setRequired(true)
                )
        )

        // ------------------------------------------------------------
        // /admin fixbet
        // ------------------------------------------------------------
        .addSubcommand(sub =>
            sub
                .setName('fixbet')
                .setDescription('Edit an existing bet by ID')
                .addStringOption(opt =>
                    opt.setName('bet_id')
                        .setDescription('Bet ID to edit')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('New description')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('risk')
                        .setDescription('New risk amount')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('odds')
                        .setDescription('New odds (American)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('New message ID')
                        .setRequired(false)
                )
        )

        // ------------------------------------------------------------
        // /admin deletebet
        // ------------------------------------------------------------
        .addSubcommand(sub =>
            sub
                .setName('deletebet')
                .setDescription('Delete a bet by ID')
                .addStringOption(opt =>
                    opt.setName('bet_id')
                        .setDescription('Bet ID to delete')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const overrideId = process.env.ADMIN_OVERRIDE_ID;

        // Permission gating
        if (interaction.user.id !== overrideId) {
            return interaction.reply({
                content: 'You are not authorized to use admin commands.',
                ephemeral: true
            });
        }

        if (sub === 'addbet') return handleAddBet(interaction);
        if (sub === 'fixbet') return handleFixBet(interaction);
        if (sub === 'deletebet') return handleDeleteBet(interaction);
    }
};

// ------------------------------------------------------------
// ADD BET HANDLER
// ------------------------------------------------------------
async function handleAddBet(interaction) {
    const channelId = interaction.channel.id;

    const { rows } = await pool.query(
        `SELECT user_id, username
         FROM channel_notify_roles
         WHERE channel_id = $1`,
        [channelId]
    );

    if (rows.length === 0) {
        return interaction.reply({
            content: 'This channel is not assigned to a capper.',
            ephemeral: true
        });
    }

    const capperId = rows[0].user_id;
    const capperUsername = rows[0].username;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const odds = interaction.options.getNumber('odds');
    const messageId = interaction.options.getString('message_id');

    // Calculate payout
    let payout;
    if (odds < 0) {
        payout = (risk * 100) / Math.abs(odds);
    } else {
        payout = (risk * odds) / 100;
    }
    payout = Number(payout.toFixed(2));
    const ts = Date.now();
    await pool.query(
        `INSERT INTO bets
         (id, user_id, username, bet_description, risk, odds, payout, result, timestamp, channel_id, message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)`,
        [
            uuidv4(),
            capperId,
            capperUsername,
            description,
            risk,
            odds,
            payout,
            channelId,
            messageId
        ]
    );

    return interaction.reply({
        content: `Bet added silently for **${capperUsername}**.`,
        ephemeral: true
    });
}

// ------------------------------------------------------------
// FIX BET HANDLER
// ------------------------------------------------------------
async function handleFixBet(interaction) {
    const betId = interaction.options.getString('bet_id');

    const newDescription = interaction.options.getString('description');
    const newRisk = interaction.options.getNumber('risk');
    const newOdds = interaction.options.getNumber('odds');
    const newMessageId = interaction.options.getString('message_id');

    // Fetch current values so we can recalc payout if needed
    const { rows } = await pool.query(
        `SELECT risk, odds FROM bets WHERE id = $1`,
        [betId]
    );

    if (rows.length === 0) {
        return interaction.reply({
            content: 'Bet not found.',
            ephemeral: true
        });
    }

    let risk = rows[0].risk;
    let odds = rows[0].odds;

    if (newRisk !== null) risk = newRisk;
    if (newOdds !== null) odds = newOdds;

    // Recalculate payout
    let payout;
    if (odds < 0) {
        payout = (risk * 100) / Math.abs(odds);
    } else {
        payout = (risk * odds) / 100;
    }
    payout = Number(payout.toFixed(2));

    const updates = [];
    const values = [];
    let idx = 1;

    if (newDescription) {
        updates.push(`bet_description = $${idx++}`);
        values.push(newDescription);
    }
    if (newRisk !== null) {
        updates.push(`risk = $${idx++}`);
        values.push(newRisk);
    }
    if (newOdds !== null) {
        updates.push(`odds = $${idx++}`);
        values.push(newOdds);
    }
    if (newMessageId) {
        updates.push(`message_id = $${idx++}`);
        values.push(newMessageId);
    }

    // Always update payout if risk or odds changed
    updates.push(`payout = $${idx++}`);
    values.push(payout);

    values.push(betId);

    await pool.query(
        `UPDATE bets SET ${updates.join(', ')}
         WHERE id = $${idx}`,
        values
    );

    return interaction.reply({
        content: `Bet **${betId}** updated successfully.`,
        ephemeral: true
    });
}

// ------------------------------------------------------------
// DELETE BET HANDLER
// ------------------------------------------------------------
async function handleDeleteBet(interaction) {
    const betId = interaction.options.getString('bet_id');

    await pool.query(
        `DELETE FROM bets WHERE id = $1`,
        [betId]
    );

    return interaction.reply({
        content: `Bet **${betId}** has been deleted.`,
        ephemeral: true
    });
}
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
                .addStringOption(opt =>
                    opt.setName('sport')
                        .setDescription('Sport for the bet (NFL, NBA, etc.)')
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
        // /admin addladder
        // ------------------------------------------------------------
        .addSubcommand(sub =>
            sub
                .setName('addladder')
                .setDescription('Add a multi-step ladder to the bets table using modals')
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
        if (sub === 'addladder') return handleAddLadder(interaction);
    }
};

// ------------------------------------------------------------
// ADD BET HANDLER
// ------------------------------------------------------------
async function handleAddBet(interaction) {
    const channelId = interaction.channel.id;
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

    const { rows } = await pool.query(
        `SELECT user_id, username, tracker_channel_id
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
    const trackerChannelId = rows[0].tracker_channel_id;

    const description = interaction.options.getString('description');
    const risk = interaction.options.getNumber('risk');
    const odds = interaction.options.getNumber('odds');
    const sport = interaction.options.getString('sport');
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
    const betId = uuidv4();

    await pool.query(
        `INSERT INTO bets
         (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, channel_id, message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11)`,
        [
            betId,
            capperId,
            capperUsername,
            description,
            sport,
            risk,
            odds,
            payout,
            ts,
            channelId,
            messageId
        ]
    );

    // Post to tracker channel
    if (trackerChannelId) {
        try {
            const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
            if (trackerChannel) {
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
            }
        } catch (err) {
            console.error('Error posting to tracker channel:', err);
        }
    }

    return interaction.reply({
        content: `✅ Added bet: **${description}**\nCapper: **${capperUsername}**`,
        ephemeral: true
    });
}


// ------------------------------------------------------------
// ADD LADDER HANDLER (ADMIN)
// ------------------------------------------------------------
async function handleAddLadder(interaction) {
    const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

    const stepSelect = new StringSelectMenuBuilder()
        .setCustomId('admin_ladder_step_count')
        .setPlaceholder('Select number of steps')
        .addOptions(
            { label: '2 Steps', value: '2' },
            { label: '3 Steps', value: '3' },
            { label: '4 Steps', value: '4' },
            { label: '5 Steps', value: '5' }
        );

    const row = new ActionRowBuilder().addComponents(stepSelect);

    return interaction.reply({
        content: 'How many steps does this ladder have?',
        components: [row],
        ephemeral: true
    });
}
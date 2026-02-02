const { SlashCommandBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const pool = require('../utils/db');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

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
                .addAttachmentOption(opt =>
                    opt.setName('screenshot')
                        .setDescription('Screenshot/image of betslip (optional)')
                        .setRequired(false)
                )
        )

        // ------------------------------------------------------------
        // /admin addladder
        // ------------------------------------------------------------
        .addSubcommand(sub =>
            sub
                .setName('addladder')
                .setDescription('Add a multi-step ladder to the bets table using modals')
        )

        // /admin betsettle
        // ------------------------------------------------------------ 
        .addSubcommand(sub =>
            sub
                .setName('betsettle')
                .setDescription('Settle pending bets')
        )

        // /admin editbet
        // ------------------------------------------------------------ 
        .addSubcommand(sub =>
            sub
                .setName('editbet')
                .setDescription('Edit a bet after it has been posted (e.g. to fix details before settlement)')
                .addStringOption(opt =>
                    opt.setName('tracker_message_id')
                        .setDescription('Tracker message ID of the bet to edit')
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
        if (sub === 'addladder') return handleAddLadder(interaction);
        if (sub === 'betsettle') return handleBetSettle(interaction);
        if (sub === 'editbet') return handleEditBet(interaction);
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
    const sport = interaction.options.getString('sport');
    const risk = interaction.options.getNumber('risk');
    const odds = interaction.options.getNumber('odds');
    const messageId = interaction.options.getString('message_id');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');

    // Fetch original message to get attachments if not provided
    let attachmentUrls = [];
    if (!screenshotAttachment) {
        try {
            const originalMsg = await interaction.channel.messages.fetch(messageId);
            if (originalMsg && originalMsg.attachments.size > 0) {
                attachmentUrls = Array.from(originalMsg.attachments.values()).map(att => att.url);
            }
        } catch (err) {
            console.error('Failed to fetch original message for attachments:', err);
        }
    } else {
        attachmentUrls = [screenshotAttachment.url];
    }

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

                const trackerMsg = await trackerChannel.send({
                    embeds: [embed],
                    components: [settleRow, actionRow],
                    files: attachmentUrls
                });
                
                // Update bet with tracker message ID
                await pool.query(
                    `UPDATE bets SET tracker_message_id = $1 WHERE id = $2`,
                    [trackerMsg.id, betId]
                );
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

// ============================================================
// BET SETTLE HANDLER
// ============================================================
async function handleBetSettle(interaction) {
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;
    const OVERRIDE_ID = process.env.ADMIN_OVERRIDE_ID;

    let rows;

    if (userId === OVERRIDE_ID) {
        // See ALL pending bets
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
        // See only own pending bets
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

    // Paginate if needed
    const options = rows.map(bet => ({
        label: bet.bet_description.substring(0, 100),
        value: bet.id
    }));

    if (options.length <= 25) {
        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_admin_select_${userId}`)
                .setPlaceholder('Select a bet to settle')
                .addOptions(options)
        );

        return interaction.reply({
            content: 'Choose a bet to settle:',
            components: [menu],
            ephemeral: true
        });
    }

    // Multiple pages
    const firstPageOptions = options.slice(0, 25);
    const secondPageOptions = options.slice(25, 50);
    const thirdPageOptions = options.slice(50, 75);

    const menu1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`settle_admin_select_${userId}`)
            .setPlaceholder(`Select a bet (Page 1 of ${Math.ceil(options.length / 25)})`)
            .addOptions(firstPageOptions)
    );

    const components = [menu1];

    if (secondPageOptions.length > 0) {
        const menu2 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_admin_select_page2_${userId}`)
                .setPlaceholder(`Select a bet (Page 2 of ${Math.ceil(options.length / 25)})`)
                .addOptions(secondPageOptions)
        );
        components.push(menu2);
    }

    if (thirdPageOptions.length > 0) {
        const menu3 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_admin_select_page3_${userId}`)
                .setPlaceholder(`Select a bet (Page 3 of ${Math.ceil(options.length / 25)})`)
                .addOptions(thirdPageOptions)
        );
        components.push(menu3);
    }

    return interaction.reply({
        content: `Choose a bet to settle (${options.length} total):`,
        components,
        ephemeral: true
    });
}

// ============================================================
// EDIT BET HANDLER (Admin emergency edits)
// ============================================================
async function handleEditBet(interaction) {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    const { calculatePayout } = require('../utils/calcPayout');

    const trackerMessageId = interaction.options.getString('tracker_message_id');

    // Fetch bet by tracker message ID
    const { rows } = await pool.query(
        `SELECT id, bet_description, sport, risk, odds, result FROM bets WHERE tracker_message_id = $1`,
        [trackerMessageId]
    );

    if (rows.length === 0) {
        return interaction.reply({
            content: '❌ Bet not found with that tracker message ID.',
            ephemeral: true
        });
    }

    const bet = rows[0];

    // Create modal with current bet info
    const modal = new ModalBuilder()
        .setCustomId(`admin_editbet_modal_${bet.id}`)
        .setTitle('Edit Bet');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(bet.bet_description)
        .setRequired(true);

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.sport)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.risk.toString())
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.odds.toString())
        .setRequired(true);

    const resultInput = new TextInputBuilder()
        .setCustomId('result')
        .setLabel('Result (pending, win, loss, push)')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.result || 'pending')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(sportInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput),
        new ActionRowBuilder().addComponents(resultInput)
    );

    return interaction.showModal(modal);
}
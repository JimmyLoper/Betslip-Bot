const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('betladder')
        .setDescription('Ladder betting commands')
        .addSubcommand(sub =>
            sub
                .setName('post')
                .setDescription('Post a multi-step ladder bet')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Description to post on the message')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('sport')
                        .setDescription('Sport (NFL, NBA, etc.)')
                        .setRequired(true)
                )
                // Step 1 (Required)
                .addStringOption(opt =>
                    opt.setName('step1_description')
                        .setDescription('Step 1: Bet description')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('step1_risk')
                        .setDescription('Step 1: Risk (units)')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('step1_odds')
                        .setDescription('Step 1: Odds (e.g., -110, +150)')
                        .setRequired(true)
                )
                // Step 2 (Required)
                .addStringOption(opt =>
                    opt.setName('step2_description')
                        .setDescription('Step 2: Bet description')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('step2_risk')
                        .setDescription('Step 2: Risk (units)')
                        .setRequired(true)
                )
                .addNumberOption(opt =>
                    opt.setName('step2_odds')
                        .setDescription('Step 2: Odds')
                        .setRequired(true)
                )
                // Step 3 (Optional)
                .addStringOption(opt =>
                    opt.setName('step3_description')
                        .setDescription('Step 3: Bet description (optional)')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('step3_risk')
                        .setDescription('Step 3: Risk (units) (optional)')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('step3_odds')
                        .setDescription('Step 3: Odds (optional)')
                        .setRequired(false)
                )
                // Step 4 (Optional)
                .addStringOption(opt =>
                    opt.setName('step4_description')
                        .setDescription('Step 4: Bet description (optional)')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('step4_risk')
                        .setDescription('Step 4: Risk (units) (optional)')
                        .setRequired(false)
                )
                .addNumberOption(opt =>
                    opt.setName('step4_odds')
                        .setDescription('Step 4: Odds (optional)')
                        .setRequired(false)
                )
                // Optional additions
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
        const sub = interaction.options.getSubcommand();
        if (sub === 'post') {
            return handlePostLadder(interaction);
        }
    }
};

// ============================================================
// POST LADDER - MAIN HANDLER
// ============================================================
async function handlePostLadder(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const descriptionToPost = interaction.options.getString('description');
    const sport = interaction.options.getString('sport');
    const screenshotAttachment = interaction.options.getAttachment('screenshot');
    const link = interaction.options.getString('link');

    // Collect steps
    const steps = [];

    // Step 1 (required)
    steps.push({
        description: interaction.options.getString('step1_description'),
        risk: interaction.options.getNumber('step1_risk'),
        odds: interaction.options.getNumber('step1_odds')
    });

    // Step 2 (required)
    steps.push({
        description: interaction.options.getString('step2_description'),
        risk: interaction.options.getNumber('step2_risk'),
        odds: interaction.options.getNumber('step2_odds')
    });

    // Step 3 (optional)
    const step3Desc = interaction.options.getString('step3_description');
    if (step3Desc) {
        steps.push({
            description: step3Desc,
            risk: interaction.options.getNumber('step3_risk'),
            odds: interaction.options.getNumber('step3_odds')
        });
    }

    // Step 4 (optional)
    const step4Desc = interaction.options.getString('step4_description');
    if (step4Desc) {
        steps.push({
            description: step4Desc,
            risk: interaction.options.getNumber('step4_risk'),
            odds: interaction.options.getNumber('step4_odds')
        });
    }

    // Validate all steps have valid numbers
    for (const step of steps) {
        if (isNaN(step.risk) || isNaN(step.odds)) {
            return interaction.reply({
                content: 'Risk and odds must be valid numbers for all steps.',
                ephemeral: true
            });
        }
    }

    try {
        // Fetch auto-notify role for this channel
        const { rows: notifyRows } = await pool.query(
            `SELECT notify_role_id 
             FROM channel_notify_roles 
             WHERE channel_id = $1`,
            [interaction.channel.id]
        );

        const notifyRoleId = notifyRows[0]?.notify_role_id;

        // Build public message
        let message = '';
        if (notifyRoleId) {
            message += `<@&${notifyRoleId}>\n`;
        }
        message += `**${descriptionToPost}**\n\n`;

        // Add all step risks
        for (let i = 0; i < steps.length; i++) {
            message += `${steps[i].risk}u\n`;
        }

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

        // Send public message to channel
        const files = screenshotAttachment ? [screenshotAttachment.url] : [];
        const sent = await interaction.reply({
            content: message,
            files,
            components,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined,
            fetchReply: true
        });

        // Create a bet entry for each step in the ladder
        const { calculatePayout } = require('../utils/calcPayout');

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const betId = randomUUID();
            const timestamp = Date.now();
            const payout = calculatePayout(step.risk, step.odds);

            // Insert bet into database
            await pool.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11)`,
                [betId, userId, username, step.description, sport, step.risk, step.odds, payout, timestamp, sent.id, sent.channel.id]
            );

            // Post to tracker channel and get tracker message ID
            const trackerMessageId = await postLadderStepToTrackerChannel(
                interaction.client,
                userId,
                betId,
                i + 1,
                step.description,
                step.risk,
                sport,
                step.odds,
                screenshotAttachment?.url,
                link
            );

            // Update bet with tracker message ID if it was posted
            if (trackerMessageId) {
                await pool.query(
                    `UPDATE bets SET tracker_message_id = $1 WHERE id = $2`,
                    [trackerMessageId, betId]
                );
            }
        }

        return interaction.followUp({
            content: `✅ Ladder with ${steps.length} steps posted successfully!`,
            ephemeral: true
        });

    } catch (err) {
        console.error('Error posting ladder:', err);
        return interaction.reply({
            content: 'Error saving your ladder.',
            ephemeral: true
        });
    }
}

// ============================================================
// POST LADDER STEP TO TRACKER CHANNEL
// ============================================================
async function postLadderStepToTrackerChannel(client, userId, betId, stepNumber, description, risk, sport, odds, screenshotUrl, link) {
    try {
        const { rows } = await pool.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [userId]
        );

        const trackerChannelId = rows[0]?.tracker_channel_id;
        if (!trackerChannelId) return;

        const trackerChannel = await client.channels.fetch(trackerChannelId);
        if (!trackerChannel) return;

        const { calculatePayout } = require('../utils/calcPayout');

        // Build embed
        const payout = calculatePayout(risk, odds);
        const embed = new EmbedBuilder()
            .setTitle(`Step ${stepNumber}: ${description}`)
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
        const trackerMsg = await trackerChannel.send({
            embeds: [embed],
            components: [settleRow, actionRow],
            files
        });

        // Return tracker message ID
        return trackerMsg.id;
    } catch (err) {
        console.error('Error posting to tracker channel:', err);
    }
}
const db = require('../utils/db');
const { randomUUID } = require('crypto');
const { calculatePayout } = require('../utils/calcPayout');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    customIds: ['ladder_final_modal'],

    async execute(interaction) {
        const userId = interaction.user.id;

        // Pull cached steps
        const steps = interaction.client.ladderCache?.get(userId);
        if (!steps || steps.length === 0) {
            return interaction.reply({
                content: 'Error: No ladder steps found. Please try again.',
                ephemeral: true
            });
        }

        // Final modal inputs
        const overallDescription = interaction.fields.getTextInputValue('overall_description');
        const sport = interaction.fields.getTextInputValue('sport');

        const capperId = interaction.user.id;
        const capperUsername = interaction.user.username;

        // ------------------------------------------------------------
        // INSERT EACH STEP AS ITS OWN BET ROW (YOUR EXACT FORMAT)
        // ------------------------------------------------------------
        const insertedIds = [];

        for (const step of steps) {
            const { description, risk, odds } = step;

            const payout = calculatePayout(risk, odds);
            const id = randomUUID();
            const timestamp = Date.now();

            await db.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
                [
                    id,
                    capperId,
                    capperUsername,
                    description,
                    sport,
                    risk,
                    odds,
                    payout,
                    timestamp
                ]
            );

            insertedIds.push(id);
        }

        // ------------------------------------------------------------
        // BUILD LADDER SLIP MESSAGE (YOUR EXACT FORMAT)
        // ------------------------------------------------------------

        const { rows } = await db.query(
            `SELECT notify_role_id FROM channel_notify_roles WHERE user_id = $1`,
            [capperId]
        );

        const notifyRoleId = rows[0]?.notify_role_id;
        const notifyPing = notifyRoleId ? `<@&${notifyRoleId}>` : '';

        let stepsText = '';
        steps.forEach((step, i) => {
            stepsText += `${step.risk}u\n`;
        });

        let messageText =
`${notifyPing}
${overallDescription}

${stepsText}`;

        // Post ladder slip
        const sent = await interaction.channel.send(messageText);

        // Update each bet row with message + channel
        for (const betId of insertedIds) {
            await db.query(
                `UPDATE bets 
                SET message_id = $1, channel_id = $2 
                WHERE id = $3`,
                [sent.id, sent.channel.id, betId]
            );
        }

        // Clear cache
        interaction.client.ladderCache.delete(userId);

        // Set pending upload state so user can upload a screenshot in-channel
        try {
            const pending = interaction.client.pendingUploads;
            if (pending) {
                const expiresAt = Date.now() + 3 * 60 * 1000;
                const timeout = setTimeout(() => {
                    pending.delete(userId);
                }, 3 * 60 * 1000);
                pending.set(userId, { betId: insertedIds[0], expiresAt, timeout });
            }
        } catch (err) {
            console.error('Failed to set pending upload state:', err);
        }

        // Post each ladder step to the capper's tracker channel
        const trackerChannelId = await getTrackerChannelForUser(capperId);
        if (trackerChannelId) {
            try {
                const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
                if (trackerChannel) {
                    for (let i = 0; i < steps.length; i++) {
                        const step = steps[i];
                        await postLadderStepToTracker(trackerChannel, step, i + 1, insertedIds[i], sport);
                    }
                }
            } catch (err) {
                console.error('Error posting ladder steps to tracker:', err);
            }
        }

        // Ask if they want to add a link
        const yesButton = new ButtonBuilder()
            .setCustomId(`add_link_yes_${insertedIds[0]}`)
            .setLabel('Yes')
            .setStyle(ButtonStyle.Success);

        const noButton = new ButtonBuilder()
            .setCustomId(`add_link_no_${insertedIds[0]}`)
            .setLabel('No')
            .setStyle(ButtonStyle.Secondary);

        const linkRow = new ActionRowBuilder().addComponents(yesButton, noButton);

        return interaction.reply({
            content: `✅ Ladder posted with ${steps.length} steps! You may also upload a screenshot in this channel within 3 minutes to attach it to the bet. Would you like to add a link?`,
            components: [linkRow],
            flags: 'Ephemeral'
        });
    }
};

// Get tracker channel ID for a user
async function getTrackerChannelForUser(capperId) {
    try {
        const { rows } = await db.query(
            `SELECT tracker_channel_id FROM channel_notify_roles WHERE user_id = $1`,
            [capperId]
        );
        return rows[0]?.tracker_channel_id || null;
    } catch (err) {
        console.error('Error fetching tracker channel:', err);
        return null;
    }
}

// Post individual ladder step to tracker channel
async function postLadderStepToTracker(channel, step, stepNumber, betId, overallSport) {
    const embed = new EmbedBuilder()
        .setTitle(`Ladder Step ${stepNumber}`)
        .setDescription(step.description)
        .setColor(0x3498db)
        .addFields(
            { name: 'Sport', value: overallSport, inline: true },
            { name: 'Risk', value: `${step.risk}u`, inline: true },
            { name: 'Odds', value: step.odds.toString(), inline: true }
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

    await channel.send({
        embeds: [embed],
        components: [settleRow, actionRow]
    });
}
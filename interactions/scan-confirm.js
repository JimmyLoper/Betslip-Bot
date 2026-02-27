const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { pendingScans } = require('../utils/pendingScans');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['scan_confirm_', 'scan_cancel_'],

    async execute(interaction) {
        if (interaction.customId.startsWith('scan_confirm_')) {
            return handleScanConfirm(interaction);
        }
        if (interaction.customId.startsWith('scan_cancel_')) {
            return handleScanCancel(interaction);
        }
    }
};

// ============================================================
// CONFIRM HANDLER
// ============================================================
async function handleScanConfirm(interaction) {
    await interaction.deferUpdate().catch(() => {});

    const interactionId = interaction.customId.replace('scan_confirm_', '');
    const pending = pendingScans.get(interactionId);

    if (!pending) {
        return interaction.editReply({
            content: '⚠️ This preview has expired. Please run `/bet post` again.',
            embeds: [],
            components: [],
            files: []
        });
    }

    // Clear TTL and remove from map immediately to prevent double-confirm
    clearTimeout(pending.ttl);
    pendingScans.delete(interactionId);

    const { bets, screenshotUrl, link, userId, username, channelId, note, notifyRoleId } = pending;
    const { postBetToTrackerChannel } = require('../commands/bet');

    const timestamp = Date.now();

    try {
        // ── Build public channel message ──────────────────────────────
        let publicMessage = '';
        if (notifyRoleId) publicMessage += `<@&${notifyRoleId}>\n\n`;
        if (note) publicMessage += `**${note}**\n`;
        bets.forEach(bet => {
            publicMessage += `${bet.risk}u\n`;
        });
        publicMessage += '\n';

        const publicComponents = [];
        if (link) {
            publicComponents.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(link)
                        .setEmoji('🔗')
                )
            );
        }

        const publicChannel = await interaction.client.channels.fetch(channelId);
        const sent = await publicChannel.send({
            content: publicMessage,
            files: screenshotUrl ? [screenshotUrl] : [],
            components: publicComponents,
            allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : undefined
        });

        // ── Post each bet to tracker + insert into DB ─────────────────
        for (const bet of bets) {
            const betId = randomUUID();
            const payout = calculatePayout(bet.risk, bet.odds);

            const trackerMessageId = await postBetToTrackerChannel(
                interaction.client,
                userId,
                betId,
                bet.description,
                bet.risk,
                bet.sport,
                bet.odds,
                screenshotUrl,
                link
            );

            await pool.query(
                `INSERT INTO bets
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
                [betId, userId, username, bet.description, bet.sport, bet.risk, bet.odds, payout, timestamp, sent.id, sent.channel.id, trackerMessageId || null]
            );
        }

        return interaction.editReply({
            content: `✅ ${bets.length > 1 ? `${bets.length} bets` : 'Bet'} posted successfully!`,
            embeds: [],
            components: [],
            files: []
        });

    } catch (err) {
        console.error('Error confirming scan bets:', err);

        // DM admin on failure
        try {
            const adminId = process.env.ADMIN_OVERRIDE_ID;
            if (adminId) {
                const { EmbedBuilder } = require('discord.js');
                const admin = await interaction.client.users.fetch(adminId).catch(() => null);
                if (admin) {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Scan Bet Confirm Failed')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'User', value: `<@${userId}> (${userId})`, inline: false },
                            { name: 'Bets', value: bets.map(b => `${b.description} | ${b.odds} | ${b.risk}u`).join('\n'), inline: false },
                            { name: 'Error', value: `\`\`\`${err.message}\`\`\``, inline: false }
                        )
                        .setTimestamp();
                    await admin.send({ embeds: [embed] }).catch(() => {});
                }
            }
        } catch (dmErr) {
            console.error('Failed to send error DM:', dmErr);
        }

        return interaction.editReply({
            content: '❌ Error posting bets. Please try `/bet manual` instead.',
            embeds: [],
            components: [],
            files: []
        });
    }
}

// ============================================================
// CANCEL HANDLER
// ============================================================
async function handleScanCancel(interaction) {
    const interactionId = interaction.customId.replace('scan_cancel_', '');
    const pending = pendingScans.get(interactionId);

    if (pending) {
        clearTimeout(pending.ttl);
        pendingScans.delete(interactionId);
    }

    return interaction.update({
        content: '❌ Cancelled.',
        embeds: [],
        components: [],
        files: []
    });
}

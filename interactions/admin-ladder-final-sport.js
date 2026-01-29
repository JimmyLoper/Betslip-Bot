const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const { calculatePayout } = require('../utils/calcPayout');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    customIds: ['admin_ladder_final_sport_modal'],
    async execute(interaction) {
        const sport = interaction.fields.getTextInputValue('sport');

        // Get ladder cache
        const cache = interaction.client.ladderCache?.get(interaction.user.id);
        if (!cache || !cache.steps.length) {
            return interaction.reply({
                content: '❌ Ladder session expired.',
                ephemeral: true
            });
        }

        try {
            // Fetch capper info from channel
            const { rows } = await pool.query(
                `SELECT user_id, username, tracker_channel_id FROM channel_notify_roles WHERE channel_id = $1`,
                [cache.channelId]
            );

            if (rows.length === 0) {
                return interaction.reply({
                    content: '❌ Channel not assigned to a capper.',
                    ephemeral: true
                });
            }

            const capperId = rows[0].user_id;
            const capperUsername = rows[0].username;
            const trackerChannelId = rows[0].tracker_channel_id;
            const timestamp = Date.now();

            // Insert each step as a separate bet
            const insertedIds = [];
            for (const step of cache.steps) {
                const payout = calculatePayout(step.risk, step.odds);
                const betId = randomUUID();

                await pool.query(
                    `INSERT INTO bets 
                    (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, channel_id, message_id)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11)`,
                    [
                        betId,
                        capperId,
                        capperUsername,
                        step.description,
                        sport,
                        step.risk,
                        step.odds,
                        payout,
                        timestamp,
                        cache.channelId,
                        step.messageId
                    ]
                );

                insertedIds.push(betId);
            }

            // Post each step to the capper's tracker channel
            if (trackerChannelId) {
                try {
                    const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);
                    if (trackerChannel) {
                        for (let i = 0; i < cache.steps.length; i++) {
                            const step = cache.steps[i];
                            const betId = insertedIds[i];
                            const payout = calculatePayout(step.risk, step.odds);

                            const embed = new EmbedBuilder()
                                .setTitle(`Ladder Step ${i + 1}`)
                                .setDescription(step.description)
                                .setColor(0x3498db)
                                .addFields(
                                    { name: 'Sport', value: sport, inline: true },
                                    { name: 'Risk', value: `${step.risk}u`, inline: true },
                                    { name: 'Odds', value: step.odds.toString(), inline: true },
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
                    }
                } catch (err) {
                    console.error('Error posting to tracker channel:', err);
                }
            }

            // Clear cache
            interaction.client.ladderCache.delete(interaction.user.id);

            return interaction.reply({
                content: `✅ Ladder with ${cache.steps.length} steps posted to tracker for **${capperUsername}** (Sport: **${sport}**).`,
                ephemeral: true
            });

        } catch (err) {
            console.error('Error inserting admin ladder:', err);
            return interaction.reply({
                content: '❌ Error inserting ladder bets.',
                ephemeral: true
            });
        }
    }
};

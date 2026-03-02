const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const pool = require('../utils/db');
const { pendingOdds } = require('../utils/pendingOdds');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['parlay_odds_btn_', 'parlay_odds_modal_'],

    async execute(interaction) {
        if (interaction.isButton() && interaction.customId.startsWith('parlay_odds_btn_')) {
            return handleOddsButton(interaction);
        }
        if (interaction.isModalSubmit() && interaction.customId.startsWith('parlay_odds_modal_')) {
            return handleOddsModal(interaction);
        }
    }
};

// ============================================================
// BUTTON — show modal asking for the odds
// ============================================================
async function handleOddsButton(interaction) {
    const interactionId = interaction.customId.replace('parlay_odds_btn_', '');
    const pending = pendingOdds.get(interactionId);

    if (!pending) {
        return interaction.reply({
            content: '⚠️ This prompt has expired. Use `/admin editbet` to update the odds manually.',
            ephemeral: true
        });
    }

    const betCount = pending.bets.length;
    const label = betCount === 1
        ? 'Enter the parlay odds (e.g. +450 or -110)'
        : `Enter odds for ${betCount} bets, comma separated (e.g. +450, -110)`;

    const modal = new ModalBuilder()
        .setCustomId(`parlay_odds_modal_${interactionId}`)
        .setTitle('Enter Parlay Odds');

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds_input')
        .setLabel(label.slice(0, 45)) // Discord label max 45 chars
        .setPlaceholder(betCount === 1 ? '+450' : '+450, -110')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(oddsInput));
    await interaction.showModal(modal);
}

// ============================================================
// MODAL SUBMIT — update DB + tracker embeds with new odds
// ============================================================
async function handleOddsModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const interactionId = interaction.customId.replace('parlay_odds_modal_', '');
    const pending = pendingOdds.get(interactionId);

    if (!pending) {
        return interaction.editReply({
            content: '⚠️ This prompt has expired. Use `/admin editbet` to update the odds manually.'
        });
    }

    // Parse comma-separated odds input
    const rawInput = interaction.fields.getTextInputValue('odds_input');
    const oddsParts = rawInput.split(',').map(s => s.trim()).filter(Boolean);
    const parsedOdds = oddsParts.map(s => parseInt(s.replace('+', ''), 10));

    if (parsedOdds.some(isNaN)) {
        return interaction.editReply({
            content: '⚠️ Invalid odds format. Use American odds like `+450` or `-110`.'
        });
    }

    // Clear the pending entry
    clearTimeout(pending.ttl);
    pendingOdds.delete(interactionId);

    const { bets, trackerChannelId } = pending;

    try {
        const trackerChannel = await interaction.client.channels.fetch(trackerChannelId);

        for (let i = 0; i < bets.length; i++) {
            const bet = bets[i];
            // Use provided odds in order; if fewer odds values than bets, use last one
            const newOdds = parsedOdds[i] ?? parsedOdds[parsedOdds.length - 1];
            const newPayout = calculatePayout(bet.risk, newOdds);

            // Update DB
            await pool.query(
                `UPDATE bets SET odds = $1, payout = $2 WHERE id = $3`,
                [newOdds, newPayout, bet.betId]
            );

            // Rebuild and edit tracker embed
            if (bet.trackerMessageId && trackerChannel) {
                const trackerMsg = await trackerChannel.messages.fetch(bet.trackerMessageId).catch(() => null);
                if (trackerMsg) {
                    const updatedEmbed = new EmbedBuilder()
                        .setTitle(bet.description)
                        .setColor(0x3498db)
                        .addFields(
                            { name: 'Sport', value: bet.sport, inline: true },
                            { name: 'Risk', value: `${bet.risk}u`, inline: true },
                            { name: 'Odds', value: newOdds.toString(), inline: true },
                            { name: 'Payout', value: `${newPayout}u`, inline: true }
                        )
                        .setTimestamp(trackerMsg.embeds[0]?.timestamp ? new Date(trackerMsg.embeds[0].timestamp) : new Date());

                    await trackerMsg.edit({ embeds: [updatedEmbed] });
                }
            }
        }

        const label = bets.length > 1 ? `${bets.length} bets updated` : 'Bet updated';
        return interaction.editReply({ content: `✅ ${label} with odds: ${parsedOdds.map(o => (o > 0 ? '+' : '') + o).join(', ')}` });

    } catch (err) {
        console.error('Error updating parlay odds:', err);
        return interaction.editReply({ content: `❌ Error updating odds: ${err.message}` });
    }
}

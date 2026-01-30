const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../utils/db');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { channel } = require('diagnostics_channel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bet')
        .setDescription('Bet commands')
        .addSubcommand(sub =>
            sub
                .setName('post')
                .setDescription('Post a new bet (opens form)')
        )
        .addSubcommand(sub =>
            sub
                .setName('settle')
                .setDescription('Settle one of your pending bets')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'post') return handlePostCommand(interaction);
        if (sub === 'settle') return handleSettle(interaction);
    }
};

// ------------------------------------------------------------
// POST COMMAND - SHOW MODAL
// ------------------------------------------------------------
async function handlePostCommand(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('bet_post_modal')
        .setTitle('Post a New Bet');

    const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Bet Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const sportInput = new TextInputBuilder()
        .setCustomId('sport')
        .setLabel('Sport (NFL, NBA, etc.)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds (e.g., -110, +150)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);


    modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(sportInput),
        new ActionRowBuilder().addComponents(oddsInput),
    );

    return interaction.showModal(modal);
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

    // Discord dropdown max is 25 options, so paginate if needed
    const options = rows.map(bet => ({
        label: bet.bet_description.substring(0, 100),
        value: bet.id
    }));

    if (options.length <= 25) {
        // Single page
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

    // Multiple pages needed
    const firstPageOptions = options.slice(0, 25);
    const secondPageOptions = options.slice(25, 50);
    const thirdPageOptions = options.slice(50, 75);

    const menu1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`settle_select_${userId}`)
            .setPlaceholder(`Select a bet (Page 1 of ${Math.ceil(options.length / 25)})`)
            .addOptions(firstPageOptions)
    );

    const components = [menu1];

    if (secondPageOptions.length > 0) {
        const menu2 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_select_page2_${userId}`)
                .setPlaceholder(`Select a bet (Page 2 of ${Math.ceil(options.length / 25)})`)
                .addOptions(secondPageOptions)
        );
        components.push(menu2);
    }

    if (thirdPageOptions.length > 0) {
        const menu3 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`settle_select_page3_${userId}`)
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

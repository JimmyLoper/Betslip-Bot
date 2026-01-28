const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('betladder')
        .setDescription('Ladder betting commands')
        .addSubcommand(sub =>
            sub
                .setName('post')
                .setDescription('Start a multi-step ladder bet workflow')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'post') {
            return startLadderFlow(interaction);
        }
    }
};

// ------------------------------------------------------------
// LADDER FLOW ENTRY POINT
// ------------------------------------------------------------
async function startLadderFlow(interaction) {
    const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

    const stepSelect = new StringSelectMenuBuilder()
        .setCustomId('ladder_step_count')
        .setPlaceholder('Select number of steps')
        .addOptions(
            { label: '2 Steps', value: '2' },
            { label: '3 Steps', value: '3' },
            { label: '4 Steps', value: '4' },
            { label: '5 Steps', value: '5' }
        );

    const row = new ActionRowBuilder().addComponents(stepSelect);

    return interaction.reply({
        content: 'How many steps does this ladder have',
        components: [row],
        ephemeral: true
    });
}
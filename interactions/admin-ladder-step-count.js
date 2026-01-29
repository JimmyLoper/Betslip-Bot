const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    customIds: ['admin_ladder_step_count'],
    async execute(interaction) {
        const totalSteps = parseInt(interaction.values[0], 10);
        
        // Initialize ladder cache for this user
        interaction.client.ladderCache ??= new Map();
        interaction.client.ladderCache.set(interaction.user.id, {
            steps: [],
            totalSteps,
            capperId: null,
            capperUsername: null,
            channelId: interaction.channel.id
        });

        // Show first step modal
        await showAdminLadderStepModal(interaction, 1, totalSteps);
    }
};

async function showAdminLadderStepModal(interaction, stepNumber, totalSteps) {
    const modal = new ModalBuilder()
        .setCustomId(`admin_ladder_step_modal_${stepNumber}_${totalSteps}`)
        .setTitle(`Step ${stepNumber} of ${totalSteps}`);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Bet Description')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const riskInput = new TextInputBuilder()
        .setCustomId('risk')
        .setLabel('Risk (units)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const oddsInput = new TextInputBuilder()
        .setCustomId('odds')
        .setLabel('Odds (e.g., -110, +150)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const messageIdInput = new TextInputBuilder()
        .setCustomId('message_id')
        .setLabel('Message ID (from betslip)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(riskInput),
        new ActionRowBuilder().addComponents(oddsInput),
        new ActionRowBuilder().addComponents(messageIdInput)
    );

    await interaction.showModal(modal);
}

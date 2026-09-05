// Prefix match needed for dynamic customIds like ladder_step_modal_1_5
function findInteractionHandler(client, customId) {
    if (client.interactions.has(customId)) {
        return client.interactions.get(customId);
    }

    for (const [id, handler] of client.interactions.entries()) {
        if (customId.startsWith(id)) {
            return handler;
        }
    }

    console.warn(`No handler found for customId: ${customId}`);
    return null;
}

async function handleInteraction(interaction, client) {
    // ------------------------------------------------------------
    // SLASH COMMANDS
    // ------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(err);
            if (!interaction.replied) {
                await interaction.reply({
                    content: 'There was an error executing this command.',
                    ephemeral: true
                });
            }
        }
        return;
    }

    // ------------------------------------------------------------
    // STRING SELECT MENUS
    // ------------------------------------------------------------
    if (interaction.isStringSelectMenu()) {
        const handler = findInteractionHandler(client, interaction.customId);
        if (!handler) return;

        try {
            await handler.execute(interaction);
        } catch (err) {
            console.error(err);
            await interaction.reply({
                content: 'Error handling selection.',
                ephemeral: true
            });
        }
        return;
    }

    // ------------------------------------------------------------
    // BUTTONS
    // ------------------------------------------------------------
    if (interaction.isButton()) {
        const handler = findInteractionHandler(client, interaction.customId);
        if (!handler) {
            console.warn(`No handler found for button customId: ${interaction.customId}`);
            return;
        }

        try {
            await handler.execute(interaction);
        } catch (err) {
            console.error(`Error in button handler for ${interaction.customId}:`, err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Error handling button.',
                    ephemeral: true
                });
            }
        }
        return;
    }

    // ------------------------------------------------------------
    // MODALS
    // ------------------------------------------------------------
    if (interaction.isModalSubmit()) {
        const handler = findInteractionHandler(client, interaction.customId);
        if (!handler) return;

        try {
            await handler.execute(interaction);
        } catch (err) {
            console.error(err);
            await interaction.reply({
                content: 'Error handling modal.',
                ephemeral: true
            });
        }
    }
}

module.exports = { handleInteraction };

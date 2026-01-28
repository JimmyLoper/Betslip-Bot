require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Collection
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ------------------------------------------------------------
// LOAD COMMANDS
// ------------------------------------------------------------
client.commands = new Collection();

const commandsPath = path.join(process.cwd(), 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
}

// ------------------------------------------------------------
// LOAD INTERACTION HANDLERS (dropdowns, buttons, etc.)
// ------------------------------------------------------------
client.interactions = new Collection();

const interactionsPath = path.join(process.cwd(), 'interactions');
if (fs.existsSync(interactionsPath)) {
    const interactionFiles = fs.readdirSync(interactionsPath).filter(file => file.endsWith('.js'));

    for (const file of interactionFiles) {
        const filePath = path.join(interactionsPath, file);
        const handler = require(filePath);

        if (handler.customIds && Array.isArray(handler.customIds)) {
            for (const id of handler.customIds) {
                client.interactions.set(id, handler);
            }
        }
    }
}

// ------------------------------------------------------------
// INTERACTION ROUTER
// ------------------------------------------------------------
client.on('interactionCreate', async interaction => {

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
        const handler = findInteractionHandler(interaction.customId);
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
        const handler = findInteractionHandler(interaction.customId);
        if (!handler) return;

        try {
            await handler.execute(interaction);
        } catch (err) {
            console.error(err);
            await interaction.reply({
                content: 'Error handling button.',
                ephemeral: true
            });
        }
        return;
    }

    // ------------------------------------------------------------
    // MODALS
    // ------------------------------------------------------------
    if (interaction.isModalSubmit()) {
        const handler = findInteractionHandler(interaction.customId);
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
});

function findInteractionHandler(customId) {
    // Exact match first
    if (client.interactions.has(customId)) {
        return client.interactions.get(customId);
    }

    // Prefix match (for ladder_step_modal_1_5, etc.)
    for (const [id, handler] of client.interactions.entries()) {
        if (customId.startsWith(id)) {
            return handler;
        }
    }

    return null;
}

// ------------------------------------------------------------
// READY + LOGIN
// ------------------------------------------------------------
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
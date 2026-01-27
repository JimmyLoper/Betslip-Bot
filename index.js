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
        const parts = interaction.customId.split('_');
        const baseId = `${parts[0]}_${parts[1]}`; // settle_select
        
        const handler = client.interactions.get(baseId);
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
        // settle_win_<betId>
        // settle_loss_<betId>
        // settle_push_<betId>
        // settle_msg_yes_<betId>_<result>
        // settle_msg_no_<betId>_<result>

        const parts = interaction.customId.split('_');
        const baseId = `${parts[0]}_${parts[1]}`; // settle_win, settle_loss, settle_push, settle_msg

        const handler = client.interactions.get(baseId);
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
        // settle_modal_<betId>_<result>
        const baseId = interaction.customId.split('_')[0]; // settle

        const handler = client.interactions.get(baseId + '_modal');
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

// ------------------------------------------------------------
// READY + LOGIN
// ------------------------------------------------------------
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
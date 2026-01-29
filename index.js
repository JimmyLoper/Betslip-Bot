require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Collection
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// pendingUploads: userId -> { betId, expiresAt, timeout }
client.pendingUploads = new Map();
const db = require('./utils/db');

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

// Listen for attachment messages from users who are in pending upload state
client.on('messageCreate', async message => {
    try {
        if (message.author?.bot) return;

        const pending = client.pendingUploads.get(message.author.id);
        if (!pending) return;

        if (!message.attachments || message.attachments.size === 0) return;

        // Use the first attachment
        const attachment = message.attachments.first();
        if (!attachment) return;

        const betId = pending.betId;

        // Fetch bet record to find the original message
        const { rows } = await db.query(
            `SELECT message_id, channel_id FROM bets WHERE id = $1`,
            [betId]
        );

        const row = rows[0];
        if (!row || !row.message_id || !row.channel_id) {
            // cleanup
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel) {
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        const original = await channel.messages.fetch(row.message_id).catch(() => null);
        if (!original) {
            clearTimeout(pending.timeout);
            client.pendingUploads.delete(message.author.id);
            return;
        }

        // Edit the original message to include the attachment
        try {
            await original.edit({
                content: original.content,
                components: original.components,
                files: [attachment.url]
            });
        } catch (err) {
            console.error('Failed to attach screenshot to bet message:', err);
        }

        // Attempt to delete the user's upload message to keep channel clean
        try {
            await message.delete();
        } catch (err) {
            // ignore delete errors
        }

        // Clear pending state
        clearTimeout(pending.timeout);
        client.pendingUploads.delete(message.author.id);

        // Try to DM the user a confirmation
        try {
            await message.author.send('Screenshot attached to your bet.');
        } catch (err) {
            // ignore DM failures
        }

    } catch (err) {
        console.error('Error handling pending upload message:', err);
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
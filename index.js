require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadInteractions } = require('./handlers/loadInteractions');
const { handleInteraction } = require('./handlers/interactionRouter');
const { handlePendingUpload } = require('./handlers/pendingUpload');
const { handleMentionMessageCreate, handleMentionMessageUpdate } = require('./handlers/mentionBetScan');
const { winibleEmbedScan } = require('./handlers/winibleEmbedScan');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// pendingUploads: userId -> { betId, expiresAt, timeout }
client.pendingUploads = new Map();

client.commands = loadCommands();
client.interactions = loadInteractions();

// ------------------------------------------------------------
// EVENT DELEGATION
// ------------------------------------------------------------
client.on('interactionCreate', interaction => handleInteraction(interaction, client));

client.on('messageCreate', message => handlePendingUpload(message, client));

client.on('messageCreate', message => handleMentionMessageCreate(message, client));

client.on('messageUpdate', (oldMessage, newMessage) => handleMentionMessageUpdate(oldMessage, newMessage, client));

client.on('messageCreate', async message => {
    try {
        // Winible Bot embed listener
        await winibleEmbedScan(message);

        // existing mention bot scan logic below unchanged...
    } catch (error) {
        console.error('Error handling Winible embed scan:', error);
    }
});

// ------------------------------------------------------------
// READY + LOGIN
// ------------------------------------------------------------
client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
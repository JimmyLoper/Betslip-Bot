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
    // BUTTONS
    if (interaction.isButton()) {
        const handler = findInteractionHandler(interaction.customId);
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

// ============================================================
// SHARED: PROCESS A BOT-MENTION MESSAGE AS A BET SCAN
// Returns true if bets were tracked, false if skipped/failed.
// ============================================================
async function processMentionBet(message) {
    // Only act in registered bet channels
    const { rows: capperRows } = await db.query(
        `SELECT notify_role_id, tracker_channel_id FROM capper_info WHERE channel_id = $1`,
        [message.channelId]
    );
    if (capperRows.length === 0) return false;

    const userId = message.author.id;
    const username = message.author.username;

    // Strip all mentions from content to isolate the description/units text
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();

    const { parseDescriptionInput } = require('./utils/parseDescription');
    const { units, note, eachUnit, unitMap } = parseDescriptionInput(cleanContent);
    const attachment = message.attachments.first();

    // ── No units or no screenshot → fall back to admin DM notification ──
    if (units.length === 0 || !attachment) {
        const adminId = process.env.ADMIN_OVERRIDE_ID;
        if (!adminId) return false;
        const admin = await client.users.fetch(adminId).catch(() => null);
        if (!admin) return false;

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('Bot Mentioned!')
            .setDescription(`Someone mentioned the bot in ${message.guild?.name || 'DM'}`)
            .addFields(
                { name: 'User', value: `${message.author} (${message.author.id})`, inline: false },
                { name: 'Channel', value: message.channel?.toString() || 'DM', inline: false },
                { name: 'Message', value: message.content.substring(0, 1024), inline: false }
            )
            .setColor(0xFFA500)
            .setTimestamp()
            .setFooter({ text: `Message ID: ${message.id}` });

        await admin.send({ embeds: [embed] }).catch(err => console.error('Failed to send DM:', err));
        return false;
    }

    // ── BET SCAN FLOW ────────────────────────────────────────────────────

    // 1. Fetch & base64 encode the screenshot
    let imageBase64, imageMediaType = 'image/jpeg';
    try {
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');

        const fetchBuffer = (url) => new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const lib = parsedUrl.protocol === 'https:' ? https : http;
            lib.get(url, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
                res.on('error', reject);
            }).on('error', reject);
        });

        const { buffer, contentType } = await fetchBuffer(attachment.url);
        imageBase64 = buffer.toString('base64');
        if (contentType.includes('png')) imageMediaType = 'image/png';
        else if (contentType.includes('gif')) imageMediaType = 'image/gif';
        else if (contentType.includes('webp')) imageMediaType = 'image/webp';
        else imageMediaType = 'image/jpeg';
    } catch (fetchErr) {
        console.error('Failed to fetch screenshot from mention message:', fetchErr);
        await message.author.send('⚠️ Could not read your screenshot. Please try `/bet post` instead.').catch(() => {});
        return false;
    }

    // 2. Call Claude API
    let parsedBets;
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const { buildSystemPrompt } = require('./utils/sbParsers');
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            system: buildSystemPrompt(),
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
                    { type: 'text', text: 'Parse this betslip screenshot and return only a JSON array.' }
                ]
            }]
        });

        const rawText = response.content[0].text.trim();
        parsedBets = JSON.parse(rawText);
        if (!Array.isArray(parsedBets) || parsedBets.length === 0) throw new Error('Empty or non-array response');
    } catch (claudeErr) {
        console.error('Claude parse error (mention flow):', claudeErr);
        await message.author.send('⚠️ Could not parse your betslip. Please try `/bet post` instead.').catch(() => {});
        return false;
    }

    // 3. Map units to bets
    const { mapUnitsToBets } = require('./utils/mapUnits');
    const { calculatePayout } = require('./utils/calcPayout');
    const { randomUUID } = require('crypto');
    const { postBetToTrackerChannel } = require('./commands/bet');

    const mappedBets = mapUnitsToBets(units, parsedBets, eachUnit, unitMap);
    const timestamp = Date.now();

    // 4. Post each bet to tracker + insert into DB (no public channel post)
    for (const bet of mappedBets) {
        const betId = randomUUID();
        const payout = calculatePayout(bet.risk, bet.odds);

        const trackerMessageId = await postBetToTrackerChannel(
            client,
            userId,
            betId,
            bet.description,
            bet.risk,
            bet.sport,
            bet.odds,
            attachment.url,
            null
        );

        await db.query(
            `INSERT INTO bets
            (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp, message_id, channel_id, tracker_message_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)`,
            [betId, userId, username, bet.description, bet.sport, bet.risk, bet.odds, payout, timestamp, message.id, message.channelId, trackerMessageId || null]
        );
    }

    // No public post — tracker channel message serves as confirmation
    return true;
}

// ============================================================
// BOT MENTION → BET SCAN (or admin notification fallback)
// ============================================================
client.on('messageCreate', async message => {
    try {
        if (message.author?.bot) return;

        // Skip replies — only handle direct mentions
        if (message.reference) return;

        if (!message.mentions.has(client.user.id)) return;
        if (message.mentions.everyone) return;

        await processMentionBet(message);
    } catch (err) {
        console.error('Error in mention bet scan handler:', err);
    }
});

// ============================================================
// MESSAGE EDIT → BET SCAN (catches forgotten units added later)
// ============================================================
client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
        // Fetch full message if partial
        if (newMessage.partial) {
            newMessage = await newMessage.fetch().catch(() => null);
            if (!newMessage) return;
        }

        if (newMessage.author?.bot) return;
        if (newMessage.reference) return;
        if (!newMessage.mentions.has(client.user.id)) return;
        if (newMessage.mentions.everyone) return;

        // Guard: skip if this message has already been tracked
        const { rows } = await db.query(
            `SELECT 1 FROM bets WHERE message_id = $1 LIMIT 1`,
            [newMessage.id]
        );
        if (rows.length > 0) return;

        await processMentionBet(newMessage);
    } catch (err) {
        console.error('Error in messageUpdate bet scan handler:', err);
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

    console.warn(`No handler found for customId: ${customId}`);
    return null;
}

// ------------------------------------------------------------
// READY + LOGIN
// ------------------------------------------------------------
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const commands = [];
const foldersPath = path.join(process.cwd(), 'src/commands');
const commandFiles = fs.readdirSync(foldersPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(foldersPath, file);
    const command = await import(`file://${filePath}`);
    if ('data' in command.default && 'execute' in command.default) {
        commands.push(command.default.data.toJSON());
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
    console.log(`Deploying ${commands.length} commands...`);
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands },
    );
    console.log('Commands deployed.');
} catch (error) {
    console.error(error);
}

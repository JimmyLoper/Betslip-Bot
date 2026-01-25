import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('example')
        .setDescription('Example command from the template'),

    async execute(interaction) {
        await interaction.reply('This is an example command.');
    }
};

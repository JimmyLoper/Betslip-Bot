export function enforceChannelLock(interaction, allowedChannelId) {
    if (interaction.channelId !== allowedChannelId) {
        return interaction.reply({
            content: `This command can only be used in the designated channel.`,
            ephemeral: true
        });
    }

    return true;
}

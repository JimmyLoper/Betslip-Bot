const db = require('../db');
const { randomUUID } = require('crypto');
const { calculatePayout } = require('../utils/calcPayout');

module.exports = {
    customIds: ['ladder_final_modal'],

    async execute(interaction) {
        const userId = interaction.user.id;

        // Pull cached steps
        const steps = interaction.client.ladderCache?.get(userId);
        if (!steps || steps.length === 0) {
            return interaction.reply({
                content: 'Error: No ladder steps found. Please try again.',
                ephemeral: true
            });
        }

        // Final modal inputs
        const overallDescription = interaction.fields.getTextInputValue('overall_description');
        const screenshot = interaction.fields.getTextInputValue('screenshot') || null;
        const sport = interaction.fields.getTextInputValue('sport'); // <-- keep THIS one

        const capperId = interaction.user.id;
        const capperUsername = interaction.user.username;

        // ------------------------------------------------------------
        // INSERT EACH STEP AS ITS OWN BET ROW (YOUR EXACT FORMAT)
        // ------------------------------------------------------------
        const insertedIds = [];

        for (const step of steps) {
            const { description, risk, odds } = step;

            const payout = calculatePayout(risk, odds);
            const id = randomUUID();
            const timestamp = Date.now();

            await db.query(
                `INSERT INTO bets 
                (id, user_id, username, bet_description, sport, risk, odds, payout, result, timestamp)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
                [
                    id,
                    capperId,
                    capperUsername,
                    description,
                    sport,
                    risk,
                    odds,
                    payout,
                    timestamp
                ]
            );

            insertedIds.push(id);
        }

        // ------------------------------------------------------------
        // BUILD LADDER SLIP MESSAGE (YOUR EXACT FORMAT)
        // ------------------------------------------------------------

        const notifyRoleId = await getNotifyRoleForUser(capperId);
        const notifyPing = notifyRoleId ? `<@&${notifyRoleId}>` : '';

        let stepsText = '';
        steps.forEach((step, i) => {
            stepsText += `${step.risk}u\n`;
        });

        let messageText =
`${notifyPing}

${overallDescription}

${stepsText}`;

        if (screenshot) {
            messageText += `\nScreenshot: ${screenshot}`;
        }

        // Post ladder slip
        const sent = await interaction.channel.send(messageText);

        // Update each bet row with message + channel
        for (const betId of insertedIds) {
            await db.query(
                `UPDATE bets 
                SET message_id = $1, channel_id = $2 
                WHERE id = $3`,
                [sent.id, sent.channel.id, betId]
            );
        }

        // Clear cache
        interaction.client.ladderCache.delete(userId);

        return interaction.reply({
            content: `Ladder bet posted successfully with ${steps.length} steps.`,
            ephemeral: true
        });
    }
};
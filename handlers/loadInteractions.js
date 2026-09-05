const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

function loadInteractions() {
    const interactions = new Collection();

    const interactionsPath = path.join(process.cwd(), 'interactions');
    if (fs.existsSync(interactionsPath)) {
        const interactionFiles = fs.readdirSync(interactionsPath).filter(file => file.endsWith('.js'));

        for (const file of interactionFiles) {
            const filePath = path.join(interactionsPath, file);
            const handler = require(filePath);

            if (handler.customIds && Array.isArray(handler.customIds)) {
                for (const id of handler.customIds) {
                    interactions.set(id, handler);
                }
            }
        }
    }

    return interactions;
}

module.exports = { loadInteractions };

/**
 * Shared in-memory store for pending /bet edit flows.
 * Keyed by interaction ID, value is { screenshotUrl, channelId }
 * Each entry has a 5-minute TTL managed via setTimeout.
 */
const pendingEdits = new Map();

module.exports = { pendingEdits };

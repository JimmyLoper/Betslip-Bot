/**
 * Shared in-memory store for pending scan confirmations.
 * Keyed by interaction ID, value is { bets, screenshotUrl, link, userId, username, channelId, note, notifyRoleId }
 * Each entry has a 5-minute TTL managed via setTimeout.
 */
const pendingScans = new Map();

module.exports = { pendingScans };

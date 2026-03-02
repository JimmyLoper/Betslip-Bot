/**
 * Shared in-memory store for bets that were posted with odds = 0
 * (e.g. unplaced FanDuel parlay where combined odds weren't visible).
 * Keyed by interaction ID.
 * Each entry has a 10-minute TTL.
 */
const pendingOdds = new Map();

module.exports = { pendingOdds };

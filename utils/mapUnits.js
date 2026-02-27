/**
 * Maps unit sizes to parsed bets.
 *
 * Sorting logic:
 * - Bets sorted by odds ascending = most likely outcomes first
 *   (-350 < -150 < -110 < +100 < +150 < +300)
 * - Units sorted descending = largest unit first
 * - Largest unit maps to most likely (shortest odds) bet
 *
 * If more bets than units: apply the smallest unit to remaining bets
 * If more units than bets: ignore extras
 *
 * @param {string[]} units - Array of unit strings e.g. ['1u', '0.5u', '0.25u']
 * @param {object[]} bets - Array of bet objects from Claude parser
 * @returns {object[]} - Array of { ...bet, risk: number } objects
 */
function mapUnitsToBets(units, bets) {
    if (!bets || bets.length === 0) return [];
    if (!units || units.length === 0) return bets.map(b => ({ ...b, risk: 1 }));

    // Sort bets by odds ascending (most likely first)
    // American odds: negative = more likely, lower negative = more likely
    // -350 < -150 < -110 < +100 < +150 < +300
    const sortedBets = [...bets].sort((a, b) => {
        const oddsA = Number(a.odds);
        const oddsB = Number(b.odds);
        return oddsA - oddsB;
    });

    // Sort units descending (largest first)
    const sortedUnits = [...units].sort((a, b) => {
        const valA = parseFloat(a.replace('u', ''));
        const valB = parseFloat(b.replace('u', ''));
        return valB - valA;
    });

    const smallestUnit = sortedUnits[sortedUnits.length - 1];
    const smallestUnitValue = parseFloat(smallestUnit.replace('u', ''));

    return sortedBets.map((bet, index) => {
        let riskStr;
        if (index < sortedUnits.length) {
            riskStr = sortedUnits[index];
        } else {
            riskStr = smallestUnit;
        }
        const risk = parseFloat(riskStr.replace('u', ''));
        return { ...bet, risk };
    });
}

module.exports = { mapUnitsToBets };

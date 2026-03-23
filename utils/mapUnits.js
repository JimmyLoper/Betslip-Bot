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
 * Safety check: one unit + no eachUnit + empty unitMap = return only first bet
 * unitMap support: assign units to bets based on betType matching
 * eachUnit support: apply single unit to every bet
 *
 * @param {string[]} units - Array of unit strings e.g. ['1u', '0.5u', '0.25u']
 * @param {object[]} bets - Array of bet objects from Claude parser
 * @param {boolean} [eachUnit=false] - If true, apply the first unit to every bet
 * @param {object} [unitMap={}] - Map of bet type keys to unit strings e.g. { straight: '0.5u', parlay: '0.25u' }
 * @returns {object[]} - Array of { ...bet, risk: number } objects
 */
function mapUnitsToBets(units, bets, eachUnit = false, unitMap = {}) {
    if (!bets || bets.length === 0) return [];
    if (!units || units.length === 0) return bets.map(b => ({ ...b, risk: 1 }));

    const unitMapKeys = Object.keys(unitMap);

    // ── Safety check: one unit, no eachUnit, no unitMap = single bet ──
    if (units.length === 1 && !eachUnit && unitMapKeys.length === 0) {
        const risk = parseFloat(units[0].replace('u', ''));
        return [{ ...bets[0], risk }];
    }

    // ── eachUnit: apply the single unit to every bet ──
    if (eachUnit && units.length > 0) {
        const risk = parseFloat(units[0].replace('u', ''));
        return bets.map(b => ({ ...b, risk }));
    }

    // ── unitMap: assign units by betType matching ──
    if (unitMapKeys.length > 0) {
        // Determine the largest unit value as fallback
        const sortedUnits = [...units].sort((a, b) => {
            const valA = parseFloat(a.replace('u', ''));
            const valB = parseFloat(b.replace('u', ''));
            return valB - valA;
        });
        const fallbackRisk = parseFloat(sortedUnits[0].replace('u', ''));

        // Map betType values to unitMap keys
        const straightTypes = ['spread', 'moneyline', 'total', 'prop'];
        const parlayTypes = ['parlay', 'SGP', 'SGPx'];
        const sgpTypes = ['SGP', 'SGPx', 'SGP+'];

        return bets.map(bet => {
            const betType = bet.betType || '';
            let risk = fallbackRisk;

            if (unitMap.straight && straightTypes.includes(betType)) {
                risk = parseFloat(unitMap.straight.replace('u', ''));
            } else if (unitMap.parlay && parlayTypes.includes(betType)) {
                risk = parseFloat(unitMap.parlay.replace('u', ''));
            } else if (unitMap.SGP && sgpTypes.includes(betType)) {
                risk = parseFloat(unitMap.SGP.replace('u', ''));
            }

            return { ...bet, risk };
        });
    }

    // ── Default: sort bets by odds ascending, units descending ──
    // Sort bets by odds ascending (most likely first)
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

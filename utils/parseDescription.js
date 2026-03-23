/**
 * Parses a capper's description input to extract unit sizes, notes, and contextual unit assignments.
 *
 * Handles formats: 1, 1u, 1 u, 1unit, 1 unit, 1units, 1 units, 0.5, 0.25, .2, .25, etc.
 * Also detects contextual keywords: "each", "both", "straight(s)", "parlay(s)", "SGP"
 *
 * Examples:
 *   "Kam 1u 0.25u 0.15u"       → { units: ['1u', '0.25u', '0.15u'], note: 'Kam', eachUnit: false, unitMap: {} }
 *   "1u each"                   → { units: ['1u'], note: '', eachUnit: true, unitMap: {} }
 *   "0.5u straight 0.25u parlay"→ { units: ['0.5u', '0.25u'], note: '', eachUnit: false, unitMap: { straight: '0.5u', parlay: '0.25u' } }
 *   "1u SGP"                    → { units: ['1u'], note: '', eachUnit: false, unitMap: { SGP: '1u' } }
 *
 * @param {string} descriptionText
 * @returns {{ units: string[], note: string, eachUnit: boolean, unitMap: object }}
 */
function parseDescriptionInput(descriptionText) {
    if (!descriptionText || typeof descriptionText !== 'string') {
        return { units: [], note: '', eachUnit: false, unitMap: {} };
    }

    // Detect contextual unit assignment patterns: "Xu straight", "Xu parlay", "Xu SGP", "Xu each", "Xu both"
    const contextRegex = /(\d*\.?\d+)\s*(?:units?|u(?![a-z]))\s+(each|both|straights?|parlays?|sgp)\b/gi;
    const unitMap = {};
    let eachUnit = false;
    let remaining = descriptionText;

    let ctxMatch;
    while ((ctxMatch = contextRegex.exec(descriptionText)) !== null) {
        const value = parseFloat(ctxMatch[1]);
        const keyword = ctxMatch[2].toLowerCase().replace(/s$/, ''); // normalize: straights→straight, parlays→parlay

        if (keyword === 'each' || keyword === 'both') {
            eachUnit = true;
        } else if (keyword === 'straight') {
            unitMap.straight = `${value}u`;
        } else if (keyword === 'parlay') {
            unitMap.parlay = `${value}u`;
        } else if (keyword === 'sgp') {
            unitMap.SGP = `${value}u`;
        }

        // Remove matched portion from remaining string
        remaining = remaining.replace(ctxMatch[0], ' ');
    }

    // Regex matches: number (with or without leading zero before decimal) followed by optional whitespace and unit suffix
    // Captures: (number)(optional whitespace)(u|unit|units)
    // Handles: 1u, 0.5u, .5u, .25u, 1 unit, 1units, etc.
    const unitRegex = /(\d*\.?\d+)\s*(?:units?|u(?![a-z]))/gi;

    const units = [];

    // Add contextual units to the units array first
    const contextValues = Object.values(unitMap);
    if (eachUnit) {
        // Re-parse original for the "each"/"both" unit value
        const eachRegex = /(\d*\.?\d+)\s*(?:units?|u(?![a-z]))\s+(?:each|both)\b/gi;
        const eachMatch = eachRegex.exec(descriptionText);
        if (eachMatch) {
            units.push(`${parseFloat(eachMatch[1])}u`);
        }
    }
    for (const v of contextValues) {
        if (!units.includes(v)) units.push(v);
    }

    // Parse remaining text for any non-contextual unit values
    let match;
    while ((match = unitRegex.exec(remaining)) !== null) {
        const value = parseFloat(match[1]);
        const unitStr = `${value}u`;
        units.push(unitStr);
        // Remove matched portion from remaining string
        remaining = remaining.replace(match[0], ' ');
    }

    // Clean up the remaining text to extract the note
    const note = remaining
        .replace(/\s+/g, ' ')
        .trim();

    return { units, note, eachUnit, unitMap };
}

module.exports = { parseDescriptionInput };

/**
 * Parses a capper's description input to extract unit sizes and notes.
 *
 * Handles formats: 1, 1u, 1 u, 1unit, 1 unit, 1units, 1 units, 0.5, 0.25, etc.
 *
 * Examples:
 *   "Kam 1u 0.25u 0.15u"  → { units: ['1u', '0.25u', '0.15u'], note: 'Kam' }
 *   "1 unit"              → { units: ['1u'], note: '' }
 *   "0.5 units"           → { units: ['0.5u'], note: '' }
 *   "2"                   → { units: ['2u'], note: '' }
 *
 * @param {string} descriptionText
 * @returns {{ units: string[], note: string }}
 */
function parseDescriptionInput(descriptionText) {
    if (!descriptionText || typeof descriptionText !== 'string') {
        return { units: [], note: '' };
    }

    // Regex matches: optional decimal number followed by optional whitespace and unit suffix
    // Captures: (number)(optional whitespace)(u|unit|units)
    const unitRegex = /(\d+(?:\.\d+)?)\s*(?:units?|u(?![a-z]))/gi;

    const units = [];
    let remaining = descriptionText;

    let match;
    while ((match = unitRegex.exec(descriptionText)) !== null) {
        const value = parseFloat(match[1]);
        units.push(`${value}u`);
        // Remove matched portion from remaining string
        remaining = remaining.replace(match[0], ' ');
    }

    // Clean up the remaining text to extract the note
    const note = remaining
        .replace(/\s+/g, ' ')
        .trim();

    return { units, note };
}

module.exports = { parseDescriptionInput };

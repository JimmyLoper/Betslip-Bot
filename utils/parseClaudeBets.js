// utils/parseClaudeBets.js

/**
 * Returns the trimmed text of the first text block in a Claude response.
 * Doesn't assume content[0] is text (other block types can come first).
 */
function getResponseText(response) {
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || !textBlock.text) throw new Error('No text content in Claude response');
    return textBlock.text.trim();
}

/**
 * Parses the JSON array of bets out of Claude's raw text.
 * Claude sometimes self-corrects mid-response and prints a second array — take the last (final) one.
 */
function parseBetsArray(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (parseErr) {
        const matches = rawText.match(/\[[\s\S]*?\]/g);
        if (!matches || matches.length === 0) throw parseErr;
        parsed = JSON.parse(matches[matches.length - 1]);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Empty or non-array response from Claude');
    }
    return parsed;
}

module.exports = { getResponseText, parseBetsArray };

// utils/calcPayout.js

function calculatePayout(risk, odds) {
    // Convert to numbers if strings were passed
    const r = parseFloat(risk);
    const o = parseInt(odds, 10);

    // odds of 0 means "not known yet" (see the Enter Odds prompt) — avoid dividing by zero below
    if (isNaN(r) || isNaN(o) || o === 0) {
        return 0;
    }

    let payout = 0;

    if (o > 0) {
        // Positive American odds
        payout = (r * o) / 100;
    } else {
        // Negative American odds
        payout = (r * 100) / Math.abs(o);
    }

    // Round to 2 decimals for DB consistency
    return Number(payout.toFixed(2));
}

module.exports = { calculatePayout };
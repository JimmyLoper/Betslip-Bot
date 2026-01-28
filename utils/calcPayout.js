// utils/calcPayout.js

function calculatePayout(risk, odds) {
    // Convert to numbers if strings were passed
    const r = parseFloat(risk);
    const o = parseInt(odds, 10);

    if (isNaN(r) || isNaN(o)) {
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
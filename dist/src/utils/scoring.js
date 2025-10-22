// Tunable weights (relative importance)
const WEIGHT = {
    info: 1,
    low: 2,
    medium: 4,
    high: 8,
    critical: 12,
};
/**
 * Compute a category score using a pass-ratio with severity weights.
 * - Each finding contributes weight(severity) points if PASSED, 0 if FAILED.
 * - Score = round(earned / max * 100).
 * - No findings => 100.
 * - Unknown severity => treated as 'low'.
 * - Unknown status => treated as 'fail'.
 */
export function computeCategoryScore(findings) {
    if (!Array.isArray(findings) || findings.length === 0) {
        return { score: 100, maxPoints: 0, earnedPoints: 0 };
    }
    let maxPoints = 0;
    let earnedPoints = 0;
    for (const f of findings) {
        const sev = (f?.severity ?? 'low');
        const w = WEIGHT[sev] ?? WEIGHT.low;
        maxPoints += w;
        const passed = f?.status === 'pass';
        if (passed)
            earnedPoints += w;
    }
    const score = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 100;
    return { score, maxPoints, earnedPoints };
}
/**
 * Compute overall score as the weighted average of category scores
 * using each category’s maxPoints as the weight.
 * - If all categories have 0 maxPoints, overall falls back to the
 *   simple average of category scores (or 100 if none).
 */
export function computeOverallScore(categories) {
    if (!Array.isArray(categories) || categories.length === 0)
        return 100;
    let weighted = 0;
    let totalWeight = 0;
    for (const c of categories) {
        const w = Math.max(0, c._maxPoints ?? 0);
        if (w > 0) {
            weighted += c.score * w;
            totalWeight += w;
        }
    }
    if (totalWeight > 0)
        return Math.round(weighted / totalWeight);
    // fallback: simple mean if no weights available
    const mean = categories.reduce((s, c) => s + (c.score ?? 0), 0) / categories.length;
    return Math.round(mean || 0);
}

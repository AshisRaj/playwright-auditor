import { Sev } from './helpers';
export interface FindingLike {
    severity?: Sev;
    status?: 'pass' | 'fail';
}
export interface CategoryScoreBreakdown {
    score: number;
    maxPoints: number;
    earnedPoints: number;
}
/**
 * Compute a category score using a pass-ratio with severity weights.
 * - Each finding contributes weight(severity) points if PASSED, 0 if FAILED.
 * - Score = round(earned / max * 100).
 * - No findings => 100.
 * - Unknown severity => treated as 'low'.
 * - Unknown status => treated as 'fail'.
 */
export declare function computeCategoryScore(findings: FindingLike[]): CategoryScoreBreakdown;
/**
 * Compute overall score as the weighted average of category scores
 * using each category’s maxPoints as the weight.
 * - If all categories have 0 maxPoints, overall falls back to the
 *   simple average of category scores (or 100 if none).
 */
export declare function computeOverallScore(categories: Array<{
    score: number;
    _maxPoints?: number;
}>): number;

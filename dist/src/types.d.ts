export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export interface Finding {
    /** Stable machine-readable id (e.g. 'cfg-trace', 'bp-eslint') */
    id: string;
    /** Human-friendly title for the check */
    title: string;
    /** Short message describing the result */
    message: string;
    /** Severity of the check (used for scoring on failures) */
    severity: Severity;
    /** Pass/Fail result for this validation */
    status: 'pass' | 'fail';
    /** Optional: suggestion for how to fix/improve */
    suggestion?: string;
    /** Optional: related file path (relative to target) */
    file?: string;
    /** Optional: artifacts (strings or URLs) to display/link in the report */
    artifacts?: Array<string>;
}
export interface CategoryResult {
    /** Stable machine-readable id (e.g. 'config', 'best', 'network') */
    id: string;
    /** Human-friendly category title */
    title: string;
    /** All validations (both pass and fail) */
    findings: Finding[];
    /** Category score in [0..100], computed from failed findings */
    score: number;
}
export interface AuditResult {
    /** Absolute path of the audited project directory */
    targetDir: string;
    /** ISO timestamp when the audit was produced */
    timestamp: string;
    /** All category sections */
    categories: CategoryResult[];
    /** Overall score [0..100] */
    overallScore: number;
}
export interface ScoringPolicy {
    /** Deduction per severity for failed findings */
    deductions: {
        info: number;
        low: number;
        medium: number;
        high: number;
        critical: number;
    };
    /** Clamp bounds (defaults: 0..100) */
    min?: number;
    max?: number;
}
export type Analyzer = (targetDir: string) => Promise<CategoryResult>;

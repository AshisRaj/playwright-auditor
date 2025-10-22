import { CategoryResult, Finding } from '../types';
export type Sev = 'info' | 'low' | 'medium' | 'high' | 'critical';
export declare const DEDUCT: Record<Sev, number>;
type PathLike = string;
/**
 * Generic score calculation based on severity deduction rules.
 * - Starts from 100 and subtracts based on severity for each failed finding.
 * - Clamps between 0 and 100.
 */
export declare function applyScore(findings: {
    status: string;
    severity?: Sev;
}[]): number;
/** Cached safe readFile returning '' on error */
export declare function readFile(p: string | undefined, encoding?: BufferEncoding): Promise<string>;
/**
 * Safe boolean regex test. Handles undefined/empty texts and multiline patterns.
 * Example: ok(/retries\s*:\s*\d+/, await readFile(cfg))
 */
export declare function ok(re: RegExp, text: string | undefined | null): boolean;
/**
 * Return the first candidate path that exists under `root`.
 * Candidates can be relative (e.g., 'playwright.config.ts') or absolute.
 */
export declare function firstExisting(root: PathLike, candidates: string[]): Promise<string | undefined>;
/**
 * Find the config file (first existing in candidates).
 * Example:
 *  const cfg = await findConfig(targetDir, [
 *    'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs',
 *  ]);
 */
export declare function findConfig(root: PathLike, candidates: string[]): Promise<string | undefined>;
/**
 * Cached fs.stat existence check.
 */
export declare function exists(p: string): Promise<boolean>;
/**
 * Safe JSON read; returns undefined on failure.
 */
export declare function readJsonSafe<T = any>(p: string | undefined): Promise<T | undefined>;
/**
 * Walk a directory for files matching an extension regex.
 * Use small sane defaults to avoid huge traversals.
 */
export declare function walkFiles(root: string, { exts, limit }?: {
    exts?: RegExp;
    limit?: number;
}): Promise<string[]>;
/**
 * Simple count of regex matches in a text (0 on error/empty).
 */
export declare function countMatches(re: RegExp, text: string | undefined | null): number;
export declare function findFiles(cwd: string, patterns: string[]): Promise<string[]>;
export declare function rel(cwd: string, abs: string): string;
export declare function walk(dir: string, limit?: number, out?: string[]): Promise<string[]>;
/**
 * Create a new analyzer category object.
 * Usage:
 *   const cat = createCategory('advanced', 'Advanced Capabilities');
 */
export declare function createCategory(id: string, title: string): CategoryResult;
export declare function inDeps(pkg: PkgJson | undefined, names: string[]): boolean;
/**
 * Scan typical project roots for TS/JS files and return the first file
 * for which the predicate returns true. Returns undefined if no match.
 */
export declare function findFirstFile(targetDir: string, predicate: (text: string, file: string) => boolean, roots?: string[]): Promise<string | undefined>;
export declare function fileExistsAny(root: string, rels: string[]): Promise<string | undefined>;
export declare function readTsconfig(root: string): Promise<{
    path?: string;
    json?: any;
}>;
/**
 * Scan code (no node_modules) for anti-patterns like waitForTimeout.
 * Returns first N file paths where it appears (for artifacts).
 */
export declare function findAntiPatternFiles(targetDir: string, re: RegExp, roots?: string[], limitArtifacts?: number): Promise<string[]>;
export declare function readIfExists(p: string): Promise<string>;
export type CiScan = {
    hasGH: boolean;
    hasGL: boolean;
    files: string[];
    textByFile: Map<string, string>;
};
export declare function collectCiConfigs(targetDir: string): Promise<CiScan>;
export declare function firstFileMatching(scan: CiScan, re: RegExp): string | undefined;
export declare function readJson<T = any>(filePath: string): Promise<T | null>;
export type PkgJson = {
    name?: string;
    version?: string;
    type?: 'module' | 'commonjs';
    engines?: {
        node?: string;
    };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    husky?: unknown;
    ['lint-staged']?: Record<string, string | string[]>;
    packageManager?: string;
};
export declare function addFinding(cat: CategoryResult, f: Finding): void;
export declare function hasAny(obj?: Record<string, string>): boolean;
export declare function depMap(pkg: PkgJson): {
    [x: string]: string;
};
export declare function getVersion(allDeps: Record<string, string>, name: string): string;
export declare function hasDep(allDeps: Record<string, string>, name: string): boolean;
export declare function anyScriptIncludes(scripts: Record<string, string>, pattern: RegExp): boolean;
export declare function looksFloating(v?: string): boolean;
export declare const makeId: (title: string) => string;
export declare const msg: (ok: boolean) => "Configured" | "Not configured";
export declare const pick: (arr: string[] | Set<string>, n?: number) => string[];
export {};

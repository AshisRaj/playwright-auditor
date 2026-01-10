import fg from 'fast-glob';
import { promises as fs } from 'fs';
import path from 'path';
import { CategoryResult, Finding } from '../types';

export type Sev = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const DEDUCT: Record<Sev, number> = {
  info: 0,
  low: 2,
  medium: 6,
  high: 12,
  critical: 20,
};

type PathLike = string;

/**
 * In-memory caches to avoid repeated disk I/O within one audit run.
 */
const statCache = new Map<string, boolean>();
const fileCache = new Map<string, string>();

/**
 * Generic score calculation based on severity deduction rules.
 * - Starts from 100 and subtracts based on severity for each failed finding.
 * - Clamps between 0 and 100.
 */
export function applyScore(findings: { status: string; severity?: Sev }[]): number {
  let s = 100;
  for (const f of findings) {
    if (f.status === 'fail') {
      s -= DEDUCT[f.severity || 'info'] || 0;
    }
  }
  return Math.max(0, Math.min(100, s));
}

/** Cached safe readFile returning '' on error */
export async function readFile(
  p: string | undefined,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  if (!p) return '';
  if (fileCache.has(p)) return fileCache.get(p)!;

  try {
    const data: string | Buffer = await fs.readFile(p);
    const text = Buffer.isBuffer(data) ? data.toString(encoding) : data;
    fileCache.set(p, text);
    return text;
  } catch {
    fileCache.set(p, '');
    return '';
  }
}

/**
 * Safe boolean regex test. Handles undefined/empty texts and multiline patterns.
 * Example: ok(/retries\s*:\s*\d+/, await readFile(cfg))
 */
export function ok(re: RegExp, text: string | undefined | null): boolean {
  if (!text) return false;
  try {
    // Avoid stateful behaviour when callers pass a RegExp with the global flag.
    // Create a fresh RegExp copy without the global flag for boolean tests.
    const flags = (re.flags || '').replace('g', '');
    const safeRe = new RegExp(re.source, flags);
    return safeRe.test(text);
  } catch {
    return false;
  }
}

/**
 * Return the first candidate path that exists under `root`.
 * Candidates can be relative (e.g., 'playwright.config.ts') or absolute.
 */
export async function firstExisting(
  root: PathLike,
  candidates: string[],
): Promise<string | undefined> {
  for (const c of candidates) {
    const p = path.isAbsolute(c) ? c : path.join(root, c);
    if (await exists(p)) return p;
  }
  return undefined;
}

/**
 * Find the config file (first existing in candidates).
 * Example:
 *  const cfg = await findConfig(targetDir, [
 *    'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs',
 *  ]);
 */
export async function findConfig(
  root: PathLike,
  candidates: string[],
): Promise<string | undefined> {
  return firstExisting(root, candidates);
}

/**
 * Cached fs.stat existence check.
 */
export async function exists(p: string): Promise<boolean> {
  if (statCache.has(p)) return statCache.get(p)!;
  try {
    const s = await fs.stat(p);
    const ok = s.isFile() || s.isDirectory();
    statCache.set(p, ok);
    return ok;
  } catch {
    statCache.set(p, false);
    return false;
  }
}

/**
 * Safe JSON read; returns undefined on failure.
 */
export async function readJsonSafe<T = any>(p: string | undefined): Promise<T | undefined> {
  const txt = await readFile(p);
  if (!txt) return undefined;
  try {
    return JSON.parse(txt) as T;
  } catch {
    return undefined;
  }
}

/**
 * Walk a directory for files matching an extension regex.
 * Use small sane defaults to avoid huge traversals.
 */
export async function walkFiles(
  root: string,
  { exts = /\.(t|j)sx?$/i, limit = 3000 }: { exts?: RegExp; limit?: number } = {},
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (out.length < limit) await walk(p);
      } else {
        if (exts.test(p)) out.push(p);
      }
      if (out.length >= limit) break;
    }
  }
  const rootExists = await exists(root);
  if (rootExists) await walk(root);
  return out;
}

/**
 * Simple count of regex matches in a text (0 on error/empty).
 */
export function countMatches(re: RegExp, text: string | undefined | null): number {
  if (!text) return 0;
  try {
    const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    return m ? m.length : 0;
  } catch {
    return 0;
  }
}

export async function findFiles(cwd: string, patterns: string[]) {
  return fg(patterns, {
    cwd,
    dot: true,
    absolute: true,
    followSymbolicLinks: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });
}

export function rel(cwd: string, abs: string) {
  const relative = path.relative(cwd, abs);
  // Normalize to POSIX-style separators for consistent reporting
  return relative.split(path.sep).join('/');
}

export async function walk(dir: string, limit = 2000, out: string[] = []): Promise<string[]> {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (out.length < limit) await walk(p, limit, out);
    } else out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Create a new analyzer category object.
 * Usage:
 *   const cat = createCategory('advanced', 'Advanced Capabilities');
 */
export function createCategory(id: string, title: string): CategoryResult {
  return {
    id,
    title,
    findings: [] as Finding[],
    score: 0,
  };
}

export function inDeps(pkg: PkgJson | undefined, names: string[]): boolean {
  if (!pkg) return false;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return names.some((n) => deps[n] != null);
}

/**
 * Scan typical project roots for TS/JS files and return the first file
 * for which the predicate returns true. Returns undefined if no match.
 */
export async function findFirstFile(
  targetDir: string,
  predicate: (text: string, file: string) => boolean,
  roots: string[] = ['src', 'tests', 'test', 'e2e', '__tests__', 'scripts'],
): Promise<string | undefined> {
  for (const r of roots) {
    const base = path.join(targetDir, r);
    const files = await walkFiles(base, { exts: /\.(t|j)sx?$/i, limit: 4000 });
    for (const f of files) {
      const txt = await readFile(f);
      if (predicate(txt, f)) return f;
    }
  }
  return undefined;
}

export async function fileExistsAny(root: string, rels: string[]): Promise<string | undefined> {
  for (const r of rels) {
    const p = path.join(root, r);
    if (await exists(p)) return p;
  }
  return undefined;
}

export async function readTsconfig(root: string): Promise<{ path?: string; json?: any }> {
  const cand = await fileExistsAny(root, [
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.build.json',
    'tsconfig.test.json',
  ]);
  if (!cand) return {};
  const json = await readJsonSafe(cand);
  return { path: cand, json };
}

/**
 * Scan code (no node_modules) for anti-patterns like waitForTimeout.
 * Returns first N file paths where it appears (for artifacts).
 */
export async function findAntiPatternFiles(
  targetDir: string,
  re: RegExp,
  roots: string[] = ['src', 'tests', 'test', 'e2e', '__tests__', 'scripts'],
  limitArtifacts = 5,
): Promise<string[]> {
  const out: string[] = [];
  for (const r of roots) {
    const base = path.join(targetDir, r);
    const files = await walkFiles(base, { exts: /\.(t|j)sx?$/i, limit: 6000 });
    for (const f of files) {
      const txt = await readFile(f);
      if (ok(re, txt)) {
        out.push(f);
        if (out.length >= limitArtifacts) return out;
      }
    }
  }
  return out;
}

export async function readIfExists(p: string): Promise<string> {
  return (await exists(p)) ? readFile(p) : '';
}

export type CiScan = {
  hasGH: boolean;
  hasGL: boolean;
  files: string[];
  textByFile: Map<string, string>;
};

export async function collectCiConfigs(targetDir: string): Promise<CiScan> {
  const scan: CiScan = { hasGH: false, hasGL: false, files: [], textByFile: new Map() };

  // GitHub Actions
  const ghDir = path.join(targetDir, '.github', 'workflows');
  if (await exists(ghDir)) {
    scan.hasGH = true;
    const names = await fs.readdir(ghDir).catch(() => []);
    for (const n of names) {
      if (!/\.ya?ml$/i.test(n)) continue;
      const p = path.join(ghDir, n);
      const t = await readFile(p);
      scan.files.push(p);
      scan.textByFile.set(p, t);
    }
  }

  // GitLab CI
  for (const name of ['.gitlab-ci.yml', '.gitlab-ci.yaml']) {
    const p = path.join(targetDir, name);
    if (await exists(p)) {
      scan.hasGL = true;
      const t = await readFile(p);
      scan.files.push(p);
      scan.textByFile.set(p, t);
    }
  }

  return scan;
}

export function firstFileMatching(scan: CiScan, re: RegExp): string | undefined {
  // Avoid using a stateful RegExp (with 'g') directly here — create a fresh copy.
  const flags = (re.flags || '').replace('g', '');
  const safeRe = new RegExp(re.source, flags);
  for (const f of scan.files) {
    const t = scan.textByFile.get(f) || '';
    if (safeRe.test(t)) return f;
  }
  return undefined;
}

export async function readJson<T = any>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath);
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export type PkgJson = {
  name?: string;
  version?: string;
  type?: 'module' | 'commonjs';
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  husky?: unknown;
  ['lint-staged']?: Record<string, string | string[]>;
  packageManager?: string;
};

export function addFinding(cat: CategoryResult, f: Finding) {
  cat.findings.push({
    id: f.id ?? `deps-${f.title.toLowerCase().replace(/\W+/g, '-')}`,
    title: f.title,
    message: f.message ?? (f.status ? 'Configured' : 'Not configured'),
    severity: f.severity,
    status: f.status ? 'pass' : 'fail',
    suggestion: f.suggestion,
    file: f.file,
    artifacts: (f.artifacts || []).filter(Boolean),
  });
}

export function hasAny(obj?: Record<string, string>) {
  return !!obj && Object.keys(obj).length > 0;
}

export function depMap(pkg: PkgJson) {
  return {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };
}

export function getVersion(allDeps: Record<string, string>, name: string) {
  return allDeps[name];
}

export function hasDep(allDeps: Record<string, string>, name: string) {
  return !!getVersion(allDeps, name);
}

export function anyScriptIncludes(scripts: Record<string, string>, pattern: RegExp) {
  return Object.values(scripts || {}).some((s) => pattern.test(s));
}

export function looksFloating(v = '') {
  return v === 'latest' || v === '*' || /^\d+\.\d+$/.test(v); // crude but useful
}

// Helper for id/message
export const makeId = (title: string) => 'data-' + title.toLowerCase().replace(/\W+/g, '-');
export const msg = (ok: boolean) => (ok ? 'Configured' : 'Not configured');

export const pick = (arr: string[] | Set<string>, n = 10) =>
  (Array.isArray(arr) ? arr : Array.from(arr)).slice(0, n);

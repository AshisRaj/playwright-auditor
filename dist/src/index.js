// src/index.ts
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeHtml } from './reporters/html.js';
import { computeCategoryScore, computeOverallScore } from './utils/scoring.js';
const ANALYZERS = [
    {
        id: 'structure',
        title: 'Project Structure',
        stem: 'projectStructure',
        fnName: 'analyzeProjectStructure',
    },
    { id: 'deps', title: 'Dependencies', stem: 'dependencies', fnName: 'analyzeDependencies' },
    { id: 'config', title: 'Config', stem: 'config', fnName: 'analyzeConfig' },
    { id: 'tests', title: 'Test Quality', stem: 'testsQuality', fnName: 'analyzeTestsQuality' },
    { id: 'locators', title: 'Locator Strategy', stem: 'locators', fnName: 'analyzeLocators' },
    { id: 'flakiness', title: 'Flakiness Risks', stem: 'flakiness', fnName: 'analyzeFlakiness' },
    {
        id: 'reporting',
        title: 'Reporting & Observability',
        stem: 'reportingObs',
        fnName: 'analyzeReportingObs',
    },
    { id: 'ci', title: 'CI/CD Hygiene', stem: 'cicdIntegration', fnName: 'analyzeCICDIntegration' },
    { id: 'network', title: 'Network/Route Mocks', stem: 'networkMocking', fnName: 'analyzeNetwork' },
    // Your extensions
    { id: 'core', title: 'Core Functionalities', stem: 'core', fnName: 'analyzeCore' },
    { id: 'advanced', title: 'Advanced Capabilities', stem: 'advanced', fnName: 'analyzeAdvanced' },
    { id: 'data', title: 'Data Management', stem: 'dataMgmt', fnName: 'analyzeDataMgmt' },
    {
        id: 'best',
        title: 'Best Practices Enforcement',
        stem: 'bestPractices',
        fnName: 'analyzeBestPractices',
    },
    { id: 'notify', title: 'Notification', stem: 'notifications', fnName: 'analyzeNotification' },
];
/** Utility: coerce to Sev */
function toSev(x) {
    switch (String(x || '').toLowerCase()) {
        case 'info':
            return 'info';
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
            return 'high';
        case 'critical':
            return 'critical';
        default:
            return 'low';
    }
}
/** Normalize analyzer output into Category shape */
function normalizeCategory(entry, out) {
    if (!out)
        return null;
    const findings = Array.isArray(out.findings) ? out.findings : [];
    return {
        id: out.id || entry.id,
        title: out.title || entry.title,
        findings: findings.map((f) => ({
            id: String(f.id ?? f.title ?? 'check'),
            title: String(f.title ?? 'Check'),
            message: f.message ? String(f.message) : '',
            suggestion: f.suggestion ? String(f.suggestion) : undefined,
            severity: toSev(f.severity),
            status: f.status === 'pass' || f.status === 'fail' ? f.status : 'fail',
            file: f.file ? String(f.file) : undefined,
            artifacts: Array.isArray(f.artifacts) ? f.artifacts.map(String) : undefined,
        })),
    };
}
/** Build candidate absolute file paths for analyzer import */
function analyzerCandidates(stem) {
    const here = fileURLToPath(import.meta.url);
    const dir = path.dirname(here);
    const isDist = /[\\/]dist([\\/]|$)/.test(dir);
    const root = isDist ? path.resolve(dir, '..') : path.resolve(dir);
    const distAnalyzers = path.join(root, 'analyzers');
    const srcRoot = isDist ? path.resolve(root, '..') : path.resolve(root, '..');
    const srcAnalyzers = path.join(srcRoot, 'src', 'analyzers');
    const exts = ['.js', '.mjs', '.cjs', '.ts']; // try compiled first, then ts-node
    const list = [];
    // 1) dist/analyzers/*
    for (const ext of exts)
        list.push(path.join(distAnalyzers, stem + ext));
    // 2) src/analyzers/* (ts-node or when running from src)
    for (const ext of exts)
        list.push(path.join(srcAnalyzers, stem + ext));
    // 3) same folder heuristic (rare but helpful)
    for (const ext of exts)
        list.push(path.join(dir, 'analyzers', stem + ext));
    return list;
}
/** Try to import analyzer module from many candidate paths */
async function importAnalyzerModule(stem) {
    const tried = [];
    const errors = [];
    const candidates = analyzerCandidates(stem);
    for (const abs of candidates) {
        tried.push(abs);
        try {
            // Only try if the file exists
            const st = await fs.stat(abs).catch(() => null);
            if (!st || !st.isFile())
                continue;
            const url = pathToFileURL(abs).href;
            const mod = await import(url);
            if (mod)
                return { mod, tried, errors };
        }
        catch (e) {
            errors.push(`${abs}: ${e?.message || String(e)}`);
        }
    }
    // As a last-ditch effort, try bare relative ESM specifiers (may work in some setups)
    for (const ext of ['.js', '.mjs']) {
        const rel = `./analyzers/${stem}${ext}`;
        tried.push(rel);
        try {
            const mod = await import(rel);
            if (mod)
                return { mod, tried, errors };
        }
        catch (e) {
            errors.push(`${rel}: ${e?.message || String(e)}`);
        }
    }
    return { mod: null, tried, errors };
}
/** Run a single analyzer with resilient loading and error capture */
async function runAnalyzer(entry, targetDir) {
    const { mod, tried, errors } = await importAnalyzerModule(entry.stem);
    if (!mod) {
        // Return a load issue finding so it's visible in the report
        const msg = `Module not found for analyzer "${entry.title}" (stem="${entry.stem}"). Tried:\n` +
            tried.map((p) => `• ${p}`).join('\n');
        const hint = errors.length ? `\nErrors:\n${errors.map((e) => `- ${e}`).join('\n')}` : '';
        return {
            cat: null,
            loadIssue: {
                id: `load-${entry.id}`,
                title: `Analyzer not loaded: ${entry.title}`,
                message: msg + hint,
                severity: 'high',
                status: 'fail',
            },
        };
    }
    try {
        let fn = mod[entry.fnName];
        if (typeof fn !== 'function') {
            // fallback: first exported function
            fn = Object.values(mod).find((v) => typeof v === 'function');
        }
        if (typeof fn !== 'function') {
            return {
                cat: null,
                loadIssue: {
                    id: `no-fn-${entry.id}`,
                    title: `Analyzer export missing: ${entry.title}`,
                    message: `Module loaded but export "${entry.fnName}" not found.`,
                    severity: 'high',
                    status: 'fail',
                },
            };
        }
        const out = await fn(targetDir);
        const normalized = normalizeCategory(entry, out);
        return { cat: normalized || null };
    }
    catch (e) {
        return {
            cat: {
                id: entry.id,
                title: entry.title,
                findings: [
                    {
                        id: 'analyzer-error',
                        title: 'Analyzer failed',
                        message: e?.message || String(e),
                        severity: 'high',
                        status: 'fail',
                    },
                ],
            },
        };
    }
}
/** Programmatic API */
export async function runAudit(targetDir, options = {}) {
    const outDir = options.outDir || path.resolve(process.cwd(), 'audit-report');
    const stat = await fs.stat(targetDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
        throw new Error(`Target directory not found: ${targetDir}`);
    }
    const cats = [];
    const loadIssues = [];
    for (const entry of ANALYZERS) {
        const { cat, loadIssue } = await runAnalyzer(entry, targetDir);
        if (cat)
            cats.push(cat);
        if (loadIssue)
            loadIssues.push(loadIssue);
    }
    // If anything failed to load, surface it as a visible category
    if (loadIssues.length) {
        cats.unshift({
            id: 'analyzer-load',
            title: 'Analyzer Load Issues',
            findings: loadIssues,
        });
    }
    // Score each category (severity-weighted pass ratio)
    for (const c of cats) {
        const { score, maxPoints } = computeCategoryScore(c.findings || []);
        c.score = score;
        c._maxPoints = maxPoints;
    }
    // Overall weighted average by category maxPoints
    const overallScore = computeOverallScore(cats.map((c) => ({ score: c.score || 0, _maxPoints: c._maxPoints || 0 })));
    const result = {
        targetDir: path.resolve(targetDir),
        timestamp: new Date().toISOString(),
        categories: cats,
        overallScore,
    };
    await fs.mkdir(outDir, { recursive: true });
    if (options.writeHtml !== false) {
        await writeHtml(result, outDir);
    }
    if (options.writeJson) {
        await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(result, null, 2), 'utf8');
    }
    return result;
}
/** CLI entry: pwaudit <targetDir> -o <outDir> [--json] [--no-html] */
async function mainFromCli() {
    const argv = process.argv.slice(2);
    const targetDir = argv.find((a) => !a.startsWith('-')) || process.cwd();
    const getFlag = (name, short) => argv.findIndex((a) => a === name || (short && a === short)) >= 0;
    const getValue = (name, short) => {
        const i = argv.findIndex((a) => a === name || (short && a === short));
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
    };
    const outDir = getValue('--out-dir', '-o') || 'audit-report';
    const writeJson = getFlag('--json');
    const skipHtml = getFlag('--no-html');
    try {
        const res = await runAudit(targetDir, { outDir, writeHtml: !skipHtml, writeJson });
        const outAbs = path.resolve(outDir);
        if (!skipHtml) {
            console.log(`✅ Audit complete. See ${path.join(outAbs, 'index.html')}${writeJson ? ' and report.json' : ''}`);
        }
        else if (writeJson) {
            console.log(`✅ Audit complete. JSON written at ${path.join(outAbs, 'report.json')}`);
        }
        else {
            console.log(`✅ Audit complete.`);
        }
        // Optional CI behavior: fail on severe issues (commented by default)
        const bad = res.categories
            .flatMap((c) => c.findings)
            .some((f) => f.status !== 'pass' && (f.severity === 'critical' || f.severity === 'high'));
        if (bad) {
            // process.exitCode = 2;
        }
    }
    catch (e) {
        console.error('✖ Audit failed:', e?.message || String(e));
        process.exitCode = 1;
    }
}
// Run if invoked directly
const isDirectRun = typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    process.argv[1] &&
    /(?:^|[\\/])index\.(?:js|cjs|mjs)$/.test(process.argv[1]);
if (isDirectRun) {
    await mainFromCli();
}

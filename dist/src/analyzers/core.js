// src/analyzers/core.ts
import path from 'node:path';
import { applyScore, createCategory, exists, findConfig, ok, readFile, readJsonSafe, walkFiles, } from '../utils/helpers.js';
export async function analyzeCore(targetDir) {
    const cat = createCategory('core', 'Core Functionalities');
    // --- Load playwright config text (if present) ---
    const cfgPath = await findConfig(targetDir, [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ]);
    const cfgText = cfgPath ? await readFile(cfgPath) : '';
    // --- Load package.json scripts (for CLI grep) ---
    const pkgPath = path.join(targetDir, 'package.json');
    const pkg = (await readJsonSafe(pkgPath)) || {};
    const scripts = pkg.scripts || {};
    // --- Collect test files (for tag scanning & helper reuse heuristics) ---
    const testRoots = ['tests', 'test', 'e2e', '__tests__', 'src'].map((r) => path.join(targetDir, r));
    let testFiles = [];
    for (const r of testRoots) {
        const found = await walkFiles(r, { exts: /\.(spec|test)\.(t|j)sx?$/i, limit: 6000 }).catch(() => []);
        testFiles = testFiles.concat(found);
    }
    // --- Heuristics for helpers/pages reuse ---
    const hasPagesDir = (await exists(path.join(targetDir, 'src', 'pages'))) ||
        (await exists(path.join(targetDir, 'tests', 'pages'))) ||
        (await exists(path.join(targetDir, 'test', 'pages'))) ||
        (await exists(path.join(targetDir, 'e2e', 'pages')));
    const hasUtilsDir = (await exists(path.join(targetDir, 'src', 'utils'))) ||
        (await exists(path.join(targetDir, 'tests', 'utils'))) ||
        (await exists(path.join(targetDir, 'test', 'utils'))) ||
        (await exists(path.join(targetDir, 'e2e', 'utils'))) ||
        (await exists(path.join(targetDir, 'scripts')));
    // detect Page Object classes like `export class LoginPage`
    const pageObjectHits = [];
    for (const f of testFiles.slice(0, 1200)) {
        const t = await readFile(f);
        if (/\bexport\s+class\s+\w+Page\b/.test(t) || /\bclass\s+\w+Page\b/.test(t)) {
            pageObjectHits.push(f);
            if (pageObjectHits.length >= 5)
                break;
        }
    }
    // --- Environment switching heuristics ---
    const hasDotenvFiles = (await exists(path.join(targetDir, '.env'))) ||
        (await exists(path.join(targetDir, '.env.local'))) ||
        (await exists(path.join(targetDir, '.env.dev'))) ||
        (await exists(path.join(targetDir, '.env.test'))) ||
        (await exists(path.join(targetDir, '.env.ci')));
    const envSwitchInConfig = ok(/\bprocess\.env\b/i, cfgText) || ok(/\bbaseURL\s*:/i, cfgText); // already validated elsewhere but counts toward env switch
    // Also scan a few files for process.env usage
    let processEnvHits = 0;
    for (const f of testFiles.slice(0, 400)) {
        const t = await readFile(f);
        if (/\bprocess\.env\.[A-Za-z_]\w*/.test(t)) {
            processEnvHits++;
            if (processEnvHits >= 5)
                break;
        }
    }
    const envSwitchPass = hasDotenvFiles || envSwitchInConfig || processEnvHits > 0;
    // --- Tags & filtering (config/scripts/specs) ---
    // 1) Config: grep/grepInvert keys
    const grepInConfig = ok(/\bgrep(Invert)?\s*:/i, cfgText);
    // 2) Scripts: any use of --grep or -g (capture some sample lines)
    const grepScriptLines = [];
    Object.entries(scripts).forEach(([name, val]) => {
        if (/\b(--grep|-g)\b/.test(val || '')) {
            grepScriptLines.push(`${name}: ${val}`);
        }
    });
    // 3) Spec tags inside titles (e.g., test('login @smoke'), describe('checkout @regression'))
    //    We look for @smoke|@regression|@sanity|@e2e|@api|@p1|@p2|@p3 in string literals.
    const tagWord = '(?:smoke|regression|sanity|e2e|api|p0|p1|p2|p3|critical|high|medium|low)';
    const tagInTitleRe = new RegExp(`(?:test|it|describe)\\s*\\(\\s*(['"\`])[\\s\\S]*?@${tagWord}[\\s\\S]*?\\1`, 'i');
    const filesWithTags = [];
    for (const f of testFiles.slice(0, 3000)) {
        const t = await readFile(f);
        if (tagInTitleRe.test(t)) {
            filesWithTags.push(f);
            if (filesWithTags.length >= 12)
                break; // limit artifacts
        }
    }
    // Determine pass/fail for tags:
    // - Config/scripts: pass if grep present in either
    // - Spec tags: pass if at least 30% of spec files have tags (or at least 1 in small repos)
    const specCount = testFiles.length;
    const specTagPass = filesWithTags.length > 0 &&
        (specCount < 10 ? true : filesWithTags.length / Math.max(1, specCount) >= 0.3);
    // --- Core retries & parallel/headless checks (from config) ---
    const retriesPass = /\bretries\s*:\s*(?!0\b)(\d+|process\.env\.[A-Za-z_]\w*\s*\?\s*\d+\s*:\s*\d+)/i.test(cfgText);
    const headlessOrWorkersPass = /\bheadless\s*:\s*true\b/i.test(cfgText) ||
        /\bworkers\s*:\s*(\d+|process\.env\.[A-Za-z_]\w*\s*\?\s*\d+\s*:\s*\d+)/i.test(cfgText) ||
        /\bprojects\s*:\s*\[/i.test(cfgText);
    // --- Reusable helpers/pages pass ---
    const helpersPass = hasPagesDir || hasUtilsDir || pageObjectHits.length > 0;
    // ---------- Emit findings ----------
    const checks = [
        {
            id: 'retries',
            title: 'Readable assertions & retries configured',
            pass: retriesPass,
            sev: 'medium',
            msgPass: 'Retries configured (≥ 1 or CI ternary)',
            msgFail: 'No retries or set to 0',
            suggestion: 'Set `retries: 1` (or `process.env.CI ? 2 : 1`) to absorb flakiness.',
            file: cfgPath || '',
        },
        {
            id: 'parallel',
            title: 'Parallel/headless execution configured',
            pass: headlessOrWorkersPass,
            sev: 'low',
            msgPass: 'Headless and/or workers/projects are configured',
            msgFail: 'No headless/workers/projects configuration found',
            suggestion: 'Set `use: { headless: true }` and tune `workers` or `projects` for scale.',
            file: cfgPath || '',
        },
        {
            id: 'helpers',
            title: 'Reusable helpers/pages present',
            pass: helpersPass,
            sev: 'info',
            msgPass: 'Helpers/pages (PO) or utils detected',
            msgFail: 'No helpers/pages structure detected',
            suggestion: 'Factor common flows into Page Object classes (`src/pages/`) and utilities (`src/utils/`).',
            artifacts: pageObjectHits,
        },
        {
            id: 'env-switch',
            title: 'Environment switch available',
            pass: envSwitchPass,
            sev: 'low',
            msgPass: 'Environment switching detected (.env/process.env/baseURL)',
            msgFail: 'No environment switching detected',
            suggestion: 'Provide env switching via dotenv/.env and `use.baseURL` or process.env variables in config.',
            file: cfgPath || '',
        },
        {
            id: 'grep-config',
            title: 'Tags/Filtering in config (grep/grepInvert)',
            pass: grepInConfig,
            sev: 'info',
            msgPass: '`grep`/`grepInvert` configured in Playwright config',
            msgFail: 'No `grep`/`grepInvert` found in config',
            suggestion: 'Use `grep`/`grepInvert` in config to enable tag-based filtering globally.',
            file: cfgPath || '',
        },
        {
            id: 'grep-scripts',
            title: 'Tags/Filtering via npm scripts (--grep/-g)',
            pass: grepScriptLines.length > 0,
            sev: 'low',
            msgPass: 'Scripts using `--grep`/`-g` found',
            msgFail: 'No scripts found using `--grep`/`-g`',
            suggestion: 'Add scripts like `"test:smoke": "playwright test --grep @smoke"` in package.json.',
            file: pkgPath,
            artifacts: grepScriptLines.slice(0, 6),
        },
        {
            id: 'spec-tags',
            title: 'Spec files tagged (@smoke/@regression/...)',
            pass: specTagPass,
            sev: specTagPass ? 'info' : 'low',
            msgPass: 'A healthy portion of spec files include @tags',
            msgFail: 'Few or no spec files include @tags',
            suggestion: 'Append tags in titles, e.g., `test("login @smoke", ...)` or `describe("checkout @regression", ...)`.',
            artifacts: filesWithTags,
        },
    ];
    for (const c of checks) {
        cat.findings.push({
            id: 'core-' + c.id,
            title: c.title,
            message: c.pass ? c.msgPass : c.msgFail,
            severity: c.sev,
            status: c.pass ? 'pass' : 'fail',
            suggestion: c.suggestion,
            file: c.file || '',
            artifacts: c.artifacts && c.artifacts.length ? c.artifacts : undefined,
        });
    }
    cat.score = applyScore(cat.findings);
    return cat;
}

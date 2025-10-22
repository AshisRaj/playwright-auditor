import path from 'node:path';
import { applyScore, createCategory, findConfig, ok, readFile, walkFiles, } from '../utils/helpers.js';
/**
 * Scan typical project roots for TS/JS files and return the first file
 * for which the predicate returns true. Returns undefined if no match.
 */
async function findFirstFile(targetDir, predicate, roots = ['src', 'tests', 'test', 'e2e', '__tests__', 'scripts']) {
    for (const r of roots) {
        const base = path.join(targetDir, r);
        const files = await walkFiles(base, { exts: /\.(t|j)sx?$/i, limit: 4000 });
        for (const f of files) {
            const txt = await readFile(f);
            if (predicate(txt, f))
                return f;
        }
    }
    return undefined;
}
/**
 * Reporter config must reference a local path:
 * - reporter: ['./myReporter'] OR ['../yourReporter']
 * - reporter: [{ reporter: './hisReporter', ... }, ...]
 */
function reporterLocalPathInConfig(cfgText) {
    if (!cfgText)
        return false;
    // reporter: [ './x', '../y', { reporter: './z' }, ... ]
    const anyLocalInArray = /\breporter\s*:\s*\[(?:[^\]]*['"]\.{1,2}\/[^'"]+['"][^\]]*)\]/s.test(cfgText);
    // reporter: [ { reporter: './x', ... }, ... ]
    const localInObjectInsideArray = /\breporter\s*:\s*\[[^\]]*\{\s*[^}]*\breporter\s*:\s*['"]\.{1,2}\/[^'"]+['"][^}]*\}[^]]*\]/s.test(cfgText);
    return anyLocalInArray || localInObjectInsideArray;
}
/**
 * Detect a Playwright Reporter implementation with hooks.
 * We look for:
 *  - import type { Reporter } from '@playwright/test/reporter' (or from '@playwright/test')
 *  - a class that implements Reporter OR contains common hooks
 */
function hasReporterImplementation(text) {
    if (!text)
        return false;
    // Imports referencing reporter type
    const reporterImport = /@playwright\/test\/reporter/.test(text) || /@playwright\/test['"]/.test(text);
    // Explicit interface implementation
    const implementsReporter = /\bimplements\s+Reporter\b/.test(text);
    // Common reporter hooks
    const hooks = /\bon(Begin|TestBegin|TestEnd|End|StepBegin|StepEnd|StdOut|StdErr)\s*\(/.test(text);
    // Require evidence of reporter typing + hooks (or explicit implements + hooks)
    return (reporterImport && hooks) || (implementsReporter && hooks);
}
/**
 * Detect custom fixture extension patterns, including generics and aliasing:
 *  - test.extend(...)
 *  - base.extend(...), baseTest.extend(...)
 *  - <alias>.extend<...>(...) when a Playwright import is present
 * Excludes Jest's expect.extend.
 */
function hasFixtureExtend(text) {
    if (!text)
        return false;
    // Direct/common cases
    if (/\b(test|base|baseTest)\s*\.\s*extend\s*(?:<[^>]*>)?\s*\(/.test(text))
        return true;
    // Aliased cases: require Playwright import + .extend(...) on some identifier (not 'expect')
    const hasPWImport = /from\s*['"]@playwright\/test['"]/.test(text);
    if (hasPWImport && /\b(?!expect\b)[A-Za-z_]\w*\s*\.\s*extend\s*(?:<[^>]*>)?\s*\(/.test(text)) {
        return true;
    }
    return false;
}
export async function analyzeAdvanced(targetDir) {
    const cat = createCategory('advanced', 'Advanced Capabilities');
    // 1) Load Playwright config text (if any)
    const cfgPath = await findConfig(targetDir, [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ]);
    const cfgText = await readFile(cfgPath);
    // ---------- Check: storageState (session reuse) ----------
    const storageInConfig = ok(/\bstorageState\s*:/i, cfgText);
    const storageInCodeFile = await findFirstFile(targetDir, (txt) => /\bstorageState\b\s*[:(]/i.test(txt));
    const storagePass = storageInConfig || !!storageInCodeFile;
    cat.findings.push({
        id: 'adv-storage-state',
        title: 'User impersonation / session reuse (storageState)',
        message: storagePass ? 'Configured' : 'Not configured',
        severity: 'medium',
        status: storagePass ? 'pass' : 'fail',
        suggestion: 'Use storageState to persist logged-in session and speed up tests.',
        file: storageInConfig ? cfgPath || '' : storageInCodeFile || cfgPath || '',
        artifacts: storageInCodeFile ? [storageInCodeFile] : cfgPath ? [cfgPath] : [],
    });
    // ---------- Check: custom fixtures (test/base/baseTest.extend) ----------
    const extendInConfig = hasFixtureExtend(cfgText);
    const extendInFile = await findFirstFile(targetDir, (txt) => hasFixtureExtend(txt));
    const fixturesPass = extendInConfig || !!extendInFile;
    cat.findings.push({
        id: 'adv-custom-fixtures',
        title: 'Custom fixtures (test.extend)',
        message: fixturesPass ? 'Configured' : 'Not configured',
        severity: 'low',
        status: fixturesPass ? 'pass' : 'fail',
        suggestion: 'Create domain fixtures via test.extend for reusable setup and test data.',
        file: extendInConfig ? cfgPath || '' : extendInFile || cfgPath || '',
        artifacts: extendInFile ? [extendInFile] : cfgPath ? [cfgPath] : [],
    });
    // ---------- Check: custom reporter (strict rule) ----------
    // Must have BOTH:
    //  (1) reporter configured in config file with a local path (./ or ../)
    //  (2) a project file that implements Reporter (typed/imported) AND has hooks
    const reporterInConfigLocal = reporterLocalPathInConfig(cfgText);
    const reporterImplFile = await findFirstFile(targetDir, (txt) => hasReporterImplementation(txt));
    const reporterPass = reporterInConfigLocal && !!reporterImplFile;
    cat.findings.push({
        id: 'adv-custom-reporter',
        title: 'Custom reporter (local path + hooks)',
        message: reporterPass ? 'Configured' : 'Not configured',
        severity: 'info',
        status: reporterPass ? 'pass' : 'fail',
        suggestion: 'Configure reporter in playwright.config with a local path (e.g., ["./myReporter"]) and implement Reporter hooks (onBegin, onTestEnd, onEnd).',
        file: reporterInConfigLocal ? cfgPath || '' : reporterImplFile || cfgPath || '',
        artifacts: reporterImplFile ? [reporterImplFile] : cfgPath ? [cfgPath] : [],
    });
    // ---------- Check: network mocks/intercepts ----------
    const mockFile = await findFirstFile(targetDir, (txt) => /\b(?:page|context)\.route\s*\(/i.test(txt));
    const mocksPass = !!mockFile;
    cat.findings.push({
        id: 'adv-network-mocks',
        title: 'Network mocks/intercepts',
        message: mocksPass ? 'Configured' : 'Not configured',
        severity: 'low',
        status: mocksPass ? 'pass' : 'fail',
        suggestion: 'Use page.route/context.route to stub network and isolate tests.',
        file: mockFile || '',
        artifacts: mockFile ? [mockFile] : [],
    });
    // Final score
    cat.score = applyScore(cat.findings);
    return cat;
}

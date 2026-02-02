import path from 'path';
import { applyScore, createCategory, exists, findFiles, readFile, readJsonSafe, } from '../utils/helpers.js';
const cat = createCategory('deps', 'Dependencies');
function addFinding(f) {
    cat.findings.push({
        id: f.id ?? 'deps-' + f.title.toLowerCase().replace(/\W+/g, '-'),
        title: f.title,
        message: f.message ?? (f.status === 'pass' ? 'Configured' : 'Not configured'),
        severity: f.sev,
        status: f.status,
        suggestion: f.suggestion,
        file: f.file,
        artifacts: (f.artifacts || []).filter(Boolean),
    });
}
function depMap(pkg) {
    return {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
    };
}
function getVersion(allDeps, name) {
    return allDeps[name];
}
function hasDep(allDeps, name) {
    return !!getVersion(allDeps, name);
}
function anyScriptIncludes(scripts, pattern) {
    return Object.values(scripts || {}).some((s) => pattern.test(s));
}
function looksFloating(v = '') {
    return v === 'latest' || v === '*' || /^\d+\.\d+$/.test(v); // crude but useful
}
async function safeRead(p) {
    if (!p)
        return '';
    try {
        return await readFile(p);
    }
    catch {
        return '';
    }
}
export async function analyzeDependencies(targetDir) {
    const pkgPath = path.join(targetDir, 'package.json');
    const pkg = (await readJsonSafe(pkgPath)) || {};
    const allDeps = depMap(pkg);
    const scripts = pkg.scripts || {};
    // ---- 1) Core dependency presence (baseline you already had, expanded & corrected)
    const baselineChecks = [
        ['@playwright/test', 'critical'],
        ['playwright', 'high'],
        ['typescript', 'medium'],
        ['eslint', 'high'],
        ['prettier', 'high'],
        ['husky', 'medium'],
        ['lint-staged', 'medium'],
        ['@eslint/js', 'high'],
        ['globals', 'high'],
        ['eslint-config-prettier', 'high'],
        ['eslint-plugin-playwright', 'critical'],
        // Generators / data
        ['@faker-js/faker', 'medium'],
        ['chance', 'medium'],
        // Utilities
        ['cross-env', 'medium'],
        ['lodash', 'medium'],
        ['rimraf', 'low'],
        // Runners / TS helpers
        ['ts-node', 'low'],
        ['tsx', 'low'],
        // Allure
        ['allure-commandline', 'high'],
        ['allure-js-commons', 'low'],
        ['allure-playwright', 'high'],
    ];
    for (const [name, sev] of baselineChecks) {
        const ok = hasDep(allDeps, name);
        addFinding({
            id: `dep-${name}`,
            title: `${name} dependency`,
            status: ok ? 'pass' : 'fail',
            sev,
            message: ok ? `Found ${name}@${getVersion(allDeps, name)}` : `${name} not found`,
            suggestion: ok
                ? undefined
                : `Install "${name}" (e.g. "npm install --save-dev ${name}" or "npm install ${name}").`,
            file: 'package.json',
        });
    }
    // ---- 2) TypeScript + ESLint ecosystem consistency
    const tsconfigCandidates = await findFiles(targetDir, ['tsconfig.json', 'tsconfig.*.json']);
    const usesTS = hasDep(allDeps, 'typescript') || tsconfigCandidates.length > 0;
    const hasTsEslintPlugin = hasDep(allDeps, '@typescript-eslint/eslint-plugin');
    const hasTsEslintParser = hasDep(allDeps, '@typescript-eslint/parser');
    const mistakenlyHasOldMeta = hasDep(allDeps, 'typescript-eslint'); // incorrect meta-package name in many repos
    addFinding({
        title: 'TypeScript ESLint integration',
        status: hasTsEslintPlugin && hasTsEslintParser && !mistakenlyHasOldMeta ? 'pass' : 'fail',
        sev: usesTS ? 'high' : 'info',
        message: usesTS
            ? hasTsEslintPlugin && hasTsEslintParser
                ? mistakenlyHasOldMeta
                    ? 'Has @typescript-eslint/* but also legacy "typescript-eslint" (remove).'
                    : 'ESLint wired for TypeScript.'
                : 'Missing @typescript-eslint/eslint-plugin and/or @typescript-eslint/parser.'
            : 'TypeScript not detected.',
        suggestion: usesTS
            ? 'Install @typescript-eslint/eslint-plugin & @typescript-eslint/parser and remove legacy "typescript-eslint".'
            : 'No action required.',
        artifacts: [pkgPath, ...tsconfigCandidates],
    });
    // If TypeScript used, ensure a typecheck script exists
    addFinding({
        title: 'TypeScript typecheck script',
        status: scripts['typecheck'] ? 'pass' : 'fail',
        sev: usesTS ? 'low' : 'info',
        message: usesTS
            ? scripts['typecheck']
                ? `Script "typecheck": ${scripts['typecheck']}`
                : 'Script "typecheck" missing'
            : 'TypeScript not detected.',
        suggestion: usesTS ? undefined : 'Add "typecheck": "tsc -p tsconfig.json --noEmit".',
        file: 'package.json',
    });
    // ---- Playwright wiring & Allure coupling
    const testScript = scripts['test'] || '';
    const hasPlaywrightTestScript = /playwright\s+test/.test(testScript) || anyScriptIncludes(scripts, /\bplaywright\s+test\b/);
    addFinding({
        title: 'Playwright test script',
        status: hasDep(allDeps, '@playwright/test') && hasPlaywrightTestScript ? 'pass' : 'fail',
        sev: hasDep(allDeps, '@playwright/test') ? 'medium' : 'info',
        message: hasDep(allDeps, '@playwright/test')
            ? hasPlaywrightTestScript
                ? 'Script "playwright test" found.'
                : 'Playwright installed but no test script found.'
            : 'Playwright not used.',
        suggestion: hasDep(allDeps, '@playwright/test')
            ? undefined
            : 'Add "test": "playwright test" script to run Playwright tests.',
        file: 'package.json',
    });
    // Allure pairing
    const hasAllurePlaywright = hasDep(allDeps, 'allure-playwright');
    const hasAllureCmd = hasDep(allDeps, 'allure-commandline');
    addFinding({
        title: 'Allure dependencies consistent',
        status: hasAllurePlaywright && hasAllureCmd ? 'pass' : 'fail',
        sev: hasAllurePlaywright ? 'high' : 'info',
        message: hasAllurePlaywright
            ? hasAllureCmd
                ? 'allure-playwright & allure-commandline present.'
                : 'allure-playwright present but allure-commandline missing.'
            : 'Allure not used.',
        suggestion: hasAllurePlaywright
            ? undefined
            : 'Install both "allure-playwright" and "allure-commandline" for Allure reporting.',
        file: 'package.json',
    });
    // ---- Prettier + ESLint harmony
    const hasEslint = hasDep(allDeps, 'eslint');
    const hasPrettier = hasDep(allDeps, 'prettier');
    const prettierConfigFiles = await findFiles(targetDir, [
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.yaml',
        '.prettierrc.yml',
        '.prettierrc.js',
        '.prettierrc.cjs',
        'prettier.config.js',
        'prettier.config.cjs',
    ]);
    const hasPrettierConfig = prettierConfigFiles.length > 0;
    addFinding({
        title: 'Prettier + ESLint integration',
        status: hasEslint && hasPrettier && hasPrettierConfig ? 'pass' : 'fail',
        sev: hasEslint && hasPrettier ? 'high' : 'info',
        message: hasEslint && hasPrettier
            ? hasPrettierConfig
                ? 'ESLint & Prettier integrated with configs.'
                : 'Missing Prettier config file.'
            : 'ESLint or Prettier not used.',
        suggestion: hasEslint && hasPrettier
            ? undefined
            : 'Install and configure ESLint and Prettier, or remove unused tooling.',
        artifacts: [pkgPath, ...prettierConfigFiles],
    });
    // ---- Husky + lint-staged wiring
    const huskyInstalled = hasDep(allDeps, 'husky');
    const lintStagedInstalled = hasDep(allDeps, 'lint-staged');
    const hasPrepareScript = !!scripts['prepare'];
    const huskyDir = path.join(targetDir, '.husky');
    const huskyDirExists = await exists(huskyDir);
    addFinding({
        title: 'Husky installed & prepared',
        status: huskyInstalled && hasPrepareScript && huskyDirExists ? 'pass' : 'fail',
        sev: huskyInstalled ? 'medium' : 'info',
        message: huskyInstalled
            ? hasPrepareScript && huskyDirExists
                ? 'Husky installed, "prepare" script set, and .husky/ present.'
                : 'Husky installed but missing "prepare" script and/or .husky directory.'
            : 'Husky not used.',
        suggestion: huskyInstalled
            ? undefined
            : 'Install "husky", add "prepare" script, and run "husky install".',
        artifacts: [pkgPath, huskyDir],
    });
    // ---- lint-staged: present either in package.json or a config file
    const lintStagedConfigFiles = await findFiles(targetDir, [
        '.lintstagedrc',
        '.lintstagedrc.json',
        '.lintstagedrc.yaml',
        '.lintstagedrc.yml',
        'lint-staged.config.js',
        'lint-staged.config.cjs',
        'lint-staged.config.mjs',
        'lint-staged.config.ts',
    ]);
    const hasLintStagedConfig = !!pkg['lint-staged'] || lintStagedConfigFiles.length > 0;
    addFinding({
        title: 'lint-staged configured',
        status: lintStagedInstalled && hasLintStagedConfig ? 'pass' : 'fail',
        sev: lintStagedInstalled ? 'medium' : 'info',
        message: lintStagedInstalled
            ? hasLintStagedConfig
                ? 'lint-staged configuration found.'
                : 'lint-staged installed but no configuration found.'
            : 'lint-staged not used.',
        suggestion: lintStagedInstalled
            ? undefined
            : 'Add a lint-staged config (e.g., format TS/JS/JSON/MD on pre-commit).',
        artifacts: lintStagedConfigFiles,
    });
    // ---- Version hygiene (avoid floating versions like "*" or "latest")
    const floaters = Object.entries(allDeps)
        .filter(([, v]) => looksFloating(v))
        .map(([n, v]) => `${n}@${v}`);
    addFinding({
        title: 'No floating dependency versions',
        status: floaters.length === 0 ? 'pass' : 'fail',
        sev: floaters.length ? 'medium' : 'low',
        message: floaters.length === 0
            ? 'All versions pinned with a range (^ or ~) or exact.'
            : `Floating versions detected: ${floaters.join(', ')}`,
        suggestion: floaters.length > 0
            ? undefined
            : 'Replace "*" or "latest" with a caret (^) range or a pinned version.',
        file: 'package.json',
    });
    // ---- Lockfile sanity (only one package manager lock)
    const lockfiles = await Promise.all([
        exists(path.join(targetDir, 'package-lock.json')).then((p) => (p ? 'package-lock.json' : '')),
        exists(path.join(targetDir, 'yarn.lock')).then((p) => (p ? 'yarn.lock' : '')),
        exists(path.join(targetDir, 'pnpm-lock.yaml')).then((p) => (p ? 'pnpm-lock.yaml' : '')),
        exists(path.join(targetDir, 'bun.lockb')).then((p) => (p ? 'bun.lockb' : '')),
    ]);
    const presentLocks = lockfiles.filter(Boolean);
    addFinding({
        title: 'Single lockfile present',
        status: presentLocks.length <= 1 ? 'pass' : 'fail',
        sev: presentLocks.length > 1 ? 'medium' : 'low',
        message: presentLocks.length === 0
            ? 'No lockfile found.'
            : presentLocks.length === 1
                ? `Using ${presentLocks[0]}`
                : `Multiple lockfiles present: ${presentLocks.join(', ')}`,
        suggestion: presentLocks.length > 1
            ? 'Keep only one lockfile to avoid resolver conflicts.'
            : presentLocks.length === 0
                ? 'Commit your lockfile to ensure reproducible installs.'
                : undefined,
        artifacts: presentLocks.map((lf) => path.join(targetDir, lf)),
    });
    // ---- Date/time & util library guidance (moment → dayjs/date-fns)
    const hasMoment = hasDep(allDeps, 'moment');
    addFinding({
        title: 'Modern date/time library',
        status: hasMoment ? 'pass' : 'fail',
        sev: hasMoment ? 'info' : 'low',
        message: hasMoment ? 'Using "moment".' : 'No legacy date library detected.',
        suggestion: hasMoment
            ? ' Consider "dayjs" or "date-fns" where possible for smaller footprint.'
            : 'No action required.',
        file: 'package.json',
    });
    // ---- Duplicative data generators (faker vs chance)
    const hasFaker = hasDep(allDeps, '@faker-js/faker');
    const hasChance = hasDep(allDeps, 'chance');
    addFinding({
        title: 'Avoid duplicate data-gen libraries',
        status: !(hasFaker && hasChance) ? 'pass' : 'fail',
        sev: hasFaker && hasChance ? 'info' : 'low',
        message: hasFaker && hasChance
            ? 'Both @faker-js/faker and chance detected.'
            : 'No duplication detected.',
        suggestion: hasFaker && hasChance
            ? 'Standardize on one data generator to reduce bundle size and surface area.'
            : 'No action required.',
        file: 'package.json',
    });
    // ---- Node engine field (helps CI & local alignment)
    const hasEngine = !!pkg.engines?.node;
    addFinding({
        title: 'Node engine specified',
        status: hasEngine ? 'pass' : 'fail',
        sev: 'info',
        message: hasEngine ? `engines.node: ${pkg.engines?.node}` : 'No engines.node field.',
        suggestion: hasEngine
            ? undefined
            : 'Add "engines": { "node": ">=18 <23" } (or whichever LTS you target).',
        file: 'package.json',
    });
    // ---- ESM/CJS coherence with tooling
    const isESM = pkg.type === 'module';
    const hasTsx = hasDep(allDeps, 'tsx');
    const hasTsNode = hasDep(allDeps, 'ts-node');
    addFinding({
        title: 'ESM tooling coherence',
        status: !isESM || hasTsx || !hasTsNode ? 'pass' : 'fail',
        sev: isESM ? 'info' : 'low',
        message: isESM
            ? hasTsx
                ? 'ESM project with tsx available.'
                : hasTsNode
                    ? 'ESM project using ts-node; ensure loader flags are correct.'
                    : 'ESM project; tsx/loader not detected.'
            : 'CJS project; no special loader needs assumed.',
        suggestion: isESM ? 'Prefer "tsx" for running TS in ESM projects.' : 'No action required.',
        file: 'package.json',
    });
    // ---- Script suite coverage (lint/format/clean)
    const lintScriptNames = ['lint', 'eslint-lint', 'eslint'];
    addFinding({
        title: 'ESLint lint script exists',
        status: (() => {
            const present = lintScriptNames.some((k) => !!scripts[k]);
            return present ? 'pass' : 'fail';
        })(),
        sev: 'low',
        message: (() => {
            const presentKeys = lintScriptNames.filter((k) => !!scripts[k]);
            if (presentKeys.length === 0) {
                return ('No lint-related script found (checked common variants: ' +
                    lintScriptNames.join(', ') +
                    ').');
            }
            const details = presentKeys.map((k) => `"${k}": ${JSON.stringify(scripts[k])}`).join('; ');
            return `Lint script(s) found: ${presentKeys.join(', ')}. ${details}`;
        })(),
        suggestion: (() => {
            const presentKeys = lintScriptNames.filter((k) => !!scripts[k]);
            if (presentKeys.length === 0) {
                return 'Add a lint script: e.g. "lint": "eslint \\"**/*.{ts,js,tsx,jsx}\\""';
            }
            return undefined;
        })(),
        file: 'package.json',
    });
    const formatNames = [
        'format',
        'prettier-format',
        'prettier-fix',
        'prettier',
        'prettier:format',
        'prettier:fix',
        'prettier:fmt',
        'fmt',
        'format:fix',
    ];
    addFinding({
        title: 'Prettier / format script present',
        status: (() => {
            const present = formatNames.some((k) => !!scripts[k]);
            return present ? 'pass' : 'fail';
        })(),
        sev: 'low',
        message: (() => {
            const presentKeys = formatNames.filter((k) => !!scripts[k]);
            const anyPrettier = anyScriptIncludes(scripts, /\bprettier\b/);
            if (presentKeys.length === 0) {
                return ('No format-related script found (checked common variants: ' +
                    formatNames.join(', ') +
                    ').');
            }
            const details = presentKeys.map((k) => `"${k}": ${JSON.stringify(scripts[k])}`).join('; ');
            if (anyPrettier || presentKeys.some((k) => /\bprettier\b/.test(scripts[k]))) {
                return `Format script(s) found: ${presentKeys.join(', ')}. ${details}`;
            }
            return `Format script(s) found but none invoke Prettier: ${presentKeys.join(', ')}. ${details}`;
        })(),
        suggestion: (() => {
            const presentKeys = formatNames.filter((k) => !!scripts[k]);
            const anyPrettier = anyScriptIncludes(scripts, /\bprettier\b/);
            if (presentKeys.length === 0) {
                return 'Add a format script: e.g. "format": "prettier --write \\"**/*.{ts,js,tsx,jsx,json,md,yml,yaml}\\""';
            }
            if (!anyPrettier) {
                return ('Ensure your format script runs Prettier (or an equivalent formatter). Example: ' +
                    '"format": "prettier --write \\"**/*.{ts,js,tsx,jsx,json,md,yml,yaml}\\""');
            }
            return undefined;
        })(),
        file: 'package.json',
    });
    const cleanScriptNames = ['clean', 'cleanup', 'clear', 'logs:clean', 'logs-clean'];
    addFinding({
        title: 'Clean script exists for artifacts',
        status: (() => {
            const present = cleanScriptNames.some((k) => !!scripts[k]);
            return present ? 'pass' : 'fail';
        })(),
        sev: 'info',
        message: (() => {
            const presentKeys = cleanScriptNames.filter((k) => !!scripts[k]);
            if (presentKeys.length === 0) {
                return ('No clean-related script found (checked common variants: ' +
                    cleanScriptNames.join(', ') +
                    ').');
            }
            const details = presentKeys.map((k) => `"${k}": ${JSON.stringify(scripts[k])}`).join('; ');
            return `Clean script(s) found: ${presentKeys.join(', ')}. ${details}`;
        })(),
        suggestion: (() => {
            const presentKeys = cleanScriptNames.filter((k) => !!scripts[k]);
            if (presentKeys.length === 0) {
                return 'Add a clean script to remove build/test artifacts, e.g. "clean": "rimraf ./dist ./artifacts"';
            }
            return undefined;
        })(),
        file: 'package.json',
    });
    // ---- Jest/Vitest vs Playwright conflicts (optional heads-up)
    const hasJest = hasDep(allDeps, 'jest') || anyScriptIncludes(scripts, /\bjest\b/);
    const hasVitest = hasDep(allDeps, 'vitest') || anyScriptIncludes(scripts, /\bvitest\b/);
    const mixedRunners = (hasJest || hasVitest) && hasDep(allDeps, '@playwright/test');
    addFinding({
        title: 'Test runner overlap awareness',
        status: 'pass',
        sev: mixedRunners ? 'info' : 'low',
        message: mixedRunners
            ? 'Playwright present alongside Jest/Vitest; ensure runner responsibilities are clearly separated.'
            : 'Single-runner setup or clear separation assumed.',
        suggestion: mixedRunners
            ? 'Document which runner handles what (e2e vs unit/component) and avoid redundant configs.'
            : 'No action required.',
        file: 'package.json',
    });
    // ---- Cross-env presence if scripts reference process.env on Windows (soft check)
    const usesCrossEnvInScripts = anyScriptIncludes(scripts, /\bcross-env\b/);
    const hasCrossEnv = hasDep(allDeps, 'cross-env');
    addFinding({
        title: 'cross-env usage',
        status: !usesCrossEnvInScripts || hasDep(allDeps, 'cross-env') ? 'pass' : 'fail',
        sev: usesCrossEnvInScripts ? 'low' : 'info',
        message: usesCrossEnvInScripts
            ? 'cross-env referenced and installed.'
            : 'cross-env not referenced.',
        suggestion: usesCrossEnvInScripts && !hasCrossEnv
            ? 'Install "cross-env" or remove its usages from scripts.'
            : 'No action required.',
        file: 'package.json',
    });
    // ---- Final score
    cat.score = applyScore(cat.findings);
    return cat;
}

import path from 'path';
import { addFinding, applyScore, createCategory, exists, makeId, walk, } from '../utils/helpers.js';
const cat = createCategory('structure', 'Project Structure');
async function firstExisting(targetDir, paths) {
    for (const p of paths) {
        if (await exists(path.join(targetDir, p)))
            return { ok: true, used: p };
    }
    return { ok: false };
}
export async function analyzeProjectStructure(targetDir) {
    // --- Core presence checks ---
    const candidates = [
        { label: 'Root package.json present', path: 'package.json', sev: 'high' },
        {
            label: 'Playwright config present',
            path: 'playwright.config.ts',
            sev: 'critical',
            alt: ['playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'],
        },
        {
            label: 'Tests directory exists',
            path: 'tests',
            sev: 'medium',
            alt: ['e2e', 'test', '__tests__', 'src/tests'],
        },
        { label: 'Src directory exists', path: 'src', sev: 'medium', alt: ['e2e/src'] },
        {
            label: 'Config directory exists',
            path: 'src/configs',
            sev: 'medium',
            alt: ['src/config', 'e2e/src/configs', 'e2e/src/config'],
        },
        { label: 'Data directory exists', path: 'src/data', sev: 'medium', alt: ['e2e/src/data'] },
        {
            label: 'Envs directory exists',
            path: 'src/environments',
            sev: 'medium',
            alt: ['e2e/src/environments', 'src/env'],
        },
        {
            label: 'Fixtures directory exists',
            path: 'src/fixtures',
            sev: 'medium',
            alt: ['e2e/fixtures'],
        },
        { label: 'Helpers directory exists', path: 'src/helpers', sev: 'medium', alt: ['e2e/helpers'] },
        { label: 'Pages directory exists', path: 'src/pages', sev: 'medium', alt: ['e2e/pages'] },
        {
            label: 'Services directory exists',
            path: 'src/services',
            sev: 'medium',
            alt: ['e2e/services'],
        },
        { label: 'Utils directory exists', path: 'src/utils', sev: 'medium', alt: ['e2e/utils'] },
        {
            label: '.husky directory exists',
            path: '.husky',
            sev: 'medium',
            alt: ['e2e/.husky', 'src/.husky'],
        },
        { label: 'TypeScript config present', path: 'tsconfig.json', sev: 'low' },
        { label: 'Git ignore present', path: '.gitignore', sev: 'low' },
        { label: 'Editor config present', path: '.editorconfig', sev: 'info' },
        {
            label: 'ESLint config present',
            path: 'eslint.config.js',
            sev: 'info',
            alt: ['eslint.config.mjs', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc'],
        },
        { label: 'README present', path: 'README.md', sev: 'medium', alt: ['ReadMe.md', 'USAGE.md'] },
        {
            label: 'Lockfile present (npm/pnpm/yarn)',
            path: 'package-lock.json',
            sev: 'info',
            alt: ['pnpm-lock.yaml', 'yarn.lock'],
        },
    ];
    for (const c of candidates) {
        const pathsToCheck = [c.path, ...(c.alt || [])];
        const res = await firstExisting(targetDir, pathsToCheck);
        addFinding(cat, {
            id: makeId(c.label),
            title: c.label,
            status: res.ok, // boolean for helper; cast to satisfy TS
            severity: c.sev,
            message: res.ok ? 'Found' : 'Missing',
            file: res.ok ? res.used : c.path,
            artifacts: res.ok && res.used ? [path.join(targetDir, res.used)] : [path.join(targetDir, c.path)],
        });
    }
    // --- Enhanced structure validations ---
    // 1) Exactly one lockfile present
    const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
    const presentLocks = [];
    for (const lf of lockfiles)
        if (await exists(path.join(targetDir, lf)))
            presentLocks.push(lf);
    const hasSingleLock = presentLocks.length === 1;
    const hasNoLock = presentLocks.length === 0;
    addFinding(cat, {
        id: makeId('Single lockfile sanity'),
        title: 'Single lockfile sanity',
        status: hasSingleLock,
        severity: hasNoLock ? 'medium' : presentLocks.length > 1 ? 'high' : 'info',
        message: hasSingleLock
            ? `Exactly one lockfile present (${presentLocks[0]}).`
            : hasNoLock
                ? 'No lockfile found.'
                : `Multiple lockfiles found: ${presentLocks.join(', ')}.`,
        suggestion: hasSingleLock
            ? 'Good. Keep a single package manager lock.'
            : 'Keep only one of package-lock.json, pnpm-lock.yaml, or yarn.lock to avoid conflicts.',
        artifacts: presentLocks.map((p) => path.join(targetDir, p)),
    });
    // 2) Test files actually exist
    const testRoots = ['tests', 'e2e', 'test', '__tests__', 'src'];
    let testFilesCount = 0;
    for (const r of testRoots) {
        const p = path.join(targetDir, r);
        if (!(await exists(p)))
            continue;
        const files = await walk(p);
        testFilesCount += files.filter((f) => /\.(spec|test)\.(t|j)sx?$/.test(f)).length;
    }
    addFinding(cat, {
        id: makeId('Test files present'),
        title: 'Test files present',
        status: (testFilesCount > 0),
        severity: testFilesCount > 0 ? 'info' : 'medium',
        message: testFilesCount > 0 ? `Found ${testFilesCount} test file(s).` : 'No test files detected.',
        suggestion: testFilesCount > 0
            ? 'Ensure test files live under a consistent directory (e.g., tests/ or e2e/).'
            : 'Add at least one *.spec.ts or *.test.ts file to start your test suite.',
    });
    // 3) Prettier config present
    const prettierCandidates = [
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.js',
        'prettier.config.js',
        'prettier.config.cjs',
        '.prettierrc.cjs',
        '.prettierrc.yml',
        '.prettierrc.yaml',
    ];
    const prettierRes = await firstExisting(targetDir, prettierCandidates);
    addFinding(cat, {
        id: makeId('Prettier config present'),
        title: 'Prettier config present',
        status: prettierRes.ok,
        severity: 'info',
        message: prettierRes.ok ? 'Found' : 'Missing',
        suggestion: prettierRes.ok
            ? 'Great—ensure your CI runs formatting checks.'
            : 'Add a Prettier config to enforce consistent formatting.',
        file: prettierRes.ok ? prettierRes.used : prettierCandidates[0],
        artifacts: prettierRes.ok && prettierRes.used ? [path.join(targetDir, prettierRes.used)] : [],
    });
    // 4) .vscode settings folder
    const hasVscode = await exists(path.join(targetDir, '.vscode'));
    addFinding(cat, {
        id: makeId('.vscode folder present'),
        title: '.vscode folder present',
        status: hasVscode,
        severity: 'info',
        message: hasVscode ? 'Found' : 'Missing',
        suggestion: hasVscode
            ? 'Consider sharing recommended extensions and settings for the repo.'
            : 'Add a .vscode/ with recommended extensions, format-on-save, etc.',
        artifacts: hasVscode ? [path.join(targetDir, '.vscode')] : [],
    });
    // 5) GitHub Actions workflows
    const hasWorkflows = await exists(path.join(targetDir, '.github/workflows'));
    addFinding(cat, {
        id: makeId('GitHub Actions workflows folder'),
        title: 'GitHub Actions workflows folder',
        status: hasWorkflows,
        severity: 'info',
        message: hasWorkflows ? 'Found' : 'Missing',
        suggestion: hasWorkflows
            ? 'Ensure CI covers lint, typecheck, tests, and artifacts upload.'
            : 'Create .github/workflows to enable CI/CD pipelines.',
        artifacts: hasWorkflows ? [path.join(targetDir, '.github/workflows')] : [],
    });
    // 6) Node version file
    const nodeVersionRes = await firstExisting(targetDir, ['.nvmrc', '.node-version']);
    addFinding(cat, {
        id: makeId('Node version file present'),
        title: 'Node version file present',
        status: nodeVersionRes.ok,
        severity: 'info',
        message: nodeVersionRes.ok ? `Found ${nodeVersionRes.used}` : 'Missing',
        suggestion: nodeVersionRes.ok
            ? 'Use a consistent Node version locally and in CI.'
            : 'Add .nvmrc or .node-version to pin Node across environments.',
        file: nodeVersionRes.used,
        artifacts: nodeVersionRes.ok && nodeVersionRes.used ? [path.join(targetDir, nodeVersionRes.used)] : [],
    });
    // 7) Monorepo hint
    const monorepoHints = ['packages', 'apps', 'turbo.json', 'pnpm-workspace.yaml'];
    const monoFound = [];
    for (const h of monorepoHints)
        if (await exists(path.join(targetDir, h)))
            monoFound.push(h);
    addFinding(cat, {
        id: makeId('Monorepo workspace detected'),
        title: 'Monorepo workspace detected',
        status: (monoFound.length > 0),
        severity: 'info',
        message: monoFound.length > 0
            ? `Indicators found: ${monoFound.join(', ')}`
            : 'No monorepo indicators detected (single-package repo).',
        suggestion: monoFound.length > 0
            ? 'Ensure shared configs (eslint/prettier/tsconfig) are hoisted and referenced by each package.'
            : 'If repo grows, consider workspaces for multi-package management.',
        artifacts: monoFound.map((p) => path.join(targetDir, p)),
    });
    // Score
    cat.score = applyScore(cat.findings);
    return cat;
}

import path from 'path';
import { CategoryResult } from '../types.js';
import {
  applyScore,
  createCategory,
  exists,
  findFiles,
  readFile,
  readJsonSafe,
  Sev,
} from '../utils/helpers.js';

const cat = createCategory('deps', 'Dependencies');

type PkgJson = {
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

type FindingInput = {
  id?: string;
  title: string;
  status: 'pass' | 'fail';
  sev: Sev;
  message?: string;
  suggestion?: string;
  file?: string;
  artifacts?: string[];
};

function addFinding(f: FindingInput) {
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

function depMap(pkg: PkgJson) {
  return {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };
}

function getVersion(allDeps: Record<string, string>, name: string) {
  return allDeps[name];
}

function hasDep(allDeps: Record<string, string>, name: string) {
  return !!getVersion(allDeps, name);
}

function anyScriptIncludes(scripts: Record<string, string>, pattern: RegExp) {
  return Object.values(scripts || {}).some((s) => pattern.test(s));
}

function looksFloating(v = '') {
  return v === 'latest' || v === '*' || /^\d+\.\d+$/.test(v); // crude but useful
}

async function safeRead(p?: string | null) {
  if (!p) return '';
  try {
    return await readFile(p);
  } catch {
    return '';
  }
}

export async function analyzeDependencies(targetDir: string): Promise<CategoryResult> {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg: PkgJson = (await readJsonSafe(pkgPath)) || {};
  const allDeps = depMap(pkg);
  const scripts = pkg.scripts || {};

  // ---- 1) Core dependency presence (baseline you already had, expanded & corrected)
  const baselineChecks: Array<[string, Sev]> = [
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
    status: (usesTS ? hasTsEslintPlugin && hasTsEslintParser && !mistakenlyHasOldMeta : true)
      ? 'pass'
      : 'fail',
    sev: usesTS ? 'high' : 'info',
    message: usesTS
      ? hasTsEslintPlugin && hasTsEslintParser
        ? mistakenlyHasOldMeta
          ? 'Has @typescript-eslint/* but also legacy "typescript-eslint" (remove).'
          : 'ESLint wired for TypeScript.'
        : 'Missing @typescript-eslint/eslint-plugin and/or @typescript-eslint/parser.'
      : 'TypeScript not detected; skipping.',
    suggestion: usesTS
      ? 'Install @typescript-eslint/eslint-plugin & @typescript-eslint/parser and remove legacy "typescript-eslint".'
      : undefined,
    artifacts: [pkgPath, ...tsconfigCandidates],
  });

  // If TypeScript used, ensure a typecheck script exists
  addFinding({
    title: 'TypeScript typecheck script',
    status: (usesTS ? !!scripts['typecheck'] : true) ? 'pass' : 'fail',
    sev: usesTS ? 'low' : 'info',
    message: usesTS
      ? scripts['typecheck']
        ? `Script "typecheck": ${scripts['typecheck']}`
        : 'Script "typecheck" missing'
      : 'TypeScript not detected; skipping.',
    suggestion: usesTS ? 'Add "typecheck": "tsc -p tsconfig.json --noEmit".' : undefined,
    file: 'package.json',
  });

  // ---- 3) Playwright wiring & Allure coupling
  const testScript = scripts['test'] || '';
  const hasPlaywrightTestScript =
    /playwright\s+test/.test(testScript) || anyScriptIncludes(scripts, /\bplaywright\s+test\b/);

  addFinding({
    title: 'Playwright test script',
    status: hasPlaywrightTestScript ? 'pass' : 'fail',
    sev: 'medium',
    message: hasPlaywrightTestScript
      ? `Script "test": ${testScript}`
      : 'No "playwright test" in scripts.',
    suggestion: 'Add "test": "playwright test" (and consider CI variants like "--reporter=line").',
    file: 'package.json',
  });

  const hasAllurePlaywright = hasDep(allDeps, 'allure-playwright');
  const hasAllureCmd = hasDep(allDeps, 'allure-commandline');

  addFinding({
    title: 'Allure dependencies consistent',
    status: (hasAllurePlaywright ? hasAllureCmd : true) ? 'pass' : 'fail',
    sev: hasAllurePlaywright ? 'high' : 'info',
    message: hasAllurePlaywright
      ? hasAllureCmd
        ? 'allure-playwright & allure-commandline present.'
        : 'allure-playwright present but allure-commandline missing.'
      : 'Allure not used; skipping.',
    suggestion: hasAllurePlaywright
      ? 'Install "allure-commandline" for local/CI report generation.'
      : undefined,
    file: 'package.json',
  });

  // ---- 4) Prettier + ESLint harmony
  const hasEslint = hasDep(allDeps, 'eslint');
  const hasPrettier = hasDep(allDeps, 'prettier');
  const hasEslintConfigPrettier = hasDep(allDeps, 'eslint-config-prettier');

  addFinding({
    title: 'ESLint + Prettier integration',
    status: !hasEslint || (hasPrettier && hasEslintConfigPrettier) ? 'pass' : 'fail',
    sev: hasEslint ? 'high' : 'info',
    message: hasEslint
      ? hasPrettier && hasEslintConfigPrettier
        ? 'ESLint and Prettier correctly integrated.'
        : 'Missing Prettier and/or eslint-config-prettier.'
      : 'ESLint not detected; skipping.',
    suggestion: hasEslint
      ? 'Install "prettier" and "eslint-config-prettier"; extend it last in ESLint config.'
      : undefined,
    file: 'package.json',
  });

  // ---- 5) Husky + lint-staged wiring
  const huskyInstalled = hasDep(allDeps, 'husky');
  const lintStagedInstalled = hasDep(allDeps, 'lint-staged');
  const hasPrepareScript = !!scripts['prepare'];
  const huskyDir = path.join(targetDir, '.husky');
  const huskyDirExists = await exists(huskyDir);

  addFinding({
    title: 'Husky installed & prepared',
    status: (huskyInstalled ? hasPrepareScript && huskyDirExists : true) ? 'pass' : 'fail',
    sev: huskyInstalled ? 'medium' : 'info',
    message: huskyInstalled
      ? hasPrepareScript && huskyDirExists
        ? 'Husky installed, "prepare" script set, and .husky/ present.'
        : 'Husky installed but missing "prepare" script and/or .husky directory.'
      : 'Husky not used; skipping.',
    suggestion: huskyInstalled
      ? 'Add "prepare": "husky install" and run it once to create .husky/.'
      : undefined,
    artifacts: [pkgPath, huskyDir],
  });

  // lint-staged: present either in package.json or a config file
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
    status: (lintStagedInstalled ? hasLintStagedConfig : true) ? 'pass' : 'fail',
    sev: lintStagedInstalled ? 'medium' : 'info',
    message: lintStagedInstalled
      ? hasLintStagedConfig
        ? 'lint-staged configuration found.'
        : 'lint-staged installed but no configuration found.'
      : 'lint-staged not used; skipping.',
    suggestion: lintStagedInstalled
      ? 'Add a lint-staged config (e.g., format TS/JS/JSON/MD on pre-commit).'
      : undefined,
    artifacts: lintStagedConfigFiles,
  });

  // ---- 6) Version hygiene (avoid floating versions like "*" or "latest")
  const floaters = Object.entries(allDeps)
    .filter(([, v]) => looksFloating(v))
    .map(([n, v]) => `${n}@${v}`);

  addFinding({
    title: 'No floating dependency versions',
    status: floaters.length === 0 ? 'pass' : 'fail',
    sev: floaters.length ? 'medium' : 'low',
    message:
      floaters.length === 0
        ? 'All versions pinned with a range (^ or ~) or exact.'
        : `Floating versions detected: ${floaters.join(', ')}`,
    suggestion:
      floaters.length > 0
        ? 'Replace "*" or "latest" with a caret (^) range or a pinned version.'
        : undefined,
    file: 'package.json',
  });

  // ---- 7) Lockfile sanity (only one package manager lock)
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
    message:
      presentLocks.length === 0
        ? 'No lockfile found.'
        : presentLocks.length === 1
          ? `Using ${presentLocks[0]}`
          : `Multiple lockfiles present: ${presentLocks.join(', ')}`,
    suggestion:
      presentLocks.length > 1
        ? 'Keep only one lockfile to avoid resolver conflicts.'
        : presentLocks.length === 0
          ? 'Commit your lockfile to ensure reproducible installs.'
          : undefined,
    artifacts: presentLocks.map((lf) => path.join(targetDir, lf)),
  });

  // ---- 8) Date/time & util library guidance (moment → dayjs/date-fns)
  const hasMoment = hasDep(allDeps, 'moment');
  addFinding({
    title: 'Modern date/time library',
    status: !hasMoment ? 'pass' : 'fail',
    sev: hasMoment ? 'info' : 'low',
    message: hasMoment
      ? 'Using "moment". Consider "dayjs" or "date-fns" for smaller footprint.'
      : 'No legacy date library detected.',
    suggestion: hasMoment ? 'Migrate to "dayjs" or "date-fns" where possible.' : undefined,
    file: 'package.json',
  });

  // ---- 9) Duplicative data generators (faker vs chance)
  const hasFaker = hasDep(allDeps, '@faker-js/faker');
  const hasChance = hasDep(allDeps, 'chance');
  addFinding({
    title: 'Avoid duplicate data-gen libraries',
    status: !(hasFaker && hasChance) ? 'pass' : 'fail',
    sev: hasFaker && hasChance ? 'info' : 'low',
    message:
      hasFaker && hasChance
        ? 'Both @faker-js/faker and chance detected.'
        : 'No duplication detected.',
    suggestion:
      hasFaker && hasChance
        ? 'Standardize on one data generator to reduce bundle size and surface area.'
        : undefined,
    file: 'package.json',
  });

  // ---- 10) Node engine field (helps CI & local alignment)
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

  // ---- 11) ESM/CJS coherence with tooling
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
    suggestion: isESM ? 'Prefer "tsx" for running TS in ESM projects.' : undefined,
    file: 'package.json',
  });

  // ---- 12) Script suite coverage (lint/format/clean)
  addFinding({
    title: 'ESLint lint script exists',
    status: scripts['lint'] ? 'pass' : 'fail',
    sev: 'low',
    message: scripts['lint'] ? `Script "lint": ${scripts['lint']}` : 'Script "lint" missing',
    suggestion: scripts['lint'] ? undefined : 'Add "lint": "eslint . --max-warnings=0".',
    file: 'package.json',
  });

  addFinding({
    title: 'Prettier format script exists',
    status: scripts['format'] ? 'pass' : 'fail',
    sev: 'low',
    message: scripts['format']
      ? `Script "format": ${scripts['format']}`
      : 'Script "format" missing',
    suggestion: scripts['format']
      ? undefined
      : 'Add "format": "prettier --write \\"**/*.{ts,js,tsx,jsx,json,md,yml,yaml}\\""',
    file: 'package.json',
  });

  const hasCleanScript =
    !!scripts['clean'] &&
    /(rimraf|rm\s+-rf|del-cli).*(test-results|trace|screenshots|downloads|coverage)/i.test(
      scripts['clean'],
    );

  addFinding({
    title: 'Clean script exists for artifacts',
    status: hasCleanScript ? 'pass' : 'fail',
    sev: 'info',
    message: hasCleanScript
      ? `Script "clean": ${scripts['clean']}`
      : 'Artifact clean script not found.',
    suggestion:
      'Add "clean": "rimraf test-results trace screenshots downloads coverage" to keep repo tidy.',
    file: 'package.json',
  });

  // ---- 13) Jest/Vitest vs Playwright conflicts (optional heads-up)
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
      : undefined,
    file: 'package.json',
  });

  // ---- 14) Cross-env presence if scripts reference process.env on Windows (soft check)
  const usesCrossEnvInScripts = anyScriptIncludes(scripts, /\bcross-env\b/);
  addFinding({
    title: 'cross-env usage',
    status: !usesCrossEnvInScripts || hasDep(allDeps, 'cross-env') ? 'pass' : 'fail',
    sev: usesCrossEnvInScripts ? 'low' : 'info',
    message: usesCrossEnvInScripts
      ? 'cross-env referenced and installed.'
      : 'cross-env not referenced; skipping.',
    file: 'package.json',
  });

  // ---- Final score
  cat.score = applyScore(cat.findings);
  return cat;
}

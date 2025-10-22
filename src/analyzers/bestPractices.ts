// src/analyzers/bestPractices.ts
import path from 'path';
import { CategoryResult } from '../types.js';
import {
  applyScore,
  createCategory,
  exists,
  fileExistsAny,
  inDeps,
  ok,
  PkgJson,
  readFile,
  readJsonSafe,
  readTsconfig,
  Sev,
  walkFiles,
} from '../utils/helpers.js';

/** Find first N files with an anti-pattern (e.g., waitForTimeout). */
async function findAntiPatternFiles(
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

export async function analyzeBestPractices(targetDir: string): Promise<CategoryResult> {
  const cat = createCategory('best', 'Best Practices Enforcement');

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = (await readJsonSafe<PkgJson>(pkgPath)) || {};
  const scripts = pkg.scripts || {};

  // ESLint: file config OR package.json eslintConfig
  const eslintrcPath =
    (await fileExistsAny(targetDir, [
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      'eslint.config.js',
      'eslint.config.mjs',
    ])) || undefined;
  const eslintConfigured = !!eslintrcPath;
  const eslintDeps = inDeps(pkg, [
    'eslint',
    '@typescript-eslint/parser',
    '@typescript-eslint/eslint-plugin',
  ]);

  // Prettier: file config OR package.json prettier
  const prettierPath =
    (await fileExistsAny(targetDir, [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
    ])) || undefined;
  const prettierConfigured = !!prettierPath;
  const prettierDeps = inDeps(pkg, ['prettier']);

  // Husky & lint-staged
  const huskyDir = await exists(path.join(targetDir, '.husky'));
  const lintStagedConfigured =
    !!pkg['lint-staged'] ||
    !!(await fileExistsAny(targetDir, [
      '.lintstagedrc',
      '.lintstagedrc.json',
      '.lintstagedrc.js',
      'lint-staged.config.js',
      'lint-staged.config.cjs',
      'lint-staged.config.mjs',
    ]));

  // TypeScript strict
  const { path: tsconfigPath, json: tsconfigJson } = await readTsconfig(targetDir);
  const tsStrict = !!(tsconfigJson?.compilerOptions?.strict === true);

  // PR template (GitHub/GitLab) and README
  const prTemplatePath =
    (await fileExistsAny(targetDir, ['.github/pull_request_template.md'])) ||
    (await fileExistsAny(targetDir, ['.gitlab/merge_request_templates/Default.md']));
  const hasPRTemplate = !!prTemplatePath;
  const readmePath = await fileExistsAny(targetDir, ['README.md', 'README.MD', 'readme.md']);
  const hasReadme = !!readmePath;

  // Anti-patterns: waitForTimeout
  const antiPatternFiles = await findAntiPatternFiles(targetDir, /\bwaitForTimeout\s*\(/);
  const antiPatternPass = antiPatternFiles.length === 0;

  // .editorconfig
  const editorConfigPath = await fileExistsAny(targetDir, ['.editorconfig']);
  const hasEditorConfig = !!editorConfigPath;

  // Format scripts
  const formatScript = scripts['format'] || '';
  const formatFixScript = scripts['format:fix'] || '';
  const hasFormatScript = !!formatScript;
  const formatRunsPrettier =
    /\bprettier\b/.test(formatScript) || /\bprettier\b/.test(formatFixScript);
  const hasAnyFormatScript = hasFormatScript || !!formatFixScript;

  const checks: Array<{
    id: string;
    title: string;
    pass: boolean;
    sev: Sev;
    msgPass: string;
    msgFail: string;
    suggestion?: string;
    file?: string;
    artifacts?: string[];
  }> = [
    {
      id: 'eslint',
      title: 'ESLint configured',
      pass: eslintConfigured,
      sev: 'medium',
      msgPass: 'ESLint config present',
      msgFail: 'ESLint config missing',
      suggestion: !eslintConfigured
        ? 'Add .eslintrc.json (or eslint.config.js) and a "lint" script in package.json'
        : !eslintDeps
          ? 'Install eslint and @typescript-eslint packages to enable linting'
          : '',
      file: eslintrcPath || '',
    },
    {
      id: 'prettier',
      title: 'Prettier configured',
      pass: prettierConfigured && prettierDeps,
      sev: 'low',
      msgPass: 'Prettier config present',
      msgFail: 'Prettier config missing',
      suggestion: 'Add .prettierrc or prettier.config.js and format scripts',
      file: prettierPath || '',
    },
    {
      id: 'precommit',
      title: 'Pre-commit hooks (husky + lint-staged)',
      pass: huskyDir && lintStagedConfigured,
      sev: 'medium',
      msgPass: 'Pre-commit hooks present',
      msgFail: 'Husky/lint-staged missing',
      suggestion: 'Add Husky and lint-staged to enforce formatting & linting before commits',
      file: huskyDir ? path.join(targetDir, '.husky') : pkgPath || '',
    },
    {
      id: 'syntax',
      title: 'TypeScript strict mode',
      pass: tsStrict,
      sev: 'low',
      msgPass: 'tsconfig compilerOptions.strict = true',
      msgFail: 'TypeScript strict mode disabled',
      suggestion: 'Set "compilerOptions.strict": true in tsconfig',
      file: tsconfigPath || 'tsconfig.json',
    },
    {
      id: 'pw-best',
      title: 'Avoid anti-patterns (e.g., waitForTimeout)',
      pass: antiPatternPass,
      sev: 'info',
      msgPass: 'No waitForTimeout usage found',
      msgFail: 'Found waitForTimeout usage in project files',
      suggestion: 'Prefer expect-based waiting or proper events over waitForTimeout',
      artifacts: antiPatternFiles,
    },
    {
      id: 'pr-template',
      title: 'PR/MR review template',
      pass: hasPRTemplate,
      sev: 'info',
      msgPass: 'Template present',
      msgFail: 'Template missing',
      suggestion: 'Add .github/pull_request_template.md (or GitLab MR template)',
      file: prTemplatePath || '',
    },
    {
      id: 'readme',
      title: 'README present',
      pass: hasReadme,
      sev: 'low',
      msgPass: 'README.md found',
      msgFail: 'README.md missing',
      suggestion: 'Add a README with setup instructions & common scripts',
      file: readmePath || '',
    },
    {
      id: 'editorconfig',
      title: '.editorconfig present',
      pass: hasEditorConfig,
      sev: 'info',
      msgPass: '.editorconfig found',
      msgFail: '.editorconfig missing',
      suggestion: 'Add an .editorconfig to standardize editor settings across contributors',
      file: editorConfigPath || '',
    },
    {
      id: 'format-script',
      title: 'Format script exists',
      pass: hasAnyFormatScript,
      sev: 'low',
      msgPass: hasFormatScript ? 'npm run format exists' : 'npm run format:fix exists',
      msgFail: 'No "format" or "format:fix" script in package.json',
      file: pkgPath,
      suggestion: 'Add "format": "prettier --check ." and/or "format:fix": "prettier --write ."',
    },
    {
      id: 'format-prettier',
      title: 'Format script runs Prettier',
      pass: !hasAnyFormatScript ? false : formatRunsPrettier,
      sev: 'low',
      msgPass: 'Format script uses Prettier',
      msgFail: hasAnyFormatScript
        ? 'Format script does not appear to run Prettier'
        : 'No format script to validate',
      file: pkgPath,
      suggestion:
        'Ensure your format scripts call Prettier, e.g., "prettier --check ." and "prettier --write ."',
    },
    {
      id: 'lint-script',
      title: 'Lint script exists',
      pass: !!scripts.lint,
      sev: 'low',
      msgPass: 'npm run lint exists',
      msgFail: 'No "lint" script in package.json',
      file: pkgPath,
      suggestion: 'Add "lint": "eslint . --ext .ts,.tsx,.js" in package.json scripts',
    },
  ];

  // Emit findings
  for (const c of checks) {
    cat.findings.push({
      id: 'bp-' + c.id,
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

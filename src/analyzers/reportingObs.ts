import { promises as fs } from 'fs';
import path from 'path';
import { CategoryResult } from '../types.js';
import {
  addFinding,
  applyScore,
  createCategory,
  exists,
  findConfig,
  findFiles,
  makeId,
  readFile,
  readJson,
} from '../utils/helpers.js';

const cat = createCategory('reportingObs', 'Reporting & Observability');

async function readSafe(p?: string | null): Promise<string> {
  if (!p) return '';
  try {
    return await readFile(p);
  } catch {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      return '';
    }
  }
}

// remove // and /* */ comments (very simple stripper, good enough for heuristics)
function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n\r]*$/gm, '') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
}

// Return the reporter block (string or array text) if present
function extractReporterBlock(src: string): string {
  // match: reporter: 'html' | reporter: ["html", ["junit", {...}], ...]
  const m = src.match(/\breporter\s*:\s*(?:['"][^'"]+['"]|\[[\s\S]*?\])/m);
  return m ? m[0] : '';
}

// Is a given reporter present inside the reporter block?
function hasReporter(reporterBlock: string, name: string): boolean {
  if (!reporterBlock) return false;
  // 1) single string e.g. reporter: 'html'
  const single = new RegExp(`\\breporter\\s*:\\s*['"]${name}['"]`, 'i');
  if (single.test(reporterBlock)) return true;

  // 2) array entries:
  //    reporter: ['json']  OR ['json', {...}] OR ['@allure', {...}] OR ['monocart-reporter', {...}]
  //    Also allow bare strings inside array: "json", "html", "junit"
  const arrayContainsBare = new RegExp(`\\[([\\s\\S]*?)(['"])${name}\\2([\\s\\S]*?)\\]`, 'i');
  if (arrayContainsBare.test(reporterBlock)) return true;

  // 3) tuple with options, e.g. ['json', { outputFile: ... }]
  const tuple = new RegExp(`\\[\\s*(['"])${name}\\1\\s*,`, 'i');
  if (tuple.test(reporterBlock)) return true;

  // 4) common package names
  if (name === 'allure') {
    if (/\b(allure-playwright|@shelex\/allure-playwright)\b/i.test(reporterBlock)) return true;
  }
  if (name === 'monocart') {
    if (/\bmonocart-reporter\b/i.test(reporterBlock)) return true;
  }

  return false;
}

export async function analyzeReportingObs(targetDir: string): Promise<CategoryResult> {
  // Locate Playwright config
  const pwConfigPath = await findConfig(targetDir, [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ]);
  const raw = await readSafe(pwConfigPath);
  const pwText = stripComments(raw);

  // Extract reporter block once and check reporters inside it
  const reporterBlock = extractReporterBlock(pwText);
  const hasHtmlReporter = hasReporter(reporterBlock, 'html');
  const hasJunitReporter = hasReporter(reporterBlock, 'junit');
  const hasJsonReporter = hasReporter(reporterBlock, 'json');
  const hasAllureReporter = hasReporter(reporterBlock, 'allure');
  const hasMonocartReporter = hasReporter(reporterBlock, 'monocart');

  // artifact options (be lenient: consider key presence, not only literal values)
  const traceConfigured =
    /\btrace\s*:\s*['"`](on|retain-on-failure|on-first-retry)['"`]/i.test(pwText) ||
    /\btrace\s*:\s*\w+/i.test(pwText); // allow variables like trace: isCI ? 'on' : 'off'
  const screenshotConfigured =
    /\bscreenshot\s*:\s*['"`](on|only-on-failure)['"`]/i.test(pwText) ||
    /\bscreenshot\s*:\s*\w+/i.test(pwText);
  const videoConfigured =
    /\bvideo\s*:\s*['"`](on|retain-on-failure)['"`]/i.test(pwText) ||
    /\bvideo\s*:\s*\w+/i.test(pwText);

  // ✅ FIX: consider outputDir configured if the key exists, even if value is computed
  const outputDirConfigured = /\boutputDir\s*:/i.test(pwText);

  // Common artifact directories
  const dirs = {
    playwrightReport: path.join(targetDir, 'playwright-report'),
    testResults: path.join(targetDir, 'test-results'),
    screenshots: path.join(targetDir, 'screenshots'),
    trace: path.join(targetDir, 'trace'),
    allureResults: path.join(targetDir, 'allure-results'),
    allureReport: path.join(targetDir, 'allure-report'),
  };

  const hasPlaywrightReportDir = await exists(dirs.playwrightReport);
  const hasTestResultsDir = await exists(dirs.testResults);
  const hasScreenshotsDir = await exists(dirs.screenshots);
  const hasTraceDir = await exists(dirs.trace);
  const hasAllureResultsDir = await exists(dirs.allureResults);
  const hasAllureReportDir = await exists(dirs.allureReport);

  // Workflow hints: upload-artifact usage
  const workflowFiles = await findFiles(targetDir, [
    '.github/workflows/**/*.yml',
    '.github/workflows/**/*.yaml',
  ]);
  const workflowTexts = await Promise.all(workflowFiles.map(readSafe));
  const uploadsInCI = workflowTexts.some((t) => /actions\/upload-artifact/i.test(t));
  const uploadsHtmlReport = workflowTexts.some((t) =>
    /upload-artifact[\s\S]*playwright-report/i.test(t),
  );
  const uploadsTraces = workflowTexts.some((t) => /upload-artifact[\s\S]*trace/i.test(t));
  const uploadsScreens = workflowTexts.some((t) => /upload-artifact[\s\S]*screenshots/i.test(t));
  const uploadsAllure = workflowTexts.some((t) =>
    /upload-artifact[\s\S]*allure-(results|report)/i.test(t),
  );

  // Dependencies (for Allure/Monocart)
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = (await readJson<any>(pkgPath)) || {};
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasAllurePkg =
    'allure-playwright' in allDeps ||
    '@shelex/allure-playwright' in allDeps ||
    'allure-js-commons' in allDeps;
  const hasMonocartPkg = 'monocart-reporter' in allDeps;

  // Scan codebase for attachments & steps
  const codeFiles = await findFiles(targetDir, ['**/*.{ts,tsx,js,jsx}']);
  const LIMIT = 2000;
  const take = codeFiles.slice(0, LIMIT);

  const attachFiles = new Set<string>();
  const stepFiles = new Set<string>();

  for (const f of take) {
    const s = stripComments(await readSafe(f));
    if (!s) continue;
    if (/\btest\.info\(\)\.attach\s*\(/.test(s)) attachFiles.add(f);
    if (/\btest\.step\s*\(/.test(s)) stepFiles.add(f);
  }

  const pick = (arr: string[] | Set<string>, n = 10) =>
    (Array.isArray(arr) ? arr : Array.from(arr)).slice(0, n);

  // --- Findings ---

  // Reporters (checked only within reporter block)
  addFinding(cat, {
    id: makeId('HTML reporter configured'),
    title: 'HTML reporter configured',
    status: hasHtmlReporter as any,
    severity: 'low',
    message: hasHtmlReporter ? 'Configured in Playwright reporter' : 'Not configured',
    suggestion: 'Enable the built-in HTML reporter for local triage.',
    artifacts: [pwConfigPath || ''],
  });

  addFinding(cat, {
    id: makeId('JUnit reporter for CI'),
    title: 'JUnit reporter for CI',
    status: hasJunitReporter as any,
    severity: 'info',
    message: hasJunitReporter ? 'Configured in Playwright reporter' : 'Not configured',
    suggestion: 'Add JUnit reporter so CI systems can parse results.',
    artifacts: [pwConfigPath || ''],
  });

  addFinding(cat, {
    id: makeId('JSON reporter available'),
    title: 'JSON reporter available',
    status: hasJsonReporter as any,
    severity: 'info',
    message: hasJsonReporter ? 'Configured in Playwright reporter' : 'Not configured',
    suggestion: 'JSON reporter is useful for custom dashboards or post-processing in CI.',
    artifacts: [pwConfigPath || ''],
  });

  addFinding(cat, {
    id: makeId('Allure reporting configured'),
    title: 'Allure reporting configured',
    status: (hasAllureReporter || hasAllurePkg) as any,
    severity: 'low',
    message:
      hasAllureReporter || hasAllurePkg
        ? 'Allure reporter dependency/config detected'
        : 'Not configured',
    suggestion:
      'If you use Allure, install allure-playwright and wire the reporter; upload allure-results in CI.',
    artifacts: [
      pwConfigPath || '',
      ...(hasAllurePkg ? [pkgPath] : []),
      ...(hasAllureResultsDir ? [dirs.allureResults] : []),
    ].filter(Boolean),
  });

  addFinding(cat, {
    id: makeId('Monocart reporter configured'),
    title: 'Monocart reporter configured',
    status: (hasMonocartReporter || hasMonocartPkg) as any,
    severity: 'info',
    message:
      hasMonocartReporter || hasMonocartPkg ? 'Monocart reporter detected' : 'Not configured',
    suggestion: 'Monocart provides a rich single-file report that is easy to archive in CI.',
    artifacts: [pwConfigPath || '', ...(hasMonocartPkg ? [pkgPath] : [])].filter(Boolean),
  });

  // Artifacts + CI upload
  addFinding(cat, {
    id: makeId('HTML report persisted'),
    title: 'HTML report persisted',
    status: (hasPlaywrightReportDir || uploadsHtmlReport) as any,
    severity: 'low',
    message:
      hasPlaywrightReportDir || uploadsHtmlReport
        ? 'HTML report folder is uploaded'
        : 'HTML report not uploaded as artifact',
    suggestion: 'Upload `playwright-report` as an artifact in CI.',
    artifacts: [dirs.playwrightReport, ...pick(workflowFiles, 3)],
  });

  addFinding(cat, {
    id: makeId('Traces persisted'),
    title: 'Traces persisted',
    status: (hasTraceDir || uploadsTraces) as any,
    severity: 'info',
    message:
      hasTraceDir || uploadsTraces
        ? 'Trace artifacts are persisted'
        : 'No trace artifacts detected in repo/CI',
    suggestion: 'Enable `trace: "retain-on-failure"` and upload trace/*.zip in CI.',
    artifacts: [dirs.trace, ...pick(workflowFiles, 3)],
  });

  addFinding(cat, {
    id: makeId('Screenshots persisted'),
    title: 'Screenshots persisted',
    status: (hasScreenshotsDir || uploadsScreens) as any,
    severity: 'info',
    message:
      hasScreenshotsDir || uploadsScreens
        ? 'Screenshots folder is persisted'
        : 'No screenshots artifact detected',
    suggestion: 'Use `screenshot: "only-on-failure"` and upload the folder in CI.',
    artifacts: [dirs.screenshots, ...pick(workflowFiles, 3)],
  });

  addFinding(cat, {
    id: makeId('Allure results persisted'),
    title: 'Allure results persisted',
    status: (hasAllureResultsDir || uploadsAllure) as any,
    severity: 'info',
    message:
      hasAllureResultsDir || uploadsAllure
        ? 'Allure results are persisted'
        : 'No Allure results artifact detected',
    suggestion:
      'Upload `allure-results/` in CI and publish the report (`allure generate` or action).',
    artifacts: [dirs.allureResults, ...pick(workflowFiles, 3)],
  });

  // Config knobs: trace / screenshot / video / outputDir
  addFinding(cat, {
    id: makeId('Trace enabled on failures'),
    title: 'Trace enabled on failures',
    status: traceConfigured as any,
    severity: 'low',
    message: traceConfigured ? 'Configured' : 'Not configured',
    suggestion: 'Set `use: { trace: "retain-on-failure" }` or "on-first-retry".',
    artifacts: [pwConfigPath || ''],
  });

  addFinding(cat, {
    id: makeId('Screenshots on failure'),
    title: 'Screenshots on failure',
    status: screenshotConfigured as any,
    severity: 'info',
    message: screenshotConfigured ? 'Configured' : 'Not configured',
    suggestion: 'Set `use: { screenshot: "only-on-failure" }`.',
    artifacts: [pwConfigPath || ''],
  });

  addFinding(cat, {
    id: makeId('Video capture policy'),
    title: 'Video capture policy',
    status: videoConfigured as any,
    severity: 'info',
    message: videoConfigured ? 'Configured' : 'Not configured',
    suggestion: 'If helpful, set `video: "retain-on-failure"` and upload in CI.',
    artifacts: [pwConfigPath || ''],
  });

  // ✅ FIX: outputDir detection (key presence, not just literal)
  addFinding(cat, {
    id: makeId('Output directory set'),
    title: 'Output directory set',
    status: outputDirConfigured as any,
    severity: 'info',
    message: outputDirConfigured ? 'Configured' : 'Not configured',
    suggestion: 'Set top-level `outputDir` to a stable path to collect artifacts.',
    artifacts: [pwConfigPath || ''],
  });

  // In-test observability
  addFinding(cat, {
    id: makeId('Attachments in tests'),
    title: 'Attachments in tests',
    status: (attachFiles.size > 0) as any,
    severity: 'info',
    message:
      attachFiles.size > 0
        ? `Found attachments in ${attachFiles.size} file(s)`
        : 'No test.info().attach usage detected',
    suggestion:
      'Use `test.info().attach(name, { body, contentType })` to include logs, HARs, or snapshots in reports.',
    artifacts: pick(attachFiles),
  });

  addFinding(cat, {
    id: makeId('Structured steps in tests'),
    title: 'Structured steps in tests',
    status: (stepFiles.size > 0) as any,
    severity: 'info',
    message:
      stepFiles.size > 0
        ? `Found test.step in ${stepFiles.size} file(s)`
        : 'No test.step usage detected',
    suggestion:
      'Wrap logical actions in `await test.step("description", async () => { ... })` for clearer reports.',
    artifacts: pick(stepFiles),
  });

  // Final score
  cat.score = applyScore(cat.findings);
  return cat;
}

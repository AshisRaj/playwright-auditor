import path from 'path';
import { CategoryResult } from '../types.js';
import {
  applyScore,
  createCategory,
  exists,
  findConfig,
  findFiles,
  readFile,
  Sev,
} from '../utils/helpers.js';

const cat = createCategory('flakiness', 'Flakiness Risks');

async function safeRead(p?: string | null): Promise<string> {
  if (!p) return '';
  try {
    return await readFile(p);
  } catch {
    return '';
  }
}

export async function analyzeFlakiness(targetDir: string): Promise<CategoryResult> {
  // --- Load Playwright config (ts/js/mjs/cjs)
  const cfg = await findConfig(targetDir, [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ]);
  const cfgText = await safeRead(cfg);

  // --- Gather test files (sampled) for anti-pattern scan
  const testFiles = await findFiles(targetDir, [
    '**/*.spec.{ts,tsx,js,jsx}',
    '**/*.test.{ts,tsx,js,jsx}',
    'tests/**/*.{ts,tsx,js,jsx}',
    'e2e/**/*.{ts,tsx,js,jsx}',
    'specs/**/*.{ts,tsx,js,jsx}',
  ]);
  const sample = testFiles.slice(0, 50);
  const sampleTexts = await Promise.all(sample.map(safeRead));
  const anyTestMatches = (re: RegExp) => sampleTexts.some((t) => re.test(t));
  const offenders = (re: RegExp) =>
    sample.filter((f, i) => re.test(sampleTexts[i] || '')).slice(0, 10);

  // --- Extract numbers / simple values from config text
  const matchNum = (re: RegExp) => {
    const m = cfgText.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const pickString = (re: RegExp) => (cfgText.match(re) || [])[1];

  const retriesConfigured =
    /(?:^|[,{]\s*)["']?\s*retries\s*["']?\s*:\s*(\d+)/i.test(cfgText) ||
    /retries\s*:\s*process\.env\.CI\s*\?\s*\d+\s*:\s*\d+/i.test(cfgText);
  const retriesNum = matchNum(/retries\s*:\s*(\d{1,3})/i);

  const testTimeout = matchNum(/[^A-Za-z]timeout\s*:\s*(\d{2,7})/i);
  const actionTimeout = matchNum(/actionTimeout\s*:\s*(\d{2,7})/i);
  const navigationTimeout = matchNum(/navigationTimeout\s*:\s*(\d{2,7})/i);
  const expectTimeout = matchNum(/expect\s*:\s*{[^}]*timeout\s*:\s*(\d{2,7})/i);

  const tracePolicy = pickString(/trace\s*:\s*['"`]([^'"`]+)['"`]/i);
  const screenshotPolicy = pickString(/screenshot\s*:\s*['"`]([^'"`]+)['"`]/i);
  const videoPolicy = pickString(/video\s*:\s*['"`]([^'"`]+)['"`]/i);

  const forbidOnlyConfigured =
    /forbidOnly\s*:\s*(true|process\.env\.CI)/i.test(cfgText) ||
    /process\.env\.CI\s*\?\s*[^:]*forbidOnly\s*:\s*true/i.test(cfgText);

  const fullyParallelTrue = /fullyParallel\s*:\s*true/i.test(cfgText);
  const workersNum = matchNum(/workers\s*:\s*(\d{1,3})/i);

  // --- HTML report (folder existence + CI artifact upload check)
  const htmlReportDir = path.join(targetDir, 'playwright-report');
  const htmlReportIndex = path.join(htmlReportDir, 'index.html');
  const htmlReportExists = (await exists(htmlReportDir)) || (await exists(htmlReportIndex));

  const workflowFiles = await findFiles(targetDir, [
    '.github/workflows/**/*.yml',
    '.github/workflows/**/*.yaml',
  ]);
  const workflowTexts = await Promise.all(workflowFiles.map(safeRead));
  const uploadsHtmlReport = workflowTexts.some(
    (t) => /actions\/upload-artifact/i.test(t) && /playwright-report/i.test(t),
  );

  // --- Build rules (keep your structure)
  const rules: Array<{
    id: string;
    title: string;
    sev: Sev;
    pass: boolean;
    msgPass: string;
    msgFail: string;
    suggestion?: string;
    file?: string;
  }> = [
    {
      id: 'retries',
      title: 'Retries >= 1',
      sev: 'low',
      pass: retriesConfigured && (retriesNum === undefined || retriesNum >= 1),
      msgPass: 'Retries configured',
      msgFail: 'No retries configured (or set to 0)',
      suggestion: 'Set retries: 1 (CI can be 2–3) to reduce flake impact.',
      file: cfg || '',
    },
    {
      id: 'forbid-only',
      title: 'forbidOnly enabled (CI safety)',
      sev: 'medium',
      pass: forbidOnlyConfigured,
      msgPass: 'forbidOnly is enabled',
      msgFail: 'forbidOnly not enabled',
      suggestion: 'Add `forbidOnly: !!process.env.CI` in Playwright config.',
      file: cfg || '',
    },
    {
      id: 'timeout-per-test',
      title: 'Reasonable per-test timeout (≤60s)',
      sev: 'low',
      pass: testTimeout === undefined || testTimeout <= 60_000,
      msgPass: 'Per-test timeout ≤ 60s (or default)',
      msgFail: `Per-test timeout too high (${testTimeout}ms)`,
      suggestion: 'Keep per-test timeout ≤ 60s; use targeted waits for slow parts.',
      file: cfg || '',
    },
    {
      id: 'timeout-action',
      title: 'Reasonable actionTimeout (≤30s)',
      sev: 'low',
      pass: actionTimeout === undefined || actionTimeout <= 30_000,
      msgPass: 'actionTimeout ≤ 30s (or default)',
      msgFail: `actionTimeout too high (${actionTimeout}ms)`,
      suggestion: 'Keep actionTimeout ≤ 30s to fail fast on stuck UI actions.',
      file: cfg || '',
    },
    {
      id: 'timeout-navigation',
      title: 'Reasonable navigationTimeout (≤30s)',
      sev: 'low',
      pass: navigationTimeout === undefined || navigationTimeout <= 30_000,
      msgPass: 'navigationTimeout ≤ 30s (or default)',
      msgFail: `navigationTimeout too high (${navigationTimeout}ms)`,
      suggestion: 'Keep navigationTimeout ≤ 30s; prefer route mocking for slow externals.',
      file: cfg || '',
    },
    {
      id: 'timeout-expect',
      title: 'expect timeout (≤10s)',
      sev: 'low',
      pass: expectTimeout === undefined || expectTimeout <= 10_000,
      msgPass: 'expect timeout ≤ 10s (or default)',
      msgFail: `expect timeout too high (${expectTimeout}ms)`,
      suggestion: 'Use `expect: { timeout: 5_000–10_000 }` and soft expects sparingly.',
      file: cfg || '',
    },
    {
      id: 'trace-policy',
      title: 'Trace on retain-on-failure',
      sev: 'low',
      pass: tracePolicy ? /retain-on-failure|on-first-retry|on/i.test(tracePolicy) : true,
      msgPass: tracePolicy ? `trace: "${tracePolicy}"` : 'Trace not explicitly set',
      msgFail: `trace policy suboptimal: "${tracePolicy}"`,
      suggestion: 'Use `trace: "retain-on-failure"` (or "on-first-retry") to speed up flake debug.',
      file: cfg || '',
    },
    {
      id: 'screenshot-policy',
      title: 'Screenshot only on failure',
      sev: 'info',
      pass: screenshotPolicy ? /only-on-failure/i.test(screenshotPolicy) : true,
      msgPass: screenshotPolicy
        ? `screenshot: "${screenshotPolicy}"`
        : 'Screenshot not explicitly set',
      msgFail: `screenshot policy suboptimal: "${screenshotPolicy}"`,
      suggestion: 'Use `screenshot: "only-on-failure"` to keep CI lean but helpful.',
      file: cfg || '',
    },
    {
      id: 'video-policy',
      title: 'Video retain on failure (or off)',
      sev: 'info',
      pass: videoPolicy ? /(retain-on-failure|off)/i.test(videoPolicy) : true,
      msgPass: videoPolicy ? `video: "${videoPolicy}"` : 'Video not explicitly set',
      msgFail: `video policy suboptimal: "${videoPolicy}"`,
      suggestion: 'Prefer `video: "retain-on-failure"` (or `off` if traces are enough).',
      file: cfg || '',
    },
    {
      id: 'fully-parallel',
      title: 'Fully-parallel usage awareness',
      sev: fullyParallelTrue ? 'info' : 'low',
      pass: true,
      msgPass: fullyParallelTrue
        ? 'fullyParallel enabled; ensure tests are stateless and isolated.'
        : 'fullyParallel not enabled (fine unless needed).',
      msgFail: '',
      suggestion: fullyParallelTrue
        ? 'If you see heisenbugs, try per-file parallelism or mark stateful suites serial.'
        : undefined,
      file: cfg || '',
    },
    {
      id: 'workers',
      title: 'Sane workers count',
      sev: 'info',
      pass: workersNum === undefined || workersNum > 0,
      msgPass: workersNum ? `workers: ${workersNum}` : 'workers not explicitly set',
      msgFail: 'workers set to 0',
      suggestion: 'Use a modest workers value in CI (e.g., 2–4) for stability.',
      file: cfg || '',
    },
    // ---- Anti-patterns in tests (artifact list implied by title; keep structure unchanged)
    {
      id: 'no-waitForTimeout',
      title: 'Avoid waitForTimeout sleeps',
      sev: 'high',
      pass: !anyTestMatches(/\bwaitForTimeout\s*\(/),
      msgPass: 'No waitForTimeout() found in sampled tests',
      msgFail: 'waitForTimeout() used in tests (flaky sleeps)',
      suggestion:
        'Replace sleeps with explicit waits, e.g., `await expect(locator).toBeVisible()`.',
      file: offenders(/\bwaitForTimeout\s*\(/)[0] || sample[0] || '',
    },
    {
      id: 'networkidle',
      title: 'Avoid networkidle waits on dynamic apps',
      sev: 'medium',
      pass: !anyTestMatches(/waitForLoadState\s*\(\s*['"`]networkidle['"`]\s*\)/),
      msgPass: 'No networkidle waits detected in sampled tests',
      msgFail: 'waitForLoadState("networkidle") detected',
      suggestion: 'Prefer specific UI/route signals over networkidle on long-polling apps.',
      file: offenders(/waitForLoadState\s*\(\s*['"`]networkidle['"`]\s*\)/)[0] || sample[0] || '',
    },
    {
      id: 'serial-mode',
      title: 'Avoid broad serial mode',
      sev: 'medium',
      pass: !anyTestMatches(/describe\.configure\(\s*{[^}]*mode\s*:\s*['"`]serial['"`]\s*}\s*\)/),
      msgPass: 'No broad serial mode detected in sampled tests',
      msgFail: 'test.describe.configure({ mode: "serial" }) detected',
      suggestion: 'Limit serial mode to truly stateful suites; prefer setup/teardown.',
      file:
        offenders(/describe\.configure\(\s*{[^}]*mode\s*:\s*['"`]serial['"`]/)[0] ||
        sample[0] ||
        '',
    },
    // ---- HTML report persisted (folder + CI upload artifact)
    {
      id: 'html-report',
      title: 'HTML report persisted',
      pass: htmlReportExists && uploadsHtmlReport,
      sev: 'low',
      msgPass: 'HTML report folder is uploaded',
      msgFail: 'HTML report not uploaded as artifact',
      suggestion:
        'Upload `playwright-report` (or your HTML report path) as an artifact via actions/upload-artifact.',
      file: htmlReportExists ? htmlReportIndex : workflowFiles[0] || cfg || '',
    },
  ];

  // Push into category with your original pattern
  for (const r of rules) {
    cat.findings.push({
      id: `flk-${r.id}`,
      title: r.title,
      message: r.pass ? r.msgPass : r.msgFail,
      severity: r.sev,
      status: r.pass ? 'pass' : 'fail',
      suggestion: r.suggestion,
      file: r.file || '',
    });
  }

  cat.score = applyScore(cat.findings);
  return cat;
}

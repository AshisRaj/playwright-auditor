import { promises as fs } from 'fs';
import path from 'path';
import { CategoryResult } from '../types.js';
import { addFinding, applyScore, createCategory, makeId, Sev, walk } from '../utils/helpers.js';

const cat = createCategory('tests', 'Test Quality');

// small safe reader
async function readSafe(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

export async function analyzeTestsQuality(targetDir: string): Promise<CategoryResult> {
  const roots = ['tests', 'e2e', 'test', '__tests__', 'src/tests', 'src'].map((r) =>
    path.join(targetDir, r),
  );

  // discover test files
  let testFiles: string[] = [];
  for (const r of roots) {
    const stat = await fs.stat(r).catch(() => null);
    if (!stat) continue;
    const walked = await walk(r);
    testFiles = testFiles.concat(walked.filter((f) => /\.(spec|test)\.(t|j)sx?$/.test(f)));
  }

  const hasAny = testFiles.length > 0;
  addFinding(cat, {
    id: makeId('Tests exist'),
    title: 'Tests exist',
    status: hasAny as any,
    severity: hasAny ? 'low' : ('critical' as Sev),
    message: hasAny ? `Found ${testFiles.length} test file(s)` : 'No test files found',
    artifacts: hasAny ? testFiles.slice(0, 10) : [],
  });

  if (!hasAny) {
    cat.score = applyScore(cat.findings);
    return cat;
  }

  // scan content
  const LIMIT = 500;
  const take = testFiles.slice(0, LIMIT);

  // evidence buckets (sets of files)
  const usesDescribe = new Set<string>();
  const usesStep = new Set<string>();
  const usesSoft = new Set<string>();
  const usesFixtures = new Set<string>(); // test.use/test.extend/base.extend
  const usesAwait = new Set<string>();
  const antiWaitForTimeout = new Set<string>();
  const pageWaitForSelector = new Set<string>(); // prefer locator assertions
  const testOnly = new Set<string>();
  const describeOnly = new Set<string>();
  const testSkip = new Set<string>();
  const testFixme = new Set<string>();
  const snapshotFiles = new Set<string>(); // expect(page).toHaveScreenshot / toMatchSnapshot
  const parallelDescribe = new Set<string>(); // test.describe.configure({ mode: 'parallel' })
  const networkMocking = new Set<string>(); // page.route/context.route
  const explicitTimeouts = new Set<string>(); // test.setTimeout(...), test.slow()

  // regexes
  const reDescribe = /\btest\.describe\s*\(/;
  const reStep = /\btest\.step\s*\(/;
  const reSoft = /\bexpect\.soft\s*\(/;
  const reFixtures = /\btest\.(?:use|extend)\s*\(|\bbase\.extend\s*\(/;
  const reAwait = /\bawait\s+/;
  const reWaitForTimeout = /\bwaitForTimeout\s*\(/;
  const rePageWaitForSelector = /\b(?:page|frame|frameLocator)\.waitForSelector\s*\(/;
  const reTestOnly = /\btest\.only\s*\(/;
  const reDescribeOnly = /\b(?:test\.)?describe\.only\s*\(/;
  const reTestSkip = /\btest\.skip\s*\(/;
  const reTestFixme = /\btest\.fixme\s*\(/;
  const reScreenshot = /\btoHaveScreenshot\s*\(|\btoMatchSnapshot\s*\(/;
  const reParallelDescribe =
    /\btest\.describe\.configure\s*\(\s*{[^}]*\bmode\s*:\s*['"]parallel['"]/;
  const reRoute = /\b(?:page|context|browserContext)\.route\s*\(/i;
  const reExplicitTimeouts = /\btest\.(?:setTimeout|slow)\s*\(/;

  for (const f of take) {
    const s = await readSafe(f);
    if (!s) continue;

    if (reDescribe.test(s)) usesDescribe.add(f);
    if (reStep.test(s)) usesStep.add(f);
    if (reSoft.test(s)) usesSoft.add(f);
    if (reFixtures.test(s)) usesFixtures.add(f);
    if (reAwait.test(s)) usesAwait.add(f);
    if (reWaitForTimeout.test(s)) antiWaitForTimeout.add(f);
    if (rePageWaitForSelector.test(s)) pageWaitForSelector.add(f);
    if (reTestOnly.test(s)) testOnly.add(f);
    if (reDescribeOnly.test(s)) describeOnly.add(f);
    if (reTestSkip.test(s)) testSkip.add(f);
    if (reTestFixme.test(s)) testFixme.add(f);
    if (reScreenshot.test(s)) snapshotFiles.add(f);
    if (reParallelDescribe.test(s)) parallelDescribe.add(f);
    if (reRoute.test(s)) networkMocking.add(f);
    if (reExplicitTimeouts.test(s)) explicitTimeouts.add(f);
  }

  const pick = (set: Set<string>, n = 10) => Array.from(set).slice(0, n);

  // 1) Readable assertions & structure (describe/step)
  {
    const ok = usesDescribe.size + usesStep.size > 0;
    addFinding(cat, {
      id: makeId('Readable structure (describe/step)'),
      title: 'Readable structure (describe/step)',
      status: ok as any,
      severity: 'medium',
      message: ok
        ? `Found structure helpers in ${usesDescribe.size + usesStep.size} file(s)`
        : 'No test.describe/test.step usage detected',
      suggestion: 'Use test.describe/test.step to group and narrate test flows.',
      artifacts: pick(new Set([...usesDescribe, ...usesStep])),
    });
  }

  // 2) Soft assertions
  {
    const ok = usesSoft.size > 0;
    addFinding(cat, {
      id: makeId('Soft assertions when appropriate'),
      title: 'Soft assertions when appropriate',
      status: ok as any,
      severity: 'info',
      message: ok
        ? `expect.soft used in ${usesSoft.size} file(s)`
        : 'No expect.soft usage detected',
      suggestion: 'Use expect.soft for non-critical checks so the test collects multiple failures.',
      artifacts: pick(usesSoft),
    });
  }

  // 3) Fixtures / test.use present
  {
    const ok = usesFixtures.size > 0;
    addFinding(cat, {
      id: makeId('Custom fixtures or test.use present'),
      title: 'Custom fixtures or test.use present',
      status: ok as any,
      severity: 'medium',
      message: ok
        ? `Found fixtures/test.use in ${usesFixtures.size} file(s)`
        : 'No fixtures/test.use detected',
      suggestion: 'Use test.extend/test.use to share setup, context, and per-test options.',
      artifacts: pick(usesFixtures),
    });
  }

  // 4) Avoid waitForTimeout anti-pattern
  {
    const ok = antiWaitForTimeout.size === 0;
    addFinding(cat, {
      id: makeId('Avoid waitForTimeout anti-pattern'),
      title: 'Avoid waitForTimeout anti-pattern',
      status: ok as any,
      severity: 'high',
      message: ok
        ? 'No waitForTimeout usage found'
        : `waitForTimeout detected in ${antiWaitForTimeout.size} file(s)`,
      suggestion:
        'Replace waitForTimeout with locator assertions (e.g., await expect(locator).toBeVisible()).',
      artifacts: pick(antiWaitForTimeout),
    });
  }

  // 5) Prefer locator assertions over page.waitForSelector
  {
    const ok = pageWaitForSelector.size === 0;
    addFinding(cat, {
      id: makeId('Prefer locator assertions over waitForSelector'),
      title: 'Prefer locator assertions over waitForSelector',
      status: ok as any,
      severity: 'low',
      message: ok
        ? 'No page.waitForSelector usage found'
        : `page.waitForSelector used in ${pageWaitForSelector.size} file(s)`,
      suggestion:
        'Prefer await expect(locator).toBeVisible()/toHaveText() etc. Locator assertions auto-wait and are more resilient.',
      artifacts: pick(pageWaitForSelector),
    });
  }

  // 6) Guard against focused tests (test.only / describe.only)
  {
    const offenders = new Set([...testOnly, ...describeOnly]);
    const ok = offenders.size === 0;
    addFinding(cat, {
      id: makeId('No focused tests committed'),
      title: 'No focused tests committed',
      status: ok as any,
      severity: 'critical',
      message: ok
        ? 'No .only usage detected'
        : `.only found in ${offenders.size} file(s) — remove before committing`,
      suggestion:
        'Delete .only before pushing; enforce via a pre-commit/CI grep to block focused tests.',
      artifacts: pick(offenders),
    });
  }

  // 7) Skips / fixme usage check (informational; too many may hide issues)
  {
    const totalSkips = testSkip.size + testFixme.size;
    const ok = totalSkips === 0 || totalSkips < Math.max(3, Math.ceil(testFiles.length * 0.05));
    addFinding(cat, {
      id: makeId('Reasonable use of skip/fixme'),
      title: 'Reasonable use of skip/fixme',
      status: ok as any,
      severity: 'info',
      message:
        totalSkips === 0
          ? 'No test.skip/fixme usage detected'
          : `Found ${totalSkips} occurrence(s) of skip/fixme`,
      suggestion:
        'Keep skip/fixme temporary; track issues and remove regularly to avoid masking failures.',
      artifacts: pick(new Set([...testSkip, ...testFixme])),
    });
  }

  // 8) Snapshot usage present (positive signal for UI stability)
  {
    const ok = snapshotFiles.size > 0;
    addFinding(cat, {
      id: makeId('Snapshot/visual assertions'),
      title: 'Snapshot/visual assertions',
      status: ok as any,
      severity: 'info',
      message: ok
        ? `Found snapshot/visual assertions in ${snapshotFiles.size} file(s)`
        : 'No snapshot/visual assertions detected',
      suggestion:
        'Use toHaveScreenshot()/toMatchSnapshot() for regressions where DOM/text checks are insufficient.',
      artifacts: pick(snapshotFiles),
    });
  }

  // 9) Parallelization hints
  {
    const ok = parallelDescribe.size > 0;
    addFinding(cat, {
      id: makeId('Suite-level parallelization used'),
      title: 'Suite-level parallelization used',
      status: ok as any,
      severity: 'info',
      message: ok
        ? `test.describe.configure({ mode: "parallel" }) found in ${parallelDescribe.size} file(s)`
        : 'No explicit suite-level parallelization detected',
      suggestion:
        'Consider parallel mode for independent suites to reduce runtime; ensure test isolation first.',
      artifacts: pick(parallelDescribe),
    });
  }

  // 10) Network mocking present in tests (route usage)
  {
    const ok = networkMocking.size > 0;
    addFinding(cat, {
      id: makeId('Network mocking used where appropriate'),
      title: 'Network mocking used where appropriate',
      status: ok as any,
      severity: 'info',
      message: ok
        ? `Found route() usage in ${networkMocking.size} file(s)`
        : 'No route() usage detected in tests',
      suggestion:
        'Mock network for flaky/slow dependencies to make tests deterministic; prefer page.route for per-test scope.',
      artifacts: pick(networkMocking),
    });
  }

  // 11) Explicit timeouts/slow markers (reasonable use)
  {
    const ok =
      explicitTimeouts.size === 0 ||
      explicitTimeouts.size < Math.max(3, Math.ceil(testFiles.length * 0.05));
    addFinding(cat, {
      id: makeId('Explicit test timeouts kept minimal'),
      title: 'Explicit test timeouts kept minimal',
      status: ok as any,
      severity: 'low',
      message:
        explicitTimeouts.size === 0
          ? 'No test.setTimeout/test.slow detected'
          : `Explicit timeouts/slow in ${explicitTimeouts.size} file(s)`,
      suggestion:
        'Use explicit timeouts sparingly; fix root causes instead. If needed, annotate justification in code review.',
      artifacts: pick(explicitTimeouts),
    });
  }

  // Final score
  cat.score = applyScore(cat.findings);
  return cat;
}

import { CategoryResult } from '../types.js';
import {
  applyScore,
  collectCiConfigs,
  createCategory,
  firstFileMatching,
  Sev,
} from '../utils/helpers.js';

const cat = createCategory('cicd', 'CI/CD Integration');

export async function analyzeCICDIntegration(targetDir: string): Promise<CategoryResult> {
  const scan = await collectCiConfigs(targetDir);

  // ---- Signals (GH + GL) ----
  const hasPipeline = scan.hasGH || scan.hasGL;

  // Playwright install / browsers & system deps (linux)
  const playwrightInstallRe = /\bnpx\s+playwright\s+install(?:\s+--with-deps|\s+--all)?\b/i;
  const playwrightInstallFile = firstFileMatching(scan, playwrightInstallRe);
  const playwrightInstallPass = !!playwrightInstallFile;

  // Node setup (GH actions/setup-node) + caching; GitLab cache key stanza
  const setupNodeFile = firstFileMatching(scan, /\buses\s*:\s*actions\/setup-node@/i);
  const nodeCacheFile = firstFileMatching(
    scan,
    /\b(cache\s*:\s*['"](npm|yarn|pnpm)['"]|actions\/cache@)/i,
  );
  const glCacheFile = firstFileMatching(scan, /\bcache\s*:\s*[\s\S]*?\bkey\s*:/i);
  const cachePass = !!nodeCacheFile || !!glCacheFile;

  // Artifacts (reports/traces/screenshots) + retention-days (GH) / expire_in (GL)
  const uploadArtifactFile = firstFileMatching(
    scan,
    /\b(upload-artifact|store_artifacts|artifacts\s*:)/i,
  );
  const artifactRetentionFile = firstFileMatching(
    scan,
    /\b(retention-days\s*:\s*\d+|artifacts\s*:[\s\S]*?\bexpire_in\s*:)/i,
  );
  const artifactsPass = !!uploadArtifactFile;
  const artifactRetentionPass = !!artifactRetentionFile;

  // Parallelism/matrix & sharding
  const matrixFile = firstFileMatching(scan, /\bstrategy\s*:\s*[\s\S]*?\bmatrix\s*:/i);
  const gitlabParallelFile = firstFileMatching(scan, /\bparallel\s*:\s*\d+/i);
  const parallelPass = !!matrixFile || !!gitlabParallelFile;

  const shardInCmdFile = firstFileMatching(
    scan,
    /\bnpx\s+playwright\s+test\b[^\n]*--shard\s*=\s*\S+/i,
  );
  const shardInYamlFile = firstFileMatching(scan, /\bshard\s*:\s*["']?\d+\/\d+["']?/i);
  const shardingPass = !!shardInCmdFile || !!shardInYamlFile;

  // Retries: Playwright CLI --retries X, or GitLab job retry:
  const retriesCliFile = firstFileMatching(scan, /\b(--retries\s+\d+)\b/i);
  const retriesGitlabFile = firstFileMatching(scan, /\bretry\s*:\s*\d+\b/i);
  const retriesPass = !!retriesCliFile || !!retriesGitlabFile;

  // Pull Request / Merge Request triggers
  const ghPrTriggerFile = firstFileMatching(scan, /\bon\s*:\s*[\s\S]*\bpull_request\b/i);
  const glMrTriggerFile = firstFileMatching(
    scan,
    /\bonly\s*:\s*\[?\s*merge_requests\s*\]?|rules\s*:\s*[\s\S]*\$CI_MERGE_REQUEST_IID/i,
  );
  const prMrPass = !!ghPrTriggerFile || !!glMrTriggerFile;

  // Coverage upload (Codecov) or lcov upload step
  const coverageFile = firstFileMatching(
    scan,
    /\b(codecov\/codecov-action@|bash\s*<\(\s*curl.*codecov\.io|lcov|coverage\/lcov\.info)\b/i,
  );
  const coveragePass = !!coverageFile;

  // GH concurrency cancel-in-progress
  const concurrencyFile = firstFileMatching(
    scan,
    /\bconcurrency\s*:\s*[\s\S]*\bcancel-in-progress\s*:\s*(true|yes)/i,
  );
  const concurrencyPass = !!concurrencyFile;

  // xvfb/headless setup (Linux jobs often need this for video/screenshots)
  const xvfbFile = firstFileMatching(
    scan,
    /\bxvfb-run\b|xvfb\s+start|uses\s*:\s*GabrielBB\/xvfb-action@/i,
  );
  const xvfbPass = !!xvfbFile || !!playwrightInstallFile; // --with-deps often sufficient on Ubuntu

  // HTML report / traces folders explicitly uploaded
  const htmlReportFile = firstFileMatching(
    scan,
    /(playwright-report|html-report)[/'"]?\b.*\b(upload-artifact|store_artifacts|artifacts\s*:)/i,
  );
  const tracesFile = firstFileMatching(
    scan,
    /(trace|traces|test-results)[/'"]?\b.*\b(upload-artifact|store_artifacts|artifacts\s*:)/i,
  );
  const htmlReportPass = !!htmlReportFile;
  const tracesPass = !!tracesFile;

  // ---- Checks list ----
  const checks: Array<{
    id: string;
    title: string;
    pass: boolean;
    sev: Sev;
    msgPass: string;
    msgFail: string;
    suggestion?: string;
    file?: string;
  }> = [
    {
      id: 'pipeline-ready',
      title: 'Pipeline ready',
      pass: hasPipeline,
      sev: 'high',
      msgPass: 'GitHub Actions or GitLab CI detected',
      msgFail: 'No CI config found',
      suggestion: 'Add GitHub Actions under .github/workflows/ or a .gitlab-ci.yml file',
      file: scan.files[0] || '',
    },
    {
      id: 'playwright-install',
      title: 'Playwright install in CI',
      pass: playwrightInstallPass,
      sev: 'high',
      msgPass: '`npx playwright install` present',
      msgFail: 'Playwright browsers/deps not installed in CI',
      suggestion: 'Add a step: `npx playwright install --with-deps` (Linux) before running tests',
      file: playwrightInstallFile || scan.files[0] || '',
    },
    {
      id: 'node-setup',
      title: 'Node setup (version & cache)',
      pass: !!setupNodeFile && cachePass,
      sev: 'low',
      msgPass: 'actions/setup-node with dependency cache (or GitLab cache) detected',
      msgFail: 'Node setup and/or dependency cache not configured',
      suggestion:
        'Use actions/setup-node with `cache: npm|yarn|pnpm` or GitLab `cache:` with a key to speed up installs',
      file: setupNodeFile || nodeCacheFile || glCacheFile || scan.files[0] || '',
    },
    {
      id: 'cache',
      title: 'Dependency cache enabled',
      pass: cachePass,
      sev: 'low',
      msgPass: 'Cache configured',
      msgFail: 'No cache detected',
      suggestion:
        'Enable actions/cache (GH) or the `cache:` key (GL) to cache node_modules or package managers',
      file: nodeCacheFile || glCacheFile || scan.files[0] || '',
    },
    {
      id: 'artifacts',
      title: 'Test report storage/archiving',
      pass: artifactsPass,
      sev: 'low',
      msgPass: 'Artifacts upload configured',
      msgFail: 'Artifacts upload missing',
      suggestion: 'Upload HTML report, traces, screenshots as CI artifacts for debugging',
      file: uploadArtifactFile || scan.files[0] || '',
    },
    {
      id: 'artifact-retention',
      title: 'Artifacts retention set',
      pass: artifactRetentionPass,
      sev: 'info',
      msgPass: 'Artifacts retention configured',
      msgFail: 'No retention/expire policy found for artifacts',
      suggestion: 'Set `retention-days:` (GH) or `expire_in:` (GL) to control artifact lifecycle',
      file: artifactRetentionFile || scan.files[0] || '',
    },
    {
      id: 'parallel',
      title: 'Parallel/sharding configured',
      pass: parallelPass || shardingPass,
      sev: 'info',
      msgPass: 'Parallelism (matrix/parallel) or sharding configured',
      msgFail: 'No parallelism/sharding found',
      suggestion: 'Use matrix/parallel (GH/GL) or `--shard=N/M` for faster CI runs',
      file:
        matrixFile ||
        gitlabParallelFile ||
        shardInCmdFile ||
        shardInYamlFile ||
        scan.files[0] ||
        '',
    },
    {
      id: 'retries',
      title: 'Retries enabled in CI',
      pass: retriesPass,
      sev: 'low',
      msgPass: 'Retries configured for CI runs',
      msgFail: 'No retries found in CI job',
      suggestion: 'Pass `--retries 2` to `npx playwright test` or use `retry:` in GitLab',
      file: retriesCliFile || retriesGitlabFile || scan.files[0] || '',
    },
    {
      id: 'pr-mr',
      title: 'PR/MR triggers',
      pass: prMrPass,
      sev: 'medium',
      msgPass: 'CI is triggered on PRs/MRs',
      msgFail: 'No PR/MR trigger found',
      suggestion: 'GitHub: add `on: pull_request`. GitLab: use `only: [merge_requests]` or rules.',
      file: ghPrTriggerFile || glMrTriggerFile || scan.files[0] || '',
    },
    {
      id: 'coverage',
      title: 'Coverage uploaded/published',
      pass: coveragePass,
      sev: 'info',
      msgPass: 'Coverage upload step found (Codecov/LCOV)',
      msgFail: 'No coverage publish step found',
      suggestion: 'Upload LCOV to Codecov or persist coverage artifacts for trend tracking',
      file: coverageFile || scan.files[0] || '',
    },
    {
      id: 'concurrency',
      title: 'Cancel in-progress runs (GH)',
      pass: concurrencyPass || !scan.hasGH, // not applicable on GL
      sev: 'info',
      msgPass: 'Concurrency cancellation configured',
      msgFail: 'Consider cancelling in-progress runs on new commits',
      suggestion: 'Add `concurrency: { group: ${{ github.ref }}, cancel-in-progress: true }`',
      file: concurrencyFile || scan.files[0] || '',
    },
    {
      id: 'xvfb',
      title: 'Headless display (xvfb) / system deps',
      pass: xvfbPass,
      sev: 'low',
      msgPass: 'xvfb or system deps configured for browsers',
      msgFail: 'No xvfb/system deps step found (may be required on Linux runners)',
      suggestion:
        'Use `npx playwright install --with-deps` and/or run tests under `xvfb-run` on Linux runners',
      file: xvfbFile || playwrightInstallFile || scan.files[0] || '',
    },
    {
      id: 'html-report',
      title: 'HTML report persisted',
      pass: htmlReportPass,
      sev: 'low',
      msgPass: 'HTML report folder is uploaded',
      msgFail: 'HTML report not uploaded as artifact',
      suggestion: 'Upload `playwright-report` (or your HTML report path) as an artifact',
      file: htmlReportFile || scan.files[0] || '',
    },
    {
      id: 'traces',
      title: 'Traces/screenshots persisted',
      pass: tracesPass,
      sev: 'low',
      msgPass: 'Traces/screenshots folder is uploaded',
      msgFail: 'Traces/screenshots not uploaded as artifact',
      suggestion: 'Upload `test-results`, `traces`, or screenshots folder as an artifact',
      file: tracesFile || scan.files[0] || '',
    },
  ];

  // Emit findings
  for (const c of checks) {
    cat.findings.push({
      id: 'cicd-' + c.id,
      title: c.title,
      message: c.pass ? c.msgPass : c.msgFail,
      severity: c.sev,
      status: c.pass ? 'pass' : 'fail',
      suggestion: c.suggestion,
      file: c.file || '',
    });
  }

  cat.score = applyScore(cat.findings);
  return cat;
}

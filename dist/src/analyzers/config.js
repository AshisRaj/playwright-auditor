import path from 'path';
import { applyScore, createCategory, findConfig, ok, readFile } from '../utils/helpers.js';
const cat = createCategory('config', 'Config');
export async function analyzeConfig(targetDir) {
    // Locate a Playwright config file (ts/js/mjs/cjs)
    const cfgPath = await findConfig(targetDir, [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ]);
    const present = !!cfgPath;
    cat.findings.push({
        id: 'cfg-present',
        title: 'Playwright config present',
        message: present ? `Found ${path.basename(cfgPath)}` : 'No playwright.config.* found',
        severity: present ? 'low' : 'critical',
        status: present ? 'pass' : 'fail',
        file: cfgPath || '',
    });
    const text = cfgPath ? await readFile(cfgPath) : '';
    // Regex helpers (tolerant about spaces/quotes and allow object keys without quotes)
    const re = {
        // use: {...}
        useBlock: /\buse\s*:\s*\{/i,
        // trace: "retain-on-failure" | "on" | "on-first-retry"
        traceGood: /\btrace\s*:\s*["']?(?:retain-on-failure|on-first-retry|on)["']?/i,
        traceAny: /\btrace\s*:/i,
        // screenshot: "only-on-failure" | "on"
        screenshotGood: /\bscreenshot\s*:\s*["']?(?:only-on-failure|on)["']?/i,
        screenshotAny: /\bscreenshot\s*:/i,
        // retries: number >=1 OR ternary (e.g., process.env.CI ? 2 : 1)
        // Accept both dot and bracket access on process.env (process.env.CI or process.env['CI'])
        retriesGood: /\bretries\s*:\s*(?!0\b)(\d+|process\.env(?:\.[A-Za-z_]\w*|\[['"]\w+['"]\])\s*\?\s*\d+\s*:\s*\d+)/i,
        retriesAny: /\bretries\s*:/i,
        // workers: number >=1 OR ternary (e.g., process.env.CI ? 1 : 0|1)
        // Accept both dot and bracket access on process.env
        workersGood: /\bworkers\s*:\s*(?!0\b)(\d+|process\.env(?:\.[A-Za-z_]\w*|\[['"]\w+['"]\])\s*\?\s*\d+\s*:\s*\d+)/i,
        workersAny: /\bworkers\s*:/i,
        headlessTrue: /\bheadless\s*:\s*true\b/i,
        projects: /\bprojects\s*:\s*\[/i,
        // reporters (html or junit)
        // reporters (html or junit). Accept both `reporter` and `reporters` keys,
        // and array/object forms like: reporter: [ ["html", {...}] ] or reporters: [...]
        reporterHtml: /\breporters?\s*:\s*(?:\[[\s\S]*?\b(?:"html"|'html'|\[\s*"html"|\[\s*'html')|\b(?:"html"|'html'))/i,
        reporterJunit: /\breporters?\s*:\s*(?:\[[\s\S]*?\b(?:junit|junit-reporter)|\b(?:junit|junit-reporter))/i,
        baseURLAny: /\bbaseURL\s*:/i,
        // video: warn if explicitly "off"
        videoAny: /\bvideo\s*:\s*["']?(on|off|on-first-retry|retain-on-failure)["']?/i,
        videoOff: /\bvideo\s*:\s*["']?off["']?/i,
        // expect: { timeout: N }
        expectTimeout: /\bexpect\s*:\s*\{\s*[^}]*\btimeout\s*:\s*(\d+)[^}]*\}/i,
        // top-level timeout (per-test)
        // We'll flag if > 60_000 ms (60s) as not ideal.
        topLevelTimeout: /\b[^.\n]*\btimeout\s*:\s*(\d+)\b/i,
        outputDirAny: /\boutputDir\s*:/i,
        webServer: /\bwebServer\s*:\s*\{/i,
        webServerReuse: /\breuseExistingServer\s*:\s*true\b/i,
    };
    // 1) use block presence
    const hasUse = ok(re.useBlock, text);
    // 2) trace
    const traceGood = ok(re.traceGood, text);
    const traceConfigured = ok(re.traceAny, text);
    // 3) screenshot
    const screenshotGood = ok(re.screenshotGood, text);
    const screenshotConfigured = ok(re.screenshotAny, text);
    // 4) retries
    const retriesGood = ok(re.retriesGood, text);
    const retriesConfigured = ok(re.retriesAny, text);
    // 5) workers
    const workersGood = ok(re.workersGood, text);
    const workersConfigured = ok(re.workersAny, text);
    // 6) headless
    const headlessTrue = ok(re.headlessTrue, text);
    // 7) projects present
    const hasProjects = ok(re.projects, text);
    // 8) reporters
    const hasHtmlReporter = ok(re.reporterHtml, text);
    const hasJunitReporter = ok(re.reporterJunit, text);
    // 9) baseURL
    const hasBaseURL = ok(re.baseURLAny, text);
    // 10) video
    const videoIsConfigured = ok(re.videoAny, text);
    const videoIsOff = ok(re.videoOff, text);
    // 11) expect.timeout
    const expectTimeoutConfigured = ok(re.expectTimeout, text);
    // 12) top-level timeout sanity
    let topTimeoutBad = false;
    const topTimeoutMatch = text.match(re.topLevelTimeout);
    if (topTimeoutMatch && topTimeoutMatch[1]) {
        const v = parseInt(topTimeoutMatch[1], 10);
        // Common best-practice: keep per-test timeout <= 60s
        topTimeoutBad = Number.isFinite(v) && v > 60000;
    }
    // 13) outputDir
    const hasOutputDir = ok(re.outputDirAny, text);
    // 14) webServer & reuseExistingServer
    const hasWebServer = ok(re.webServer, text);
    const webServerReuse = ok(re.webServerReuse, text);
    // Findings (messages tuned for clarity)
    const rules = [
        {
            id: 'use-block',
            title: 'use block present',
            sev: 'info',
            pass: hasUse,
            msgPass: '`use: { ... }` block present',
            msgFail: '`use` block is missing',
            suggestion: 'Add a `use: { ... }` section for trace/screenshot/video/baseURL defaults',
        },
        {
            id: 'trace',
            title: 'Tracing enabled/configured',
            sev: traceGood ? 'low' : 'medium',
            pass: traceGood,
            msgPass: 'Trace set to on/retain-on-failure/on-first-retry',
            msgFail: traceConfigured
                ? 'Trace configured, but not set to on/retain-on-failure/on-first-retry'
                : 'Tracing disabled/not configured',
            suggestion: 'Set `use: { trace: "retain-on-failure" }` for effective debugging',
        },
        {
            id: 'screenshot',
            title: 'Screenshot enabled/configured',
            sev: screenshotGood ? 'low' : 'high',
            pass: screenshotGood,
            msgPass: 'Screenshot set to only-on-failure/on',
            msgFail: screenshotConfigured
                ? 'Screenshot configured, but not set to only-on-failure/on'
                : 'Screenshot disabled/not configured',
            suggestion: 'Set `use: { screenshot: "only-on-failure" }`',
        },
        {
            id: 'retries',
            title: 'Retries >= 1',
            sev: 'low',
            pass: retriesGood,
            msgPass: 'Retries configured (>= 1 or CI ternary)',
            msgFail: retriesConfigured
                ? 'Retries configured but possibly invalid (0 or malformed)'
                : 'No retries configured',
            suggestion: 'Set `retries: 1` (or a CI ternary like `process.env.CI ? 2 : 1`)',
        },
        {
            id: 'workers',
            title: 'Workers configured',
            sev: 'info',
            pass: workersGood,
            msgPass: 'Workers set (>= 1 or CI ternary)',
            msgFail: workersConfigured
                ? 'Workers configured but value is 0'
                : 'Workers not explicitly configured',
            suggestion: 'Set `workers: process.env.CI ? 1 : 4` (adjust for your infra)',
        },
        {
            id: 'headless',
            title: 'Headless default true',
            sev: 'low',
            pass: headlessTrue,
            msgPass: 'Headless is true by default',
            msgFail: 'Headless not set to true by default',
            suggestion: 'Use `use: { headless: true }` to avoid GUI overhead in CI',
        },
        {
            id: 'projects',
            title: 'Parallel projects configured',
            sev: 'info',
            pass: hasProjects,
            msgPass: '`projects: [...]` present',
            msgFail: 'Projects not configured',
            suggestion: 'Use projects for browser matrix (Chromium/Firefox/WebKit) or device profiles',
        },
        {
            id: 'reporter-html',
            title: 'HTML reporter enabled',
            sev: 'low',
            pass: hasHtmlReporter,
            msgPass: 'HTML reporter found',
            msgFail: 'HTML reporter missing',
            suggestion: 'Add `reporter: [["list"], ["html", { open: "never" }]]` to persist interactive reports',
        },
        {
            id: 'reporter-junit',
            title: 'JUnit reporter (optional)',
            sev: 'info',
            pass: hasJunitReporter,
            msgPass: 'JUnit reporter found (for CI annotations)',
            msgFail: 'JUnit reporter not found',
            suggestion: 'Consider adding `["junit", { outputFile: "test-results/junit.xml" }]` for CI insights',
        },
        {
            id: 'baseurl',
            title: 'Base URL configured',
            sev: 'info',
            pass: hasBaseURL,
            msgPass: '`use.baseURL` present',
            msgFail: 'Base URL not configured',
            suggestion: 'Set `use: { baseURL: process.env.BASE_URL || "http://localhost:3000" }`',
        },
        {
            id: 'video',
            title: 'Video capture set',
            sev: videoIsConfigured && !videoIsOff ? 'info' : 'low',
            pass: videoIsConfigured && !videoIsOff,
            msgPass: 'Video capture enabled (not off)',
            msgFail: videoIsConfigured
                ? 'Video explicitly disabled (`video: "off"`)'
                : 'Video capture not configured',
            suggestion: 'Use `use: { video: "on-first-retry" }` to capture flaky tests',
        },
        {
            id: 'expect-timeout',
            title: 'expect.timeout configured',
            sev: 'info',
            pass: expectTimeoutConfigured,
            msgPass: '`expect: { timeout: ... }` present',
            msgFail: 'expect.timeout not configured',
            suggestion: 'Set `expect: { timeout: 10000 }` to control default assertion timeout per expect()',
        },
        {
            id: 'timeout-sane',
            title: 'Per-test timeout sane (≤ 60s)',
            sev: topTimeoutBad ? 'low' : 'info',
            pass: !topTimeoutBad,
            msgPass: 'Per-test timeout ≤ 60s (or unspecified)',
            msgFail: 'Per-test timeout appears > 60s; consider reducing',
            suggestion: 'Prefer explicit waits/assertions and keep per-test timeout ≤ 60s; rely on expect timeouts',
        },
        {
            id: 'outputdir',
            title: 'outputDir configured',
            sev: 'info',
            pass: hasOutputDir,
            msgPass: '`outputDir` present (screenshots/traces)',
            msgFail: 'No explicit outputDir configured',
            suggestion: 'Set `outputDir: "test-results/"` to keep results organized for CI artifact upload',
        },
        {
            id: 'webserver',
            title: 'webServer with reuseExistingServer',
            sev: hasWebServer ? (webServerReuse ? 'info' : 'low') : 'info',
            pass: hasWebServer && webServerReuse,
            msgPass: '`webServer` present with `reuseExistingServer: true`',
            msgFail: hasWebServer
                ? '`webServer` present but `reuseExistingServer` not set to true'
                : '`webServer` not configured',
            suggestion: 'Configure `webServer` to start your app for E2E and set `reuseExistingServer: true` to speed up local runs',
        },
    ];
    for (const r of rules) {
        cat.findings.push({
            id: `cfg-${r.id}`,
            title: r.title,
            message: r.pass ? r.msgPass : r.msgFail,
            severity: r.sev,
            status: r.pass ? 'pass' : 'fail',
            suggestion: r.suggestion,
            file: cfgPath || '',
        });
    }
    cat.score = applyScore(cat.findings);
    return cat;
}

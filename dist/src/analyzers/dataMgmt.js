import path from 'path';
import { applyScore, createCategory, exists, findConfig, findFiles, readFile, readJson, } from '../utils/helpers.js';
const cat = createCategory('data', 'Data Management');
async function safeReadFile(p) {
    if (!p)
        return '';
    try {
        return await readFile(p);
    }
    catch {
        return '';
    }
}
function addFinding(f) {
    cat.findings.push({
        id: 'data-' + f.title.toLowerCase().replace(/\W+/g, '-'),
        title: f.title,
        message: f.pass ? 'Configured' : 'Not configured',
        severity: f.sev,
        status: f.pass ? 'pass' : 'fail',
        suggestion: f.suggestion,
        artifacts: (f.artifacts || []).filter(Boolean),
    });
}
export async function analyzeDataMgmt(targetDir) {
    // Common paths & files
    // Find all env files across the project tree
    const envFiles = await findFiles(targetDir, ['**/.env*']);
    const envExample = path.join(targetDir, '.env.example');
    const gitignore = path.join(targetDir, '.gitignore');
    const pkgJsonPath = path.join(targetDir, 'package.json');
    const downloads = path.join(targetDir, 'downloads');
    const screenshots = path.join(targetDir, 'screenshots');
    const traces = path.join(targetDir, 'trace');
    const results = path.join(targetDir, 'test-results');
    const authDir = path.join(targetDir, '.auth');
    const pwConfigPath = await findConfig(targetDir, [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ]);
    const pwConfigText = await safeReadFile(pwConfigPath);
    const hasAnyEnv = envFiles.length > 0;
    const expectedVariants = ['.env.qa', '.env.stage', '.env.uat', '.env.local'];
    // Normalize to basenames like ".env.qa"
    const envBasenames = new Set(envFiles.map((f) => path.basename(f)));
    // Which expected variants did we find?
    const presentVariants = expectedVariants.filter((v) => envBasenames.has(v));
    const missingVariants = expectedVariants.filter((v) => !envBasenames.has(v));
    // You can tune this threshold:
    // - 1  => pass if any expected env variant exists
    // - 2+ => require more coverage
    // - expectedVariants.length => require all
    const requiredMinMatches = 1;
    const pass = presentVariants.length >= requiredMinMatches;
    const hasEnvExample = await exists(envExample);
    const hasGitignore = await exists(gitignore);
    const gitignoreText = hasGitignore ? await readFile(gitignore) : '';
    const pkg = await readJson(pkgJsonPath);
    // Heuristics / regexes
    const dotenvInConfig = /dotenv|config\(\)/i.test(pwConfigText) || /process\.env\./.test(pwConfigText);
    const globalSetupConfigured = /global-setup/i.test(pwConfigText) || /globalSetup/i.test(pwConfigText);
    const globalTeardownConfigured = /global-teardown/i.test(pwConfigText) || /globalTeardown/i.test(pwConfigText);
    const storageStateConfigured = /storageState\s*:\s*['"`][^'"`]+['"`]/.test(pwConfigText) ||
        /use\s*:\s*{[^}]*storageState/i.test(pwConfigText);
    const outputDirConfigured = /outputDir\s*:\s*['"`][^'"`]+['"`]/.test(pwConfigText);
    const screenshotsConfigured = /screenshot\s*:\s*['"`](on|only-on-failure)['"`]|screenshot\s*:\s*(true|false)/i.test(pwConfigText);
    const tracesConfigured = /trace\s*:\s*['"`](on|off|retain-on-failure|on-first-retry)['"`]/i.test(pwConfigText);
    const videoConfigured = /video\s*:\s*['"`](on|off|retain-on-failure)['"`]/i.test(pwConfigText);
    const suspectedSecretsRegexes = [
        /AKIA[0-9A-Z]{16}/, // AWS access key id
        /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/i,
        /(?<!test_)(api|secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
        /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
        /ghp_[A-Za-z0-9]{36,}/, // GitHub token
    ];
    // Data folders and files
    const dataFolders = await findFiles(targetDir, [
        '**/test-data/**',
        '**/data/**',
        '**/__fixtures__/**',
        '**/resources/**',
    ]);
    const jsonCsvXlsx = await findFiles(targetDir, ['**/*.json', '**/*.csv', '**/*.xlsx']);
    // Storage state files (Playwright)
    const storageStateCandidates = await findFiles(targetDir, ['**/storageState*.json', '.auth/**']);
    const hasAuthDir = await exists(authDir);
    // Global setup/teardown files
    const globalSetupFiles = await findFiles(targetDir, [
        '**/*global-setup*.{ts,js}',
        '**/global-setup/**/*.{ts,js}',
    ]);
    const globalTeardownFiles = await findFiles(targetDir, [
        '**/*global-teardown*.{ts,js}',
        '**/global-teardown/**/*.{ts,js}',
    ]);
    // CI artifact upload hints
    const workflowFiles = await findFiles(targetDir, [
        '.github/workflows/**/*.yml',
        '.github/workflows/**/*.yaml',
    ]);
    const workflowTexts = await Promise.all(workflowFiles.map(safeReadFile));
    const hasUploadArtifactInCI = workflowTexts.some((t) => /actions\/upload-artifact/i.test(t));
    // Schema validation libraries present?
    const deps = {
        ...(pkg?.dependencies || {}),
        ...(pkg?.devDependencies || {}),
    };
    const hasZod = 'zod' in deps;
    const hasEnvalid = 'envalid' in deps;
    const hasJoi = '@hapi/joi' in deps || 'joi' in deps;
    const hasYup = 'yup' in deps;
    // NPM clean scripts
    const hasCleanScript = !!pkg?.scripts?.clean &&
        /(rimraf|rm\s+-rf|del-cli).*(test-results|trace|screenshots|downloads)/i.test(pkg.scripts.clean);
    // 1) ENV presence + usage
    addFinding({
        title: 'Parameterized environment data',
        pass,
        sev: pass ? (missingVariants.length ? 'info' : 'low') : 'medium',
        suggestion: pass
            ? missingVariants.length
                ? `Found ${presentVariants.join(', ')}. Consider adding: ${missingVariants.join(', ')}.`
                : 'All expected env variants present across the project.'
            : `No expected env variants found. Add at least one of: ${expectedVariants.join(', ')}.`,
        artifacts: envFiles,
    });
    addFinding({
        title: 'Sample env file committed (.env.example)',
        pass: hasEnvExample,
        sev: 'low',
        suggestion: 'Commit a sanitized .env.example to document required variables.',
        artifacts: [envExample],
    });
    addFinding({
        title: 'Secrets management (env/CI vars)',
        pass: hasAnyEnv,
        sev: 'low',
        suggestion: 'Use CI secrets & .env files; never commit secrets to VCS.',
        artifacts: envFiles,
    });
    addFinding({
        title: 'Env variables wired in config',
        pass: dotenvInConfig,
        sev: 'low',
        suggestion: `Load env via "import 'dotenv/config'" or dotenv.config() and reference process.env in playwright.config.*.`,
        artifacts: [pwConfigPath || ''],
    });
    // 2) Secret leakage guardrails
    // scan a small set of likely files for secret-looking strings (package.json, configs, env.example)
    const probableLeakFiles = [pkgJsonPath, pwConfigPath || '', envExample].filter(Boolean);
    const probableLeakTexts = await Promise.all(probableLeakFiles.map(safeReadFile));
    const hasSuspectedSecrets = probableLeakTexts.some((t) => suspectedSecretsRegexes.some((re) => re.test(t)));
    addFinding({
        title: 'No hardcoded secrets in repo (quick scan)',
        pass: !hasSuspectedSecrets,
        sev: hasSuspectedSecrets ? 'high' : 'low',
        suggestion: 'Remove hardcoded secrets. Use CI secrets or .env. Consider adding a pre-commit secret scanner (e.g., gitleaks, trufflehog).',
        artifacts: probableLeakFiles,
    });
    // 3) Artifacts: directories & config
    const artifactsPresent = (await exists(results)) ||
        (await exists(downloads)) ||
        (await exists(screenshots)) ||
        (await exists(traces));
    addFinding({
        title: 'Artifacts directories present',
        pass: artifactsPresent,
        sev: 'info',
        suggestion: 'Ensure CI preserves artifacts for debugging (test-results, trace, screenshots, downloads).',
        artifacts: [results, downloads, screenshots, traces],
    });
    addFinding({
        title: 'Artifacts configured in Playwright config',
        pass: outputDirConfigured || screenshotsConfigured || tracesConfigured || videoConfigured,
        sev: 'low',
        suggestion: 'Configure outputDir, screenshot, trace, and video in playwright.config.* to standardize artifact locations.',
        artifacts: [pwConfigPath || ''],
    });
    addFinding({
        title: 'Artifacts uploaded in CI',
        pass: hasUploadArtifactInCI,
        sev: 'low',
        suggestion: 'In GitHub Actions, use actions/upload-artifact to persist test-results/trace/screenshots on failures.',
        artifacts: workflowFiles,
    });
    // 4) Git hygiene
    const ignoredEnv = hasGitignore && /\n?\.env(\..+)?\n?/.test(gitignoreText);
    const ignoredArtifacts = hasGitignore && /(test-results|trace|screenshots|downloads)/.test(gitignoreText);
    addFinding({
        title: '.env files are gitignored',
        pass: !!ignoredEnv,
        sev: 'medium',
        suggestion: 'Add .env* to .gitignore to avoid leaking secrets.',
        artifacts: [gitignore],
    });
    addFinding({
        title: 'Artifacts are gitignored',
        pass: !!ignoredArtifacts,
        sev: 'low',
        suggestion: 'Add test-results/, trace/, screenshots/, downloads/ to .gitignore to keep repo clean.',
        artifacts: [gitignore],
    });
    // 5) Global setup/teardown
    const hasGlobalSetupFiles = globalSetupFiles.length > 0;
    const hasGlobalTeardownFiles = globalTeardownFiles.length > 0;
    addFinding({
        title: 'Global setup/teardown present',
        pass: hasGlobalSetupFiles || hasGlobalTeardownFiles,
        sev: 'low',
        suggestion: 'Add global-setup.ts / global-teardown.ts for seeding/cleanup/session bootstrapping if needed.',
        artifacts: [
            'global-setup.ts',
            'global-teardown.ts',
            ...globalSetupFiles,
            ...globalTeardownFiles,
        ],
    });
    addFinding({
        title: 'Global setup/teardown configured in Playwright',
        pass: globalSetupConfigured && globalTeardownConfigured,
        sev: 'low',
        suggestion: 'Wire globalSetup/globalTeardown in playwright.config.* if using those scripts.',
        artifacts: [pwConfigPath || ''],
    });
    // 6) Storage state (login/session) management
    addFinding({
        title: 'Storage state configured',
        pass: storageStateConfigured,
        sev: 'low',
        suggestion: 'Use storageState to reuse auth sessions and avoid re-login. Store files under ./.auth and reference in use.storageState.',
        artifacts: storageStateCandidates,
    });
    addFinding({
        title: 'Auth directory present (.auth)',
        pass: hasAuthDir,
        sev: 'info',
        suggestion: 'Prefer a dedicated .auth folder for session artifacts with proper .gitignore rules.',
        artifacts: [authDir],
    });
    // 7) Test data organization
    const hasDataFolders = dataFolders.length > 0;
    const hasStructuredDataFiles = jsonCsvXlsx.length > 0;
    addFinding({
        title: 'Structured test data present (JSON/CSV/XLSX)',
        pass: hasStructuredDataFiles,
        sev: 'low',
        suggestion: 'Maintain test data as JSON/CSV/XLSX in a dedicated folder (e.g., test-data/ or __fixtures__/).',
        artifacts: jsonCsvXlsx.slice(0, 20), // avoid flooding
    });
    addFinding({
        title: 'Dedicated test data folders',
        pass: hasDataFolders,
        sev: 'info',
        suggestion: 'Use test-data/, __fixtures__/, or resources/ to separate data from tests and code.',
        artifacts: dataFolders.slice(0, 20),
    });
    // 8) Env schema validation (zod/envalid/joi/yup)
    const hasEnvSchemaLib = hasZod || hasEnvalid || hasJoi || hasYup;
    addFinding({
        title: 'Environment schema validation library installed',
        pass: hasEnvSchemaLib,
        sev: 'low',
        suggestion: 'Validate required env vars on startup with zod/envalid/joi/yup to fail fast on misconfigurations.',
        artifacts: [pkgJsonPath],
    });
    // 9) Cleanup scripts to keep artifacts tidy
    addFinding({
        title: 'Cleanup script for artifacts',
        pass: hasCleanScript,
        sev: 'info',
        suggestion: 'Add "clean" script (rimraf test-results trace screenshots downloads) and run before/after CI jobs as needed.',
        artifacts: [pkgJsonPath],
    });
    // Final score
    cat.score = applyScore(cat.findings);
    return cat;
}

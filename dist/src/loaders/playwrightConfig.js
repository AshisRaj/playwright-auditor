import { build } from 'esbuild';
import path from 'path';
import { pathToFileURL } from 'url';
import { exists } from '../utils/helpers';
/**
 * Load Playwright config from the target project safely.
 * - TS configs: TRANSPILE ONLY (no bundling) to ESM, then dynamic-import.
 * - JS/MJS/CJS: import directly (Node handles CJS via dynamic import fine).
 * This avoids pulling the target's node_modules (chromium-bidi etc.) into our build
 * and keeps `import.meta.url` working by using ESM output.
 */
export async function loadPlaywrightConfig(cwd) {
    const candidates = [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ];
    for (const f of candidates) {
        const abs = path.join(cwd, f);
        if (!(await exists(abs)))
            continue;
        if (f.endsWith('.ts')) {
            // Transpile-only to ESM (no bundle) so import.meta.url works
            // and we don't drag in the target project's node_modules.
            const out = path.join(cwd, '.pwaudit-temp.mjs');
            await build({
                entryPoints: [abs],
                outfile: out,
                platform: 'node',
                format: 'esm',
                bundle: false, // <— critical
                target: ['node18'], // node18+ is fine (you’re on node22)
                sourcemap: false,
            });
            const mod = await import(pathToFileURL(out).href);
            return mod.default ?? mod;
        }
        // For JS configs (js/mjs/cjs), import as-is.
        const mod = await import(pathToFileURL(abs).href);
        return mod.default ?? mod;
    }
    return undefined;
}

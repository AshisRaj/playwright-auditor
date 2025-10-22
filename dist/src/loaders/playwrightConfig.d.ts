/**
 * Load Playwright config from the target project safely.
 * - TS configs: TRANSPILE ONLY (no bundling) to ESM, then dynamic-import.
 * - JS/MJS/CJS: import directly (Node handles CJS via dynamic import fine).
 * This avoids pulling the target's node_modules (chromium-bidi etc.) into our build
 * and keeps `import.meta.url` working by using ESM output.
 */
export declare function loadPlaywrightConfig(cwd: string): Promise<any | undefined>;

import { promises as fs } from 'fs';
import path from 'path';
import { addFinding, applyScore, createCategory, makeId, walk } from '../utils/helpers.js';
const cat = createCategory('network', 'Network Control');
// Safe file read
async function readSafe(file) {
    try {
        return await fs.readFile(file, 'utf8');
    }
    catch {
        return '';
    }
}
export async function analyzeNetwork(targetDir) {
    const roots = ['tests', 'e2e', 'test', '__tests__', 'src'].map((r) => path.join(targetDir, r));
    // Gather candidate files
    let files = [];
    for (const r of roots) {
        const st = await fs.stat(r).catch(() => null);
        if (!st)
            continue;
        const walked = await walk(r);
        files = files.concat(walked.filter((f) => /\.(t|j)sx?$/.test(f)));
    }
    const LIMIT = 1500;
    const take = files.slice(0, LIMIT);
    // Evidence buckets
    const pageRouteFiles = new Set(); // page.route(
    const contextRouteFiles = new Set(); // context.route(
    const routeFulfillFiles = new Set(); // route.fulfill({
    const routeAbortFiles = new Set(); // route.abort()
    const routeContinueFiles = new Set(); // route.continue(
    const routeRouteFiles = new Set(); // route.route( (chained routing)
    const routeFromHarFiles = new Set(); // routeFromHAR(
    const onRequestFiles = new Set(); // .on('request', ...)
    // Regexes
    const rePageRoute = /\bpage\.route\s*\(/;
    const reContextRoute = /\b(?:browser)?context\.route\s*\(/i;
    const reRouteFulfill = /\bawait\s+route\.fulfill\s*\(\s*{?/;
    const reRouteAbort = /\bawait\s+route\.abort\s*\(\s*\)?/;
    const reRouteContinue = /\bawait\s+route\.continue\s*\(/;
    const reRouteRoute = /\bawait\s+route\.route\s*\(/; // nested/stacked routing
    const reRouteFromHAR = /\brouteFromHAR\s*\(/i;
    const reOnRequest = /\.on\s*\(\s*['"]request['"]/i;
    // Scan
    for (const f of take) {
        const s = await readSafe(f);
        if (!s)
            continue;
        if (rePageRoute.test(s))
            pageRouteFiles.add(f);
        if (reContextRoute.test(s))
            contextRouteFiles.add(f);
        if (reRouteFulfill.test(s))
            routeFulfillFiles.add(f);
        if (reRouteAbort.test(s))
            routeAbortFiles.add(f);
        if (reRouteContinue.test(s))
            routeContinueFiles.add(f);
        if (reRouteRoute.test(s))
            routeRouteFiles.add(f);
        if (reRouteFromHAR.test(s))
            routeFromHarFiles.add(f);
        if (reOnRequest.test(s))
            onRequestFiles.add(f);
    }
    const pick = (set, n = 10) => Array.from(set).slice(0, n);
    const anyRouting = pageRouteFiles.size > 0 || contextRouteFiles.size > 0;
    const anyAction = routeFulfillFiles.size > 0 || routeAbortFiles.size > 0 || routeContinueFiles.size > 0;
    // 1) Mocks via route() present
    {
        const ok = anyRouting;
        addFinding(cat, {
            id: makeId('Mocks via route()'),
            title: 'Mocks via route()',
            status: ok,
            severity: 'medium',
            message: ok
                ? `Detected route() in ${pageRouteFiles.size + contextRouteFiles.size} file(s)`
                : 'No route() mocking detected',
            suggestion: ok
                ? 'Ensure each route has a clear action (fulfill/abort/continue) and proper cleanup.'
                : 'Use page.route() or browserContext.route() to intercept and mock network calls.',
            artifacts: pick(new Set([...pageRouteFiles, ...contextRouteFiles])),
        });
    }
    // 2) route.fulfill present
    {
        const ok = routeFulfillFiles.size > 0;
        addFinding(cat, {
            id: makeId('Use route.fulfill for mocked responses'),
            title: 'Use route.fulfill for mocked responses',
            status: ok,
            severity: 'low',
            message: ok
                ? `Found route.fulfill in ${routeFulfillFiles.size} file(s)`
                : 'No route.fulfill detected',
            suggestion: 'Prefer await route.fulfill({ status, contentType, body }) for deterministic mocks. Consider storing payloads as fixtures.',
            artifacts: pick(routeFulfillFiles),
        });
    }
    // 3) route.abort present
    {
        const ok = routeAbortFiles.size > 0;
        addFinding(cat, {
            id: makeId('Use route.abort to simulate failures'),
            title: 'Use route.abort to simulate failures',
            status: ok,
            severity: 'info',
            message: ok
                ? `Found route.abort in ${routeAbortFiles.size} file(s)`
                : 'No route.abort detected',
            suggestion: 'Use await route.abort() to simulate network errors/timeouts and test resilience paths.',
            artifacts: pick(routeAbortFiles),
        });
    }
    // 4) route.continue present (pass-through with inspection)
    {
        const ok = routeContinueFiles.size > 0;
        addFinding(cat, {
            id: makeId('Use route.continue for passthrough'),
            title: 'Use route.continue for passthrough',
            status: ok,
            severity: 'info',
            message: ok
                ? `Found route.continue in ${routeContinueFiles.size} file(s)`
                : 'No route.continue detected',
            suggestion: 'Use await route.continue() when only modifying headers/method/url before allowing the request.',
            artifacts: pick(routeContinueFiles),
        });
    }
    // 5) route.route (chained/stacked routing)
    {
        const ok = routeRouteFiles.size === 0;
        addFinding(cat, {
            id: makeId('Avoid chained route.route'),
            title: 'Avoid chained route.route',
            status: ok,
            severity: 'low',
            message: ok
                ? 'No nested route.route detected'
                : `Nested route.route found in ${routeRouteFiles.size} file(s)`,
            suggestion: 'Chaining route.route() can lead to complex, hard-to-debug flows. Prefer a single interception per request.',
            artifacts: pick(routeRouteFiles),
        });
    }
    // 6) routeFromHAR usage (HAR-based mocks)
    {
        const ok = routeFromHarFiles.size > 0;
        addFinding(cat, {
            id: makeId('HAR-based network mocking'),
            title: 'HAR-based network mocking',
            status: ok,
            severity: 'info',
            message: ok
                ? `routeFromHAR used in ${routeFromHarFiles.size} file(s)`
                : 'No HAR-based mocking detected',
            suggestion: 'Use routeFromHAR for realistic recordings of network traffic and faster, stable tests when the backend is volatile.',
            artifacts: pick(routeFromHarFiles),
        });
    }
    // 7) Prefer page.route over context.route for test isolation
    {
        const ok = contextRouteFiles.size === 0 || pageRouteFiles.size >= contextRouteFiles.size;
        addFinding(cat, {
            id: makeId('Prefer page.route over context.route'),
            title: 'Prefer page.route over context.route',
            status: ok,
            severity: 'low',
            message: contextRouteFiles.size === 0
                ? 'No browserContext.route usage detected (good for isolation)'
                : `browserContext.route used in ${contextRouteFiles.size} file(s)`,
            suggestion: 'Use page.route where possible to scope mocks to a single test. If using context.route, ensure proper setup/teardown.',
            artifacts: pick(contextRouteFiles),
        });
    }
    // 8) Request event handling present
    {
        const ok = onRequestFiles.size > 0;
        addFinding(cat, {
            id: makeId('Request event handling'),
            title: 'Request event handling',
            status: ok,
            severity: 'low',
            message: ok
                ? `request event used in ${onRequestFiles.size} file(s)`
                : 'No request event handling detected',
            suggestion: 'Use request events for diagnostics (logging, assertions). Prefer route() for deterministic mocking.',
            artifacts: pick(onRequestFiles),
        });
    }
    // 9) Sanity: route present but no fulfill/abort/continue detected
    {
        const routeButNoAction = anyRouting && !anyAction;
        const ok = !routeButNoAction;
        addFinding(cat, {
            id: makeId('Route defined without action'),
            title: 'Route defined without action',
            status: ok,
            severity: 'medium',
            message: routeButNoAction
                ? 'Found route() without fulfill/abort/continue in scanned files'
                : 'All route() usages appear to take an action',
            suggestion: 'Every interception should either fulfill, abort, or continue the request; otherwise it can hang or behave unexpectedly.',
            artifacts: pick(new Set([...pageRouteFiles, ...contextRouteFiles])),
        });
    }
    // Final score
    cat.score = applyScore(cat.findings);
    return cat;
}

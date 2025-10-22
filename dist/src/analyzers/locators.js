import { promises as fs } from 'fs';
import path from 'path';
import { addFinding, applyScore, createCategory, makeId, walk } from '../utils/helpers.js';
const cat = createCategory('locators', 'Locator Strategy');
// Safe file read
async function readSafe(file) {
    try {
        return await fs.readFile(file, 'utf8');
    }
    catch {
        return '';
    }
}
export async function analyzeLocators(targetDir) {
    const roots = ['tests', 'e2e', 'test', '__tests__', 'src'].map((r) => path.join(targetDir, r));
    // Collect candidate files
    let files = [];
    for (const r of roots) {
        const stat = await fs.stat(r).catch(() => null);
        if (!stat)
            continue;
        const walked = await walk(r);
        files = files.concat(walked.filter((f) => /\.(t|j)sx?$/.test(f)));
    }
    const LIMIT = 2000;
    const take = files.slice(0, LIMIT);
    // Evidence buckets
    const xpathFiles = new Set();
    const roleFiles = new Set();
    const roleWithNameFiles = new Set();
    const testIdFiles = new Set();
    const userFacingGetByFiles = new Set();
    const nthFiles = new Set();
    const regexTextFiles = new Set();
    const hasTextPseudoFiles = new Set();
    const cssNthChildFiles = new Set();
    const dataTestIdAttrFiles = new Set();
    // Regexes
    const reXPath = /(locator\(\s*["'`](?:\/\/|\.\/\/)|page\.(?:locator|getByRole|getByTestId|getByText)?\(\s*["'`](?:\/\/|\.\/\/))/;
    const reGetByRole = /getByRole\(/;
    const reGetByRoleWithName = /getByRole\(\s*['"`][^'"`]+['"`]\s*,\s*{[^}]*\bname\s*:/;
    const reGetByTestId = /getByTestId\(/i;
    const reAttrDataTestId = /\[data-testid\s*=/i;
    const reDataTestIdAttrLiteral = /data-testid\s*=/i;
    const reUserFacing = /getBy(?:Text|Label|Placeholder|AltText|Title)\(/;
    const reNth = /\.nth\(\s*\d+\s*\)/;
    const reRegexText = /getByText\(\s*\/.*\/[a-z]*\s*\)/i;
    const reHasTextPseudo = /:has-text\(/i;
    const reCssNthChild = /:nth-child\(/i;
    // Scan files
    for (const f of take) {
        const s = await readSafe(f);
        if (!s)
            continue;
        if (reXPath.test(s))
            xpathFiles.add(f);
        if (reGetByRole.test(s))
            roleFiles.add(f);
        if (reGetByRoleWithName.test(s))
            roleWithNameFiles.add(f);
        if (reGetByTestId.test(s) || reAttrDataTestId.test(s))
            testIdFiles.add(f);
        if (reUserFacing.test(s))
            userFacingGetByFiles.add(f);
        if (reNth.test(s))
            nthFiles.add(f);
        if (reRegexText.test(s))
            regexTextFiles.add(f);
        if (reHasTextPseudo.test(s))
            hasTextPseudoFiles.add(f);
        if (reCssNthChild.test(s))
            cssNthChildFiles.add(f);
        if (reDataTestIdAttrLiteral.test(s))
            dataTestIdAttrFiles.add(f);
    }
    // Counts
    const xpath = xpathFiles.size;
    const role = roleFiles.size;
    const roleWithName = roleWithNameFiles.size;
    const testid = testIdFiles.size;
    const userFacing = userFacingGetByFiles.size;
    const nth = nthFiles.size;
    const regexText = regexTextFiles.size;
    const hasTextPseudo = hasTextPseudoFiles.size;
    const cssNthChild = cssNthChildFiles.size;
    const dataTestIdAttr = dataTestIdAttrFiles.size;
    const pick = (set, n = 10) => Array.from(set).slice(0, n);
    // 1) Avoid XPath selectors
    {
        const ok = xpath === 0;
        addFinding(cat, {
            id: makeId('Avoid XPath selectors'),
            title: 'Avoid XPath selectors',
            status: ok,
            severity: 'high',
            message: ok ? 'No XPath detected' : `Found XPath in ${xpath} file(s)`,
            suggestion: 'Prefer role/test id/user-facing locators instead of //xpath.',
            artifacts: pick(xpathFiles),
        });
    }
    // 2) Use getByRole for semantics
    {
        const ok = role > 0;
        addFinding(cat, {
            id: makeId('Use getByRole for semantics'),
            title: 'Use getByRole for semantics',
            status: ok,
            severity: 'medium',
            message: ok ? `getByRole used in ${role} file(s)` : 'No getByRole usage detected',
            suggestion: 'Prefer getByRole with a meaningful accessible name for resilient locators.',
            artifacts: pick(roleFiles),
        });
    }
    // 3) When using getByRole, ensure accessible name is specified
    {
        const ok = role === 0 || roleWithName > 0; // pass if no role usage (N/A) or name is used
        addFinding(cat, {
            id: makeId('Accessible name with getByRole'),
            title: 'Accessible name with getByRole',
            status: ok,
            severity: 'low',
            message: role === 0
                ? 'No getByRole usage (N/A)'
                : roleWithName > 0
                    ? `getByRole with { name: ... } in ${roleWithName} file(s)`
                    : 'getByRole used without { name }',
            suggestion: 'When using getByRole, pass an explicit { name: /text/ } to target the intended element.',
            artifacts: pick(roleWithName > 0 ? roleWithNameFiles : roleFiles),
        });
    }
    // 4) Use test IDs (getByTestId or [data-testid=...])
    {
        const ok = testid > 0;
        addFinding(cat, {
            id: makeId('Use test IDs for stability'),
            title: 'Use test IDs for stability',
            status: ok,
            severity: 'medium',
            message: ok
                ? `Stable test ID locators found in ${testid} file(s)`
                : 'No getByTestId or [data-testid=] usage detected',
            suggestion: 'Introduce data-testid attributes for key elements and use getByTestId or [data-testid=...] selectors.',
            artifacts: pick(testIdFiles),
        });
    }
    // 5) App instrumented with data-testid attributes (in markup/tsx)
    {
        const ok = dataTestIdAttr > 0;
        addFinding(cat, {
            id: makeId('App instrumented with data-testid'),
            title: 'App instrumented with data-testid',
            status: ok,
            severity: 'info',
            message: ok
                ? `Found 'data-testid' attributes in ${dataTestIdAttr} file(s)`
                : `No 'data-testid' attributes found in scanned files`,
            suggestion: ok
                ? 'Great! Use getByTestId for those elements.'
                : 'Consider adding data-testid attributes to critical elements for robust selectors.',
            artifacts: pick(dataTestIdAttrFiles),
        });
    }
    // 6) Use user-facing getBy* variants
    {
        const ok = userFacing > 0;
        addFinding(cat, {
            id: makeId('Use user-facing locators'),
            title: 'Use user-facing locators',
            status: ok,
            severity: 'info',
            message: ok
                ? `User-facing getBy* APIs used in ${userFacing} file(s)`
                : 'No getByText/Label/Placeholder/AltText/Title usage detected',
            suggestion: 'Prefer getByText/Label/Placeholder/AltText/Title where appropriate to align with how users interact.',
            artifacts: pick(userFacingGetByFiles),
        });
    }
    // 7) Avoid .nth() chaining
    {
        const ok = nth === 0;
        addFinding(cat, {
            id: makeId('Avoid brittle nth() chaining'),
            title: 'Avoid brittle nth() chaining',
            status: ok,
            severity: 'low',
            message: ok ? 'No nth() chaining found' : `nth() used in ${nth} file(s)`,
            suggestion: 'Target unique roles/test IDs or tighter scopes instead of relying on indexes.',
            artifacts: pick(nthFiles),
        });
    }
    // 8) Avoid regex getByText
    {
        const ok = regexText === 0;
        addFinding(cat, {
            id: makeId('Avoid regex getByText'),
            title: 'Avoid regex getByText',
            status: ok,
            severity: 'low',
            message: ok
                ? 'No regex getByText() detected'
                : `Regex getByText() found in ${regexText} file(s)`,
            suggestion: 'Prefer exact strings or accessible role+name. Regex text selectors can be brittle and slow.',
            artifacts: pick(regexTextFiles),
        });
    }
    // 9) Avoid :has-text() pseudo selector
    {
        const ok = hasTextPseudo === 0;
        addFinding(cat, {
            id: makeId('Avoid :has-text() pseudo'),
            title: 'Avoid :has-text() pseudo',
            status: ok,
            severity: 'low',
            message: ok ? 'No :has-text() usage' : `:has-text() used in ${hasTextPseudo} file(s)`,
            suggestion: 'Use getByText / getByRole({ name }) / hasText option on locator() instead of :has-text().',
            artifacts: pick(hasTextPseudoFiles),
        });
    }
    // 10) Avoid CSS :nth-child()
    {
        const ok = cssNthChild === 0;
        addFinding(cat, {
            id: makeId('Avoid :nth-child() in selectors'),
            title: 'Avoid :nth-child() in selectors',
            status: ok,
            severity: 'low',
            message: ok
                ? 'No :nth-child() usage in CSS selectors'
                : `:nth-child() found in ${cssNthChild} file(s)`,
            suggestion: 'Prefer semantic locators (role/name or test IDs) rather than positional CSS like :nth-child().',
            artifacts: pick(cssNthChildFiles),
        });
    }
    // Final score
    cat.score = applyScore(cat.findings);
    return cat;
}

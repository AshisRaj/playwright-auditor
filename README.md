# Playwright Project Auditor

## Install
```bash
pnpm i
pnpm build
```

## Usage
```bash
# audit current folder
npx pwaudit . -o audit-report

# or after build
node dist/cli.js . -o audit-report
```

## What it checks
- Project structure (tests/, pages/, fixtures/, data/)
- Dependencies (Playwright version, advanced reporting libs)
- Config hygiene (trace, video, retries, reporters, timeouts)
- Test quality heuristics (hard waits, test.only, brittle selectors)
- Locator strategy smells (nth-child, long text selectors)
- Flakiness risks (setTimeout/waitForTimeout)
- Reporting & observability (HTML reporter, traces)
- CI presence (GitHub/GitLab/Azure)
- Network control hints (route/request usage)

## Output
- `audit-report/report.json` — machine-readable
- `audit-report/index.html` — dashboard

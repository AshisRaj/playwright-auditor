# AI Coding Agent Instructions for Playwright Auditor

## Overview
Playwright Auditor is a tool designed to analyze Playwright projects for best practices, structural integrity, and potential issues. It generates both machine-readable and human-readable reports. The codebase is modular, with analyzers, loaders, and reporters as key components.

## Key Components
- **Analyzers** (`src/analyzers/`): Contain logic for auditing specific aspects of a Playwright project, such as `projectStructure.ts` and `testsQuality.ts`.
- **Loaders** (`src/loaders/`): Handle configuration loading, e.g., `playwrightConfig.ts`.
- **Reporters** (`src/reporters/`): Define output formats, including HTML and JSON.
- **Utilities** (`src/utils/`): Provide shared helper functions, patterns, and scoring logic.

## Developer Workflows
### Installation
```bash
pnpm i
pnpm build
```

### Running the Auditor
```bash
# Audit the current folder
npx pwaudit . -o audit-report

# Or use the built CLI
node dist/cli.js . -o audit-report
```

### Testing
- Tests are not explicitly mentioned in the README but should be added under `tests/` following the project structure guidelines.

### Debugging
- Use the `--debug` flag in CLI commands to enable verbose logging.

## Project-Specific Conventions
- **Analyzer Structure**: Each analyzer focuses on a specific domain (e.g., `dependencies.ts` for dependency checks). Follow the existing patterns when adding new analyzers.
- **Scoring**: Use `src/utils/scoring.ts` for consistent scoring logic across analyzers.
- **HTML Templates**: Report templates are located in `src/reporters/reporter-ui/templates/`.

## Integration Points
- **Playwright Config**: Loaded via `src/loaders/playwrightConfig.ts`.
- **Output Reports**: Generated in `audit-report/` as `index.html` and `report.json`.
- **CI/CD**: Checks for CI presence in `src/analyzers/cicdIntegration.ts`.

## External Dependencies
- **Playwright**: Core dependency for project analysis.
- **EJS**: Used for HTML report templates.
- **PNPM**: Preferred package manager.

## Examples
### Adding a New Analyzer
1. Create a new file in `src/analyzers/`.
2. Follow the structure of existing analyzers like `core.ts`.
3. Use utility functions from `src/utils/` where applicable.

### Modifying Report Templates
1. Edit the relevant `.ejs` file in `src/reporters/reporter-ui/templates/`.
2. Ensure changes are reflected in the HTML output by running the auditor.

---

For more details, refer to the [README.md](../README.md).
#!/usr/bin/env node
import { Command } from 'commander';
import { runAudit } from '../src/index.js';
import { writeHtml } from '../src/reporters/html.js';
import { writeJson } from '../src/reporters/json.js';
const program = new Command();
program
    .name('pwaudit')
    .description('Audit a Playwright project and output a dashboard + JSON summary')
    .argument('[target]', 'Path to the Playwright project', '.')
    .option('-o, --out <dir>', 'Output directory', 'audit-report')
    .option('--json-only', 'Emit only JSON summary, skip HTML', false)
    .option('--debug', 'Verbose logs', false)
    .action(async (target, opts) => {
    const result = await runAudit(target, opts.debug);
    await writeJson(result, opts.out);
    if (!opts.jsonOnly)
        await writeHtml(result, opts.out);
    console.log(`\n✅ Audit complete. See ${opts.out}/index.html and report.json`);
});
program.parse();

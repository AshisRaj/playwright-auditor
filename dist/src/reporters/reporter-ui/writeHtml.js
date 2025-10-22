/* eslint-disable @typescript-eslint/naming-convention */
import ejs from 'ejs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// import { AuditResult } from '../types.js'; // keep your existing type
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export async function writeHtml(result, outDir) {
    // 1) Ensure dist
    await fs.mkdir(outDir, { recursive: true });
    // 2) Render EJS (server-side)
    const layoutPath = path.join(__dirname, 'templates', 'layout.ejs');
    const reportPath = path.join(__dirname, 'templates', 'report.ejs');
    const body = await ejs.renderFile(reportPath, {}, { async: true });
    const html = await ejs.renderFile(layoutPath, {
        title: 'Playwright Audit Report',
        themeClass: '', // start dark; toggle in UI
        json: JSON.stringify(result).replace(/</g, '\\u003c'),
        body,
    }, { async: true });
    // 3) Write HTML
    await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
    // 4) Copy assets (css/js)
    const publicDir = path.join(__dirname, '..', 'public');
    await copyDir(publicDir, path.join(outDir));
}
async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory())
            await copyDir(s, d);
        else
            await fs.copyFile(s, d);
    }
}

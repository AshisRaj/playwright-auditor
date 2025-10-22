import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const srcRoot = path.join(repoRoot, 'reporters', 'reporter-ui');
  const distRoot = path.join(repoRoot, '..', 'dist', 'src', 'reporters', 'reporter-ui');

  const fromTemplates = path.join(srcRoot, 'templates');
  const toTemplates = path.join(distRoot, 'templates');

  const fromPublic = path.join(srcRoot, 'public');
  const toPublic = path.join(distRoot, 'public');

  // Copy only if source exists (lets you run build even before adding UI)
  const tStat = await fs.stat(fromTemplates).catch((e) => console.log(e));
  if (tStat?.isDirectory()) await copyDir(fromTemplates, toTemplates);

  const pStat = await fs.stat(fromPublic).catch((e) => console.log(e));
  if (pStat?.isDirectory()) await copyDir(fromPublic, toPublic);
}

main().catch((e) => {
  console.error('copy-assets failed:', e);
  process.exit(1);
});

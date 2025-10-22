import { promises as fs } from 'fs';
import path from 'path';
export async function writeJson(result, outDir) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(result, null, 2), 'utf8');
}

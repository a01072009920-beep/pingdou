import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let count = 0;
for (const directory of ['src', 'public', 'scripts']) {
  const entries = await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes:true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(mjs|js)$/.test(entry.name)) continue;
    const path = new URL(`../${directory}/${entry.name}`, import.meta.url);
    execFileSync(process.execPath, ['--check', fileURLToPath(path)], { stdio:'inherit' });
    count++;
  }
}
console.log(`Syntax checked ${count} JavaScript modules.`);

// Copy src/generated/*.json into dist/generated/ after tsc.
//
// tsc only emits a .json file into outDir when some .ts file imports it, and
// the library deliberately imports `generated/conventions.ts` instead (see the
// note in that file). Without this step `dist/generated/` would hold no JSON at
// all, so a consumer that reads the artifact from the installed package — rather
// than through the library's API — finds nothing there.
//
// Runs as part of `npm run build`, which is what the `prepare` script executes
// when the package is installed from GitHub.

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src', 'generated');
const dest = join(root, 'dist', 'generated');

const files = readdirSync(src).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`No JSON to copy from ${src} — run \`uv run codegen\` first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log(`copied ${files.length} generated JSON file(s) to dist/generated/`);

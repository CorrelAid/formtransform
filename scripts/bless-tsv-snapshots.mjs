#!/usr/bin/env node
/**
 * Re-bless frozen TSV snapshots (variants/<slug>/tsv.tsv) using the
 * locally built converter (dist/index.js). Manual gate — codegen.py does NOT
 * touch these files, so the snapshot tests in
 * src/test/registryConformance.test.ts stay non-tautological.
 *
 * Usage: npm run build && node scripts/bless-tsv-snapshots.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const entry = path.join(REPO_ROOT, 'dist', 'index.js');
if (!fs.existsSync(entry)) {
  console.error('dist/index.js missing — run `npm run build` first.');
  process.exit(1);
}
const { XLSFormToTSVConverter } = await import(pathToFileURL(entry).href);
const { resolveFileChoices } = await import(
	pathToFileURL(path.join(REPO_ROOT, 'dist', 'fileChoices.js')).href
);
const VOCAB_DIR = path.join(REPO_ROOT, 'registry', 'vocab');

// Same registry walk as codegen.load_registry: root graph + every split source
// (schema.jsonld + conventions/*.jsonld + registry/<slug>/definition.jsonld).
const graph = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'registry', 'root.jsonld'), 'utf-8'),
)['@graph'];
const splitFiles = [
  'registry/schema.jsonld',
  ...fs
    .readdirSync(path.join(REPO_ROOT, 'registry', 'conventions'))
    .sort()
    .map((s) => `registry/conventions/${s}`),
  ...fs
    .readdirSync(path.join(REPO_ROOT, 'registry', 'entities'))
    .sort()
    .map((s) => `registry/entities/${s}/definition.jsonld`),
];
for (const rel of splitFiles) {
  const abs = path.join(REPO_ROOT, rel);
  if (fs.existsSync(abs)) {
    graph.push(...JSON.parse(fs.readFileSync(abs, 'utf-8'))['@graph']);
  }
}

// Every entity carrying a worked example (type default, variant, or composite).
const variants = graph.filter((e) => e.exampleDir);

let written = 0;
let skipped = 0;
for (const variant of variants) {
  const exDir = path.join(REPO_ROOT, variant.exampleDir ?? '');
  const src = path.join(exDir, 'fixtures', 'xlsform.json');
  if (!variant.exampleDir || !fs.existsSync(src)) continue;

  const xlsform = JSON.parse(fs.readFileSync(src, 'utf-8'));
  const survey = xlsform.survey ?? [];
  const converter = new XLSFormToTSVConverter();
  try {
    const tsv = await converter.convert(
      survey,
      xlsform.choices ?? [],
      xlsform.settings ?? [],
      resolveFileChoices(survey, VOCAB_DIR),
    );
    fs.writeFileSync(path.join(exDir, 'tsv.tsv'), tsv);
    console.log(
      `blessed ${variant['@id']} → ${path.relative(REPO_ROOT, exDir)}/tsv.tsv`,
    );
    written++;
  } catch (e) {
    // LS-unsupported input types (e.g. select_one_from_file) — no snapshot.
    console.warn(`skip ${variant['@id']}: ${e.message}`);
    skipped++;
  }
}

console.log(`\n${written} snapshots written, ${skipped} skipped.`);
console.log('Review with: git diff registry/*/tsv.tsv');

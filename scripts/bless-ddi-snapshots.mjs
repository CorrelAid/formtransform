#!/usr/bin/env node
/**
 * Re-bless frozen DDI snapshots (variants/<slug>/ddi.xml) using the
 * locally built emitter (dist/index.js). Manual gate — codegen.py does NOT
 * touch these files, so the snapshot tests in src/test/ddi/ stay
 * non-tautological.
 *
 * Usage: npm run build && node scripts/bless-ddi-snapshots.mjs
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
const { buildDdiXml } = await import(pathToFileURL(entry).href);

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
for (const variant of variants) {
  const exDir = path.join(REPO_ROOT, variant.exampleDir ?? '');
  const src = path.join(exDir, 'xlsform.json');
  if (!variant.exampleDir || !fs.existsSync(src)) continue;

  const xlsform = JSON.parse(fs.readFileSync(src, 'utf-8'));
  const ddi = buildDdiXml(xlsform.survey ?? [], xlsform.choices ?? [], {
    assetName: path.basename(exDir),
  });
  fs.writeFileSync(path.join(exDir, 'ddi.xml'), ddi);
  console.log(
    `blessed ${variant['@id']} → ${path.relative(REPO_ROOT, exDir)}/ddi.xml`,
  );
  written++;
}

console.log(`\n${written} snapshots written.`);
console.log('Review with: git diff registry/*/ddi.xml');

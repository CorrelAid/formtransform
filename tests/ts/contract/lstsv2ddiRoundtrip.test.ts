/**
 * Round-trip parity: committed `tsv.tsv` → lstsv2ddi vs committed `ddi.xml`.
 *
 * With strict name validation, every registry example uses only LimeSurvey-legal
 * names/codes, so its TSV is a DDI-lossless projection and lstsv2ddi reproduces
 * the exact DDI that xlsform2ddi committed — for ALL entities, including:
 *   - grids (emitted as a LimeSurvey array F, reversed back to a grid varGrp),
 *   - external vocabularies (via the `cdlvocab-<id>` cssclass hint), and
 *   - the semi-open `_other` pattern (rebuilt from the native `other=Y` flag +
 *     the per-language `convention:other` label).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { lstsvToDdiXml } from '../../../src/pipelines/lstsv2ddi/index.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const REGISTRY_DIR = path.join(REPO_ROOT, 'registry', 'entities');

const PRODDATE_RE =
  /<prodDate date="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/prodDate>/;

function scrub(xml: string): string {
  return xml.replace(
    PRODDATE_RE,
    '<prodDate date="SCRUBBED">SCRUBBED</prodDate>',
  );
}

interface Case {
  id: string;
  dir: string;
}

function discoverCases(): Case[] {
  const cases: Case[] = [];
  for (const slug of fs.readdirSync(REGISTRY_DIR).sort()) {
    const dir = path.join(REGISTRY_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (
      fs.existsSync(path.join(dir, 'tsv.tsv')) &&
      fs.existsSync(path.join(dir, 'ddi.xml'))
    ) {
      cases.push({ id: slug, dir });
    }
  }
  return cases;
}

const cases = discoverCases();

describe('lstsv2ddi round-trip', () => {
  test('there are committed fixtures to compare against', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases)('$id matches committed ddi.xml', ({ id, dir }) => {
    const tsv = fs.readFileSync(path.join(dir, 'tsv.tsv'), 'utf-8');
    const committed = fs.readFileSync(path.join(dir, 'ddi.xml'), 'utf-8');
    // xlsform2ddi's snapshots use the folder name as the study title.
    const observed = lstsvToDdiXml(tsv, { assetName: id });
    expect(scrub(observed)).toBe(scrub(committed));
  });
});

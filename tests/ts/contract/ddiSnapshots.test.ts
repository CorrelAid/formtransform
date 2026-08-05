/**
 * Snapshot regression: emitter output vs the committed per-example `ddi.xml`.
 *
 * The committed fixtures are the parity oracle (blessed via
 * `npm run bless -- ddi`). Any diff = an emitter regression or an
 * intentional registry change that needs re-blessing. `prodDate` (build-time
 * wallclock) is scrubbed so the comparison stays meaningful across days.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';

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
  // One self-contained folder per example: registry/entities/<slug>/{fixtures/xlsform.json, ddi.xml, ...}
  const cases: Case[] = [];
  for (const slug of fs.readdirSync(REGISTRY_DIR).sort()) {
    const dir = path.join(REGISTRY_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (
      fs.existsSync(path.join(dir, 'fixtures', 'xlsform.json')) &&
      fs.existsSync(path.join(dir, 'ddi.xml'))
    ) {
      cases.push({ id: slug, dir });
    }
  }
  return cases;
}

const cases = discoverCases();

describe('DDI snapshot parity', () => {
  test('there are committed fixtures to compare against', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases)('$id matches committed ddi.xml', ({ dir }) => {
    const xlsform = JSON.parse(
      fs.readFileSync(path.join(dir, 'fixtures', 'xlsform.json'), 'utf-8'),
    );
    const committed = fs.readFileSync(path.join(dir, 'ddi.xml'), 'utf-8');

    const observed = buildDdiXml(xlsform.survey ?? [], xlsform.choices ?? [], {
      assetName: path.basename(dir),
    });

    expect(scrub(observed)).toBe(scrub(committed));
  });
});

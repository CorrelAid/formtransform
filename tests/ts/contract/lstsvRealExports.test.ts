/**
 * The LimeSurvey response data path on real exports (#95): each
 * `tests/live/limesurvey/expected/<slug>.json` is what a live LimeSurvey
 * stored after a respondent filled `registry/entities/<slug>/tsv.tsv`
 * (metadata columns removed). lstsv2ddi must turn it into a data CSV whose
 * header is exactly the DDI `<var>` names, with one case and every answer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  lstsvToDataCsv,
  lstsvToDdiXml,
} from '../../../src/pipelines/lstsv2ddi/index.js';
import { parseCsvRecords } from '../../../src/responseFile.js';

const ROOT = path.resolve(__dirname, '../../..');
const EXPECTED = path.join(ROOT, 'tests/live/limesurvey/expected');
const ENTITIES = path.join(ROOT, 'registry/entities');

const cases = fs
  .readdirSync(EXPECTED)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((slug) => fs.existsSync(path.join(ENTITIES, slug, 'tsv.tsv')))
  .sort();

const varNames = (xml: string) =>
  [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);

describe('LimeSurvey real exports → DDI data', () => {
  test('there are stored exports to read', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  test.each(cases)('%s', (slug) => {
    const tsv = fs.readFileSync(path.join(ENTITIES, slug, 'tsv.tsv'), 'utf-8');
    const stored = JSON.parse(
      fs.readFileSync(path.join(EXPECTED, `${slug}.json`), 'utf-8'),
    ) as Record<string, string>;

    const warnings: string[] = [];
    const xml = lstsvToDdiXml(tsv, { submissions: [stored] });
    const csv = lstsvToDataCsv(tsv, [stored], {
      onWarning: (m) => warnings.push(m),
    });
    const [header = [], ...rows] = parseCsvRecords(csv, ',');

    expect(header).toEqual(varNames(xml));
    expect(xml).toContain('<caseQnty>1</caseQnty>');
    expect(warnings).toEqual([]);
    if (header.length === 0) return; // a note-only survey has no data columns
    expect(rows).toHaveLength(1);

    // Every stored answer lands in the row: a select_multiple tick as its
    // `<q>_<code>` binary (DDI), a from_file tick as a code in the
    // space-joined value, anything else as the value itself.
    const cell = (name: string) => rows[0][header.indexOf(name)];
    for (const [key, value] of Object.entries(stored)) {
      if (value === '' || value === 'N') continue;
      const [, q, code] = /^(.+)\[([^\]]+)\]$/.exec(key) ?? [];
      if (value === 'Y' && q && header.includes(`${q}_${code}`)) {
        expect(cell(`${q}_${code}`), key).toBe('1');
      } else if (value === 'Y' && q) {
        expect(cell(q)?.split(' '), key).toContain(code);
      } else {
        const want = value === '-oth-' ? 'other' : value;
        expect(rows[0], `${key}=${value}`).toContain(want);
      }
    }
  });
});

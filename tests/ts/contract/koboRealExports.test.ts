/**
 * The Kobo response data path on real exports (#95): each
 * `tests/fixtures/surveys/<name>/kobo/` holds what a live KoboToolbox
 * exported after the survey's XLSForm was deployed and filled (see the
 * README there). xlsform2ddi must turn every export — the `/data/` JSON and
 * the CSV in each multiple-select and group-name setting — into a data CSV
 * whose header is exactly the DDI `<var>` names, one row per submission, and
 * the same rows whichever export it read.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  XLSLoader,
  buildDataCsv,
  choicesByListFromRows,
  extractVariables,
  parseResponses,
  xlsformToDdi,
} from '../../../src/index.js';
import type { Submission } from '../../../src/index.js';
import { parseCsvRecords } from '../../../src/responseFile.js';

const SURVEYS = path.resolve(__dirname, '../../fixtures/surveys');

const surveys = fs
  .readdirSync(SURVEYS)
  .filter((name) => fs.existsSync(path.join(SURVEYS, name, 'kobo')))
  .sort();

type Row = Record<string, unknown>;

function loadForm(name: string): {
  surveyData: Row[];
  choicesData: Row[];
  settingsData: Row[];
} {
  const dir = path.join(SURVEYS, name);
  const xlsx = path.join(dir, 'xlsform.xlsx');
  if (fs.existsSync(xlsx)) {
    return XLSLoader.parseXLSData(fs.readFileSync(xlsx), {
      skipValidation: true,
    });
  }
  const json = JSON.parse(
    fs.readFileSync(path.join(dir, 'xlsform.json'), 'utf-8'),
  ) as { survey: Row[]; choices: Row[]; settings: Row[] };
  return {
    surveyData: json.survey,
    choicesData: json.choices,
    settingsData: json.settings,
  };
}

const varNames = (xml: string) =>
  [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);

/** Kobo's own bookkeeping, not answers: `_id`, `_uuid`, `meta/…`, … */
const isKoboMeta = (key: string) =>
  key.startsWith('_') || key.startsWith('meta/') || key.startsWith('formhub/');

/** XLSForm metadata types: answered by the device, no DDI variable. */
const METADATA_TYPES = new Set([
  'start',
  'end',
  'today',
  'deviceid',
  'username',
  'audit',
]);

describe.each(surveys)('Kobo real exports → DDI data: %s', (name) => {
  const dir = path.join(SURVEYS, name, 'kobo');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv') || f.endsWith('.json'))
    .sort();
  const form = loadForm(name);
  const variables = extractVariables(
    form.surveyData as never,
    choicesByListFromRows(form.choicesData),
  );
  const json = parseResponses(
    fs.readFileSync(path.join(dir, 'data.json'), 'utf-8'),
    'data.json',
  );

  const convert = (file: string) => {
    const rows = parseResponses(
      fs.readFileSync(path.join(dir, file), 'utf-8'),
      file,
    );
    // Only data warnings count: the form's own diagnostics (a reserved
    // `_other` suffix, a dropped hint) are not about the export.
    const warnings: string[] = [];
    const xml = xlsformToDdi(form as never, {
      submissions: rows,
      onWarning: () => {},
    });
    const csv = buildDataCsv(variables, rows, {
      onWarning: (m) => warnings.push(m),
    });
    return { rows, xml, csv, warnings };
  };

  test('there are exports to read', () => {
    expect(files).toContain('data.json');
    expect(files.filter((f) => f.endsWith('.csv')).length).toBe(6);
  });

  test.each(files)('%s: header, caseQnty, no warnings', (file) => {
    const { xml, csv, warnings } = convert(file);
    const [header = [], ...rows] = parseCsvRecords(csv, ',');
    expect(header).toEqual(varNames(xml));
    expect(xml).toContain(`<caseQnty>${json.length}</caseQnty>`);
    expect(rows).toHaveLength(json.length);
    expect(warnings).toEqual([]);
  });

  test.each(files.filter((f) => f !== 'data.json'))(
    '%s: same data as the JSON export',
    (file) => {
      expect(convert(file).csv).toBe(convert('data.json').csv);
    },
  );

  test('every JSON answer lands in its DDI column', () => {
    const { csv } = convert('data.json');
    const [header = [], ...rows] = parseCsvRecords(csv, ',');
    const typeOf = (q: string) =>
      String(form.surveyData.find((r) => r['name'] === q)?.['type'] ?? '');
    json.forEach((submission: Submission, i) => {
      const cell = (col: string) => rows[i][header.indexOf(col)];
      for (const [key, value] of Object.entries(submission)) {
        if (isKoboMeta(key) || key === '__version__') continue;
        const q = key.split('/').pop() as string;
        const v = variables.find((x) => x.name === q);
        if (!v || v.row !== undefined) {
          // A metadata row is described (cdl:row), it has no column.
          expect(METADATA_TYPES, `${i}:${key}`).toContain(typeOf(q));
        } else if (v.type === 'select_multiple') {
          const picked = String(value).split(' ');
          const hasOtherText = variables.some((x) => x.name === `${q}_other`);
          for (const c of v.choices) {
            // An or_other's "other" has no binary: its `<q>_other` text
            // column (same name) carries it, checked as a plain answer.
            if (c.name === 'other' && hasOtherText) continue;
            expect(cell(`${q}_${c.name}`), `${i}:${key}/${c.name}`).toBe(
              picked.includes(c.name) ? '1' : '0',
            );
          }
        } else {
          expect(cell(q), `${i}:${key}`).toBe(value);
        }
      }
    });
  });
});

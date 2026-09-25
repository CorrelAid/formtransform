/**
 * `formtransform xlsform2ddi --data` and `lstsv2ddi --data` end to end: runs
 * the built CLI against inputs whose bucketed `<var>` order differs from survey
 * order — the case where header/XML drift would show.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const CLI = join(ROOT, 'dist/cli.js');

const SHEETS = {
  survey: [
    { type: 'begin_group', name: 'demo', label: 'Demographics' },
    { type: 'text', name: 'fullname', label: 'Name' },
    { type: 'integer', name: 'age', label: 'Age' },
    { type: 'select_one gender', name: 'gender', label: 'Gender' },
    { type: 'end_group' },
    { type: 'begin_group', name: 'prefs', label: 'Preferences' },
    { type: 'select_multiple colors', name: 'colors', label: 'Colors' },
    { type: 'text', name: 'comments', label: 'Comments' },
    { type: 'end_group' },
    { type: 'date', name: 'day', label: 'Date' },
  ],
  choices: [
    { list_name: 'gender', name: 'male', label: 'Male' },
    { list_name: 'gender', name: 'feml', label: 'Female' },
    { list_name: 'colors', name: 'red', label: 'Red' },
    { list_name: 'colors', name: 'blue', label: 'Blue' },
    { list_name: 'colors', name: 'green', label: 'Green' },
  ],
  settings: [{ form_title: 'CLI data test', default_language: 'en' }],
};

let dir: string;
let form: string;

function runCmd(cmd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, cmd, ...args], {
    cwd: dir,
    encoding: 'utf-8',
  });
}

const run = (...args: string[]) => runCmd('xlsform2ddi', args);

function xmlVarNames(xml: string): string[] {
  return [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);
}

const caseQnty = (xml: string) => xml.match(/<caseQnty>(\d+)<\/caseQnty>/)?.[1];
const fileUri = (xml: string) =>
  xml.match(/<fileDscr ID="F1" URI="([^"]*)"/)?.[1];
const fileName = (xml: string) =>
  xml.match(/<fileName>([^<]*)<\/fileName>/)?.[1];
const csvHeader = (csv: string) => csv.split('\r\n')[0].split(',');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ft-cli-'));
  const wb = XLSX.utils.book_new();
  for (const sheet of ['survey', 'choices', 'settings']) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(SHEETS[sheet as keyof typeof SHEETS]),
      sheet,
    );
  }
  form = join(dir, 'form.xlsx');
  XLSX.writeFile(wb, form);

  writeFileSync(
    join(dir, 'responses.csv'),
    'fullname;age;gender;colors;comments;day\n' +
      'Ada;36;feml;red green;"likes, commas";2026-01-02\n' +
      'Bob;41;male;;;2026-01-03\n',
  );
  writeFileSync(
    join(dir, 'submissions.json'),
    JSON.stringify([
      {
        'demo/fullname': 'Ada',
        'prefs/colors': 'blue',
      },
      { 'demo/fullname': 'Bob' },
      { 'demo/fullname': 'Cy' },
    ]),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('xlsform2ddi --data', () => {
  test('CSV input: data.csv beside the XML, caseQnty and header match the XML', () => {
    const r = run(form, '-o', 'out/codebook.xml', '--data', 'responses.csv');
    // `out/` does not exist → the write must fail loudly, not silently.
    expect(r.status).not.toBe(0);

    const ok = run(form, '-o', 'codebook.xml', '--data', 'responses.csv');
    expect(ok.status, ok.stderr).toBe(0);
    const xml = readFileSync(join(dir, 'codebook.xml'), 'utf-8');
    const csv = readFileSync(join(dir, 'data.csv'), 'utf-8');

    expect(caseQnty(xml)).toBe('2');
    expect(fileUri(xml)).toBe('data.csv');
    expect(fileName(xml)).toBe('data.csv');
    expect(csvHeader(csv)).toEqual(xmlVarNames(xml));
    expect(csv).toContain('1,0,1,Ada,36,feml,"likes, commas",2026-01-02');
  });

  test('Kobo JSON with group paths; --dataset-filename drives the default path', () => {
    const r = run(
      form,
      '-o',
      'kobo.xml',
      '--data',
      'submissions.json',
      '--dataset-filename',
      'abc.csv',
    );
    expect(r.status, r.stderr).toBe(0);
    const xml = readFileSync(join(dir, 'kobo.xml'), 'utf-8');
    const csv = readFileSync(join(dir, 'abc.csv'), 'utf-8');

    expect(caseQnty(xml)).toBe('3');
    expect(fileUri(xml)).toBe('abc.csv');
    expect(csvHeader(csv)).toEqual(xmlVarNames(xml));
    expect(csv.split('\r\n')[1]).toMatch(/^0,1,0,Ada,/);
  });

  test('--data-out names the file and the recorded URI', () => {
    const r = run(
      form,
      '--data',
      'responses.csv',
      '--data-out',
      'resp_2026.csv',
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fileUri(r.stdout)).toBe('resp_2026.csv');
    expect(existsSync(join(dir, 'resp_2026.csv'))).toBe(true);
  });

  test('XML on stdout without --data-out is an error, not a dropped CSV', () => {
    const r = run(form, '--data', 'responses.csv');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--data-out/);
    expect(r.stdout).toBe('');
  });

  test('--data-out without --data is an error', () => {
    const r = run(form, '--data-out', 'x.csv');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/requires --data/);
  });

  test('without --data, caseQnty stays 0 and no CSV is written', () => {
    const r = run(form);
    expect(r.status, r.stderr).toBe(0);
    expect(caseQnty(r.stdout)).toBe('0');
  });

  test('--help documents both flags', () => {
    const r = run('--help');
    expect(r.stdout).toMatch(/--data <file>/);
    expect(r.stdout).toMatch(/--data-out <file>/);
  });
});

describe('lstsv2ddi --data', () => {
  const TSV = join(ROOT, 'tests/fixtures/surveys/all_types_survey/tsv.tsv');

  beforeAll(() => {
    writeFileSync(
      join(dir, 'ls_export.csv'),
      'id,submitdate,qtext,qselectmulti[red],qselectmulti[green],matrixheader[skilljs],qsel1other,qsel1other[other]\r\n' +
        '1,2026-01-01,hi,Y,,adv,-oth-,teal\r\n' +
        '2,2026-01-02,,,Y,none,red,\r\n',
    );
  });

  test('LimeSurvey export → caseQnty, URI and a header matching the XML', () => {
    const r = runCmd('lstsv2ddi', [
      TSV,
      '-o',
      'ls.xml',
      '--data',
      'ls_export.csv',
    ]);
    expect(r.status, r.stderr).toBe(0);
    const xml = readFileSync(join(dir, 'ls.xml'), 'utf-8');
    const csv = readFileSync(join(dir, 'data.csv'), 'utf-8');
    expect(caseQnty(xml)).toBe('2');
    expect(fileUri(xml)).toBe('data.csv');
    expect(csvHeader(csv)).toEqual(xmlVarNames(xml));

    const cols = csvHeader(csv);
    const row = csv.split('\r\n')[1].split(',');
    const at = (n: string) => row[cols.indexOf(n)];
    expect(at('skilljs')).toBe('adv');
    expect(at('qselectmulti_red')).toBe('1');
    expect(at('qselectmulti_green')).toBe('0');
    expect(at('qsel1other')).toBe('other');
    expect(at('qsel1other_other')).toBe('teal');
    expect(at('qtext')).toBe('hi');
  });

  test('an unknown option code warns on stderr', () => {
    writeFileSync(join(dir, 'ls_bad.csv'), 'qselectmulti[SQ001]\nY\n');
    const r = runCmd('lstsv2ddi', [
      TSV,
      '--data',
      'ls_bad.csv',
      '--data-out',
      'bad.csv',
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/warning: .*qselectmulti\[SQ001\]/);
  });

  test('--help documents both flags', () => {
    const r = runCmd('lstsv2ddi', ['--help']);
    expect(r.stdout).toMatch(/--data <file>/);
    expect(r.stdout).toMatch(/--data-out <file>/);
  });
});

describe('xlsform2ddi subset check (#52)', () => {
  function writeForm(
    name: string,
    survey: Record<string, unknown>[],
    choices: Record<string, unknown>[],
  ): string {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(survey),
      'survey',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(choices),
      'choices',
    );
    const path = join(dir, name);
    XLSX.writeFile(wb, path);
    return path;
  }

  test('accepts Kobo names and long codes that LimeSurvey would reject', () => {
    const f = writeForm(
      'kobo.xlsx',
      [{ type: 'select_one freq', name: 'how_often', label: 'How often' }],
      [{ list_name: 'freq', name: 'sometimes', label: 'Sometimes' }],
    );
    const r = run(f, '-o', join(dir, 'kobo.xml'));
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'kobo.xml'), 'utf-8')).toContain(
      'name="how_often"',
    );
  });

  test('rejects an unregistered type unless --skip-validation', () => {
    const f = writeForm(
      'geo.xlsx',
      [{ type: 'geopoint', name: 'loc', label: 'Where' }],
      [{ list_name: 'x', name: 'a', label: 'A' }],
    );
    const r = run(f, '-o', join(dir, 'geo.xml'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /type "geopoint" \(question "loc"\) is not in the registry/,
    );
    expect(existsSync(join(dir, 'geo.xml'))).toBe(false);

    expect(run(f, '-o', join(dir, 'geo.xml'), '--skip-validation').status).toBe(
      0,
    );
  });

  test('validate --target ddi', () => {
    const f = writeForm(
      'kobo2.xlsx',
      [{ type: 'text', name: 'full_name', label: 'Name' }],
      [{ list_name: 'x', name: 'a', label: 'A' }],
    );
    expect(runCmd('validate', ['--target', 'ddi', f]).status).toBe(0);
    expect(runCmd('validate', [f]).status).toBe(1);
  });
});

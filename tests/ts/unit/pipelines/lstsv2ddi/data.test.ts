/** LimeSurvey response export → DDI data CSV: key matching and quirks. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  lstsvToDataCsv,
  lstsvToDdiXml,
  lstsvToVariables,
  normalizeLimeSurveyResponses,
  parseLstsv,
} from '../../../../../src/pipelines/lstsv2ddi/index.js';
import { normKey } from '../../../../../src/pipelines/lstsv2ddi/data.js';
import type { Variable } from '../../../../../src/ddi/types.js';

const TSV = readFileSync(
  join(__dirname, '../../../../fixtures/surveys/all_types_survey/tsv.tsv'),
  'utf-8',
);
const VARS = lstsvToVariables(parseLstsv(TSV));

function v(
  partial: Partial<Variable> & { name: string; type: string },
): Variable {
  return {
    label: '',
    group: '',
    groupLabel: '',
    groupAppearance: '',
    listName: '',
    vocab: '',
    choices: [],
    ...partial,
  };
}

const norm = (row: Record<string, unknown>) =>
  normalizeLimeSurveyResponses(VARS, [row])[0];

function xmlVarNames(xml: string): string[] {
  return [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);
}

describe('normKey', () => {
  test('strips underscores and lowercases', () => {
    expect(normKey('Beruf_Post')).toBe('berufpost');
  });
});

describe('normalizeLimeSurveyResponses', () => {
  test('scalar columns match despite case and underscore mangling', () => {
    const row = norm({
      QTEXT: 'hi',
      q_integer: '4',
      id: '17',
      submitdate: 'x',
    });
    expect(row.qtext).toBe('hi');
    expect(row.qinteger).toBe('4');
    expect(row).not.toHaveProperty('id');
  });

  test('multiple choice: Y columns become space-joined codes', () => {
    const row = norm({
      'qselectmulti[red]': 'Y',
      'qselectmulti[blue]': '',
      'qselectmulti[green]': 'y',
    });
    expect(row.qselectmulti).toBe('red green');
  });

  test('array subquestions fill the grid variables', () => {
    const row = norm({
      'matrixheader[skillpython]': 'adv',
      'matrixheader[SKILLJS]': 'none',
    });
    expect(row.skillpython).toBe('adv');
    expect(row.skilljs).toBe('none');
    expect(row.skillsql).toBe('');
  });

  test('list with native other: -oth- and q[other] text', () => {
    const row = norm({ qsel1other: '-oth-', 'qsel1other[other]': 'teal' });
    expect(row.qsel1other).toBe('other');
    expect(row.qsel1other_other).toBe('teal');
  });

  test('multiple choice with native other: text ticks other', () => {
    const row = norm({ 'qselmother[red]': 'Y', 'qselmother[other]': 'teal' });
    expect(row.qselmother).toBe('red other');
    expect(row.qselmother_other).toBe('teal');
  });

  test('an authored companion column (qother) is read as the other text', () => {
    expect(norm({ qsel1otherother: 'teal' }).qsel1other_other).toBe('teal');
  });

  test('truncated option codes are recovered by prefix', () => {
    const multi = v({
      name: 'mat',
      type: 'select_multiple',
      choices: [
        { name: 'metall', label: 'Metall' },
        { name: 'holz', label: 'Holz' },
      ],
    });
    const [row] = normalizeLimeSurveyResponses(
      [multi],
      [{ 'mat[metal]': 'Y' }],
    );
    expect(row.mat).toBe('metall');
  });

  test('ambiguous truncated codes throw rather than guess', () => {
    const multi = v({
      name: 'm',
      type: 'select_multiple',
      choices: [
        { name: 'abcdef', label: '' },
        { name: 'abcdeg', label: '' },
      ],
    });
    expect(() =>
      normalizeLimeSurveyResponses([multi], [{ 'm[abcde]': 'Y' }]),
    ).toThrow(/ambiguous/);
  });

  test('an unknown option code warns once and is dropped', () => {
    const warnings: string[] = [];
    const rows = normalizeLimeSurveyResponses(
      VARS,
      [{ 'qselectmulti[SQ001]': 'Y' }, { 'qselectmulti[SQ001]': 'Y' }],
      { onWarning: (m) => warnings.push(m) },
    );
    expect(rows[0].qselectmulti).toBe('');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/qselectmulti\[SQ001\]/);
  });
});

describe('lstsvToDataCsv', () => {
  test('header equals the <var name=""> order of lstsvToDdiXml', () => {
    const csv = lstsvToDataCsv(TSV, []);
    expect(csv.split('\r\n')[0].split(',')).toEqual(
      xmlVarNames(lstsvToDdiXml(TSV)),
    );
  });

  test('a full row lands in the right columns', () => {
    const csv = lstsvToDataCsv(TSV, [
      {
        'matrixheader[skillpython]': 'exp',
        'qselectmulti[blue]': 'Y',
        qsel1other: 'red',
        'qselmother[other]': 'teal',
        qtext: 'a, b',
      },
    ]);
    const [header, line] = csv.split('\r\n');
    const cols = header.split(',');
    const cells = line
      .match(/("([^"]|"")*"|[^,]*)(,|$)/g)!
      .map((c) => c.replace(/,$/, ''));
    const at = (name: string) => cells[cols.indexOf(name)];
    expect(at('skillpython')).toBe('exp');
    expect(at('qselectmulti_blue')).toBe('1');
    expect(at('qselectmulti_red')).toBe('0');
    expect(at('qsel1other')).toBe('red');
    expect(at('qselmother_other')).toBe('teal');
    expect(at('qtext')).toBe('"a, b"');
  });
});

describe('normalizeLimeSurveyResponses — export quirks (#106)', () => {
  const vars = [
    v({
      name: 'col',
      type: 'select_one',
      choices: [
        { name: 'r', label: 'Red' },
        { name: 'g', label: 'Green' },
      ],
    }),
    v({
      name: 'sm',
      type: 'select_multiple',
      choices: [
        { name: 'a', label: 'A' },
        { name: 'b', label: 'B' },
        { name: 'c', label: 'C' },
        { name: 'd', label: 'D' },
      ],
    }),
    v({ name: 'txt', type: 'text' }),
  ];
  const one = (row: Record<string, unknown>) =>
    normalizeLimeSurveyResponses(vars, [row])[0];

  test('N/A passes through as a literal select_one value', () => {
    expect(one({ col: 'N/A' }).col).toBe('N/A');
  });

  test('ticked forms Y / yes / 1 / true count, anything else does not', () => {
    const row = one({
      'sm[a]': 'Y',
      'sm[b]': 'yes',
      'sm[c]': 1,
      'sm[d]': true,
    });
    expect(row.sm).toBe('a b c d');
    expect(
      one({ 'sm[a]': 'N', 'sm[b]': '', 'sm[c]': 0, 'sm[d]': null }).sm,
    ).toBe('');
  });

  test('null / undefined values become empty', () => {
    const row = one({ col: null, txt: undefined });
    expect(row).toEqual({ col: '', sm: '', txt: '' });
  });

  test('_comment, token and lastpage columns are ignored', () => {
    const row = one({
      col: 'r',
      col_comment: 'why',
      'sm[a]': 'Y',
      'sm[a_comment]': 'because',
      token: 'abc',
      lastpage: '2',
      startlanguage: 'de',
    });
    expect(row).toEqual({ col: 'r', sm: 'a', txt: '' });
  });
});

/** Response-data CSV emitter — column plan, binary expansion, RFC 4180 output. */
import { describe, test, expect } from 'vitest';

import {
  buildDataCsv,
  getDdiColumnNames,
  remapSubmissionsToDdi,
} from '../../../../src/ddi/data.js';
import {
  buildDdiXml,
  extractVariables,
  choicesByListFromRows,
} from '../../../../src/pipelines/xlsform2ddi/index.js';
import type { Variable } from '../../../../src/ddi/types.js';

type Row = Record<string, unknown>;

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

/** `<var name="">` values in document order. */
function xmlVarNames(xml: string): string[] {
  return [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);
}

function variablesOf(survey: Row[], choices: Row[]): Variable[] {
  return extractVariables(survey, choicesByListFromRows(choices));
}

const multiVar = v({
  name: 'colors',
  type: 'select_multiple',
  label: 'Colors',
  listName: 'colors',
  choices: [
    { name: 'red', label: 'Red' },
    { name: 'blue', label: 'Blue' },
  ],
});

describe('getDdiColumnNames', () => {
  test('one column per non-categorical variable, in order', () => {
    const cols = getDdiColumnNames([
      v({ name: 'q1', type: 'text' }),
      v({ name: 'q2', type: 'integer' }),
    ]);
    expect(cols).toEqual(['q1', 'q2']);
  });

  test('expands select_multiple into one binary column per choice', () => {
    expect(getDdiColumnNames([multiVar])).toEqual([
      'colors_red',
      'colors_blue',
    ]);
  });

  test('skips note variables — they carry no data', () => {
    const cols = getDdiColumnNames([
      v({ name: 'intro', type: 'note', label: 'Hello' }),
      v({ name: 'q1', type: 'text' }),
    ]);
    expect(cols).toEqual(['q1']);
  });

  test('matches the DDI XML <var name> order for a mixed survey', () => {
    const survey: Row[] = [
      { type: 'note', name: 'intro', label: 'Welcome' },
      { type: 'text', name: 'q_free', label: 'Free text' },
      { type: 'select_multiple colors', name: 'colors', label: 'Colors' },
      {
        type: 'begin_group',
        name: 'grid',
        label: 'Grid',
        appearance: 'field-list',
      },
      { type: 'select_one likert', name: 'g1', label: 'G1' },
      { type: 'select_one likert', name: 'g2', label: 'G2' },
      { type: 'end_group', name: 'grid' },
      { type: 'select_one colors or_other', name: 'fav', label: 'Favourite' },
      { type: 'integer', name: 'age', label: 'Age' },
    ];
    const choices: Row[] = [
      { list_name: 'colors', name: 'red', label: 'Red' },
      { list_name: 'colors', name: 'blue', label: 'Blue' },
      { list_name: 'likert', name: '1', label: 'Low' },
      { list_name: 'likert', name: '2', label: 'High' },
    ];
    const variables = variablesOf(survey, choices);
    const xml = buildDdiXml(survey, choices);
    expect(getDdiColumnNames(variables)).toEqual(xmlVarNames(xml));
  });
});

describe('remapSubmissionsToDdi', () => {
  test('binary columns are "1" for selected choices, "0" otherwise', () => {
    const rows = remapSubmissionsToDdi([multiVar], [{ colors: 'blue' }]);
    expect(rows).toEqual([{ colors_red: '0', colors_blue: '1' }]);
  });

  test('splits space-joined select_multiple values', () => {
    const rows = remapSubmissionsToDdi([multiVar], [{ colors: 'red blue' }]);
    expect(rows[0]).toEqual({ colors_red: '1', colors_blue: '1' });
  });

  test('an empty or missing select_multiple selects nothing', () => {
    const rows = remapSubmissionsToDdi([multiVar], [{ colors: '' }, {}]);
    expect(rows[0]).toEqual({ colors_red: '0', colors_blue: '0' });
    expect(rows[1]).toEqual({ colors_red: '0', colors_blue: '0' });
  });

  test('null and undefined become empty strings, never "None"', () => {
    const vars = [
      v({ name: 'q1', type: 'text' }),
      v({ name: 'q2', type: 'text' }),
    ];
    const rows = remapSubmissionsToDdi(vars, [{ q1: null, q2: undefined }]);
    expect(rows[0]).toEqual({ q1: '', q2: '' });
  });

  test('stringifies numbers and booleans', () => {
    const vars = [
      v({ name: 'n', type: 'integer' }),
      v({ name: 'b', type: 'text' }),
    ];
    const rows = remapSubmissionsToDdi(vars, [{ n: 42, b: true }]);
    expect(rows[0]).toEqual({ n: '42', b: 'true' });
  });

  test('falls back to the group/name path key', () => {
    const vars = [v({ name: 'q1', type: 'text', group: 'sec/sub' })];
    const rows = remapSubmissionsToDdi(vars, [{ 'sec/sub/q1': 'from path' }]);
    expect(rows[0]).toEqual({ q1: 'from path' });
  });

  test('the bare name wins when a row carries both keys', () => {
    const vars = [v({ name: 'q1', type: 'text', group: 'sec' })];
    const rows = remapSubmissionsToDdi(vars, [
      { q1: 'bare', 'sec/q1': 'path' },
    ]);
    expect(rows[0]).toEqual({ q1: 'bare' });
  });

  test('preserves submission order', () => {
    const vars = [v({ name: 'q1', type: 'text' })];
    const rows = remapSubmissionsToDdi(vars, [{ q1: 'a' }, { q1: 'b' }]);
    expect(rows.map((r) => r.q1)).toEqual(['a', 'b']);
  });
});

describe('buildDataCsv', () => {
  test('emits a CRLF-terminated header row and one row per submission', () => {
    const vars = [
      v({ name: 'q1', type: 'text' }),
      v({ name: 'q2', type: 'integer' }),
    ];
    const csv = buildDataCsv(vars, [
      { q1: 'a', q2: 1 },
      { q1: 'b', q2: 2 },
    ]);
    expect(csv).toBe('q1,q2\r\na,1\r\nb,2\r\n');
  });

  test('emits only the header when there are no submissions', () => {
    expect(buildDataCsv([v({ name: 'q1', type: 'text' })], [])).toBe('q1\r\n');
  });

  test('quotes only fields containing a delimiter, quote, or line break', () => {
    const vars = [
      v({ name: 'plain', type: 'text' }),
      v({ name: 'comma', type: 'text' }),
      v({ name: 'quote', type: 'text' }),
      v({ name: 'newline', type: 'text' }),
    ];
    const csv = buildDataCsv(vars, [
      {
        plain: 'no quoting needed',
        comma: 'a,b',
        quote: 'say "hi"',
        newline: 'line1\nline2',
      },
    ]);
    expect(csv).toBe(
      'plain,comma,quote,newline\r\n' +
        'no quoting needed,"a,b","say ""hi""","line1\nline2"\r\n',
    );
  });

  test('uses CRLF exclusively for row separation', () => {
    const csv = buildDataCsv([v({ name: 'q1', type: 'text' })], [{ q1: 'x' }]);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('expands select_multiple to binary columns in the header', () => {
    const csv = buildDataCsv([multiVar], [{ colors: 'red' }]);
    expect(csv).toBe('colors_red,colors_blue\r\n1,0\r\n');
  });

  test('an _other multi pattern drops the other binary and keeps the text column', () => {
    const survey: Row[] = [
      { type: 'select_multiple colors', name: 'colors', label: 'Colors' },
      { type: 'text', name: 'colors_other', label: 'Other' },
    ];
    const choices: Row[] = [
      { list_name: 'colors', name: 'red', label: 'Red' },
      { list_name: 'colors', name: 'other', label: 'Other' },
    ];
    const variables = variablesOf(survey, choices);
    const csv = buildDataCsv(variables, [
      { colors: 'red other', colors_other: 'teal' },
    ]);
    expect(csv).toBe('colors_red,colors_other\r\n1,teal\r\n');
    expect(getDdiColumnNames(variables)).toEqual(
      xmlVarNames(buildDdiXml(survey, choices)),
    );
  });
});

describe('buildDataCsv — a one-column empty row', () => {
  test('is written as "" so readers keep the case', () => {
    const csv = buildDataCsv([v({ name: 'q', type: 'text' })], [{ q: '' }]);
    expect(csv).toBe('q\r\n""\r\n');
  });
});

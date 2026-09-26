/** Reverse-path subset validation for LimeSurvey TSV → DDI. */
import { describe, test, expect } from 'vitest';

import { lstsvToDdiXml } from '../../../../src/pipelines/lstsv2ddi/index.js';
import { validateLstsvSubset } from '../../../../src/lstsv/validate.js';

type Row = Record<string, string>;
/** A row with every required column (see REQUIRED_COLUMNS). */
function row(fields: Partial<Row> & Pick<Row, 'class'>): Row {
  return {
    'type/scale': '',
    name: '',
    text: '',
    language: 'en',
    ...fields,
  } as Row;
}

describe('validateLstsvSubset', () => {
  // `!` (dropdown list) regressed once: keep it on the list.
  test('supported question codes produce no violations', () => {
    const rows = ['L', '!', 'M', 'N', 'D', 'S', 'T', 'X', 'F'].map((c, i) =>
      row({ class: 'Q', 'type/scale': c, name: `q${i}` }),
    );
    expect(validateLstsvSubset(rows)).toEqual([]);
  });

  test('an unsupported code (e.g. ranking R) is an error', () => {
    const v = validateLstsvSubset([
      row({ class: 'Q', 'type/scale': 'R', name: 'ranked' }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('error');
    expect(v[0].code).toBe('lstsv-outside-subset');
    expect(v[0].message).toMatch(
      /unsupported LimeSurvey question type "R".*ranked/,
    );
  });

  test('non-Q rows are ignored', () => {
    expect(
      validateLstsvSubset([
        row({ class: 'S', name: 'language', text: 'en' }),
        row({ class: 'G', name: 'Group' }),
        row({ class: 'A', name: 'a1', text: 'A' }),
      ]),
    ).toEqual([]);
  });
});

describe('lstsvToDdiXml — reverse validation', () => {
  const tsv = [
    'class\ttype/scale\tname\ttext\tlanguage',
    'S\t\tlanguage\ten\ten',
    'Q\tR\tranked\tRank these\ten',
  ].join('\n');

  test('throws on an unsupported question type by default', () => {
    expect(() => lstsvToDdiXml(tsv)).toThrow(
      /outside the transformable subset/,
    );
  });

  test('skipValidation bypasses the check', () => {
    expect(() => lstsvToDdiXml(tsv, { skipValidation: true })).not.toThrow();
  });
});

describe('structure problems (#100)', () => {
  test('an unknown row class warns once', () => {
    const v = validateLstsvSubset([
      row({ class: 'Z', name: 'x' }),
      row({ class: 'Z', name: 'y' }),
    ]);
    expect(v).toEqual([
      expect.objectContaining({
        code: 'lstsv-outside-subset',
        severity: 'warning',
      }),
    ]);
  });

  test('a missing required column is an error', () => {
    const v = validateLstsvSubset([{ class: 'Q', name: 'q' } as Row]);
    expect(v[0]).toMatchObject({ code: 'column-missing', severity: 'error' });
    expect(v[0].message).toContain('type/scale');
  });

  test('a TSV with a BOM and CRLF line ends converts', () => {
    const tsv =
      '﻿class\ttype/scale\tname\trelevance\ttext\thelp\tlanguage\r\n' +
      'S\t\tlanguage\t1\ten\t\ten\r\n' +
      'G\t\tG1\t1\t\t\ten\r\n' +
      'Q\tS\tq1\t1\tName?\t\ten\r\n';
    expect(lstsvToDdiXml(tsv)).toMatch(/<var [^>]*name="q1"/);
  });
});

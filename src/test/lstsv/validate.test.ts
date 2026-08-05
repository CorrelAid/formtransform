/** Reverse-path subset validation for LimeSurvey TSV → DDI. */
import { describe, test, expect } from 'vitest';

import { lstsvToDdiXml } from '../../pipelines/lstsv2ddi/index.js';
import { validateLstsvSubset } from '../../lstsv/validate.js';

type Row = Record<string, string>;
function row(fields: Partial<Row> & Pick<Row, 'class'>): Row {
  return { language: 'en', ...fields } as Row;
}

describe('validateLstsvSubset', () => {
  test('supported question codes produce no violations', () => {
    const rows = ['L', 'M', 'N', 'D', 'S', 'T', 'X', 'F'].map((c, i) =>
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

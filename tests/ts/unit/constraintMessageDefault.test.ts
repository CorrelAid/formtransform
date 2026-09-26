/** constraint_message and select defaults reach LimeSurvey (#103). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

// skipValidation: codes like `very_good` are sanitized (→ `veryg`), which is
// exactly where a raw default would miss.
async function convert(survey: Row[], choices: Row[] = []) {
  const tsv = await xlsformToLstsv(
    { surveyData: survey as never, choicesData: choices as never },
    { skipValidation: true },
  );
  return { tsv, rows: parseTSV(tsv) };
}

const choices = [
  { list_name: 'l', name: 'very_good', label: 'Sehr gut' },
  { list_name: 'l', name: 'bad', label: 'Schlecht' },
  { list_name: 'l', name: 'okay', label: 'Okay' },
];

describe('constraint_message', () => {
  test('becomes em_validation_q_tip, per language', async () => {
    const { rows } = await convert([
      {
        type: 'integer',
        name: 'age',
        label: { de: 'Alter?', en: 'Age?' },
        constraint: '. > 0',
        constraint_message: { de: 'Muss positiv sein', en: 'Must be positive' },
        _languages: ['de', 'en'],
      },
    ]).then((r) => r);
    const q = rows.filter((r) => r.class === 'Q' && r.name === 'age');
    expect(q.map((r) => [r.language, r.em_validation_q_tip])).toEqual([
      ['en', 'Must be positive'],
      ['de', 'Muss positiv sein'],
    ]);
    expect(q[0].validation).toBe('');
  });

  test('round-trips through lstsv2xlsform', async () => {
    const { tsv } = await convert([
      {
        type: 'integer',
        name: 'age',
        label: 'Age?',
        constraint: '. > 0',
        constraint_message: 'Must be positive',
      },
    ]);
    expect(lstsvToXlsform(tsv).survey[0]).toMatchObject({
      constraint: '. > 0',
      constraint_message: 'Must be positive',
    });
  });
});

describe('select defaults', () => {
  test('a select_one default is the emitted answer code', async () => {
    const { rows } = await convert(
      [{ type: 'select_one l', name: 'q', label: 'Q?', default: 'very_good' }],
      choices,
    );
    const code = rows.find(
      (r) => r.class === 'A' && r.text === 'Sehr gut',
    )?.name;
    expect(code).toBe('veryg');
    expect(rows.find((r) => r.class === 'Q')?.default).toBe(code);
  });

  test('a select_multiple default ticks its SQ rows; round-trips', async () => {
    const { tsv, rows } = await convert(
      [
        {
          type: 'select_multiple l',
          name: 'q',
          label: 'Q?',
          default: 'very_good okay',
        },
      ],
      choices,
    );
    const sq = rows.filter((r) => r.class === 'SQ');
    expect(sq.map((r) => [r.name, r.default])).toEqual([
      ['veryg', 'Y'],
      ['bad', ''],
      ['okay', 'Y'],
    ]);
    expect(rows.find((r) => r.class === 'Q')?.default).toBe('');
    expect(
      lstsvToXlsform(tsv, { skipValidation: true }).survey[0].default,
    ).toBe('veryg okay');
  });

  test('other defaults pass through', async () => {
    const { rows } = await convert([
      { type: 'integer', name: 'n', label: 'N?', default: '3' },
    ]);
    expect(rows.find((r) => r.class === 'Q')?.default).toBe('3');
  });
});

/** XLSForm → LimeSurvey branches that were hit without an assertion (#108). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { TypeMapper } from '../../../src/internals.js';
import {
  parameterAttributes,
  parseParameters,
} from '../../../src/pipelines/xlsform2lstsv/parameters.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

async function convert(survey: Row[], choices: Row[] = []) {
  const warnings: Diagnostic[] = [];
  const tsv = await xlsformToLstsv(
    { surveyData: survey as never, choicesData: choices as never },
    { skipValidation: true, onWarning: (w) => warnings.push(w) },
  );
  return { rows: parseTSV(tsv), warnings };
}

describe('answers', () => {
  test('a list with no rows is choice-list-empty, even with skipValidation', async () => {
    await expect(
      convert([{ type: 'select_one missing', name: 'q', label: 'Q?' }]),
    ).rejects.toMatchObject({ code: 'choice-list-empty' });
  });

  test('a nameless choice gets a generated code: A<n> / SQ<n>', async () => {
    const choices = [
      { list_name: 'l', name: 'a', label: 'A' },
      { list_name: 'l', label: 'No code' },
    ];
    const one = await convert(
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      choices,
    );
    expect(one.rows.filter((r) => r.class === 'A').map((r) => r.name)).toEqual([
      'a',
      expect.stringMatching(/^A\d+$/),
    ]);
    const many = await convert(
      [{ type: 'select_multiple l', name: 'q', label: 'Q?' }],
      choices,
    );
    expect(
      many.rows.filter((r) => r.class === 'SQ').map((r) => r.name),
    ).toEqual(['a', expect.stringMatching(/^SQ\d+$/)]);
  });
});

describe('exclusive', () => {
  const survey = [{ type: 'select_multiple l', name: 'q', label: 'Q?' }];
  const exclusiveOf = async (s: Row[], c: Row[]) =>
    (await convert(s, c)).rows.find((r) => r.class === 'Q')
      ?.exclude_all_others ?? '';

  test.each([true, 1, 'TRUE', 'yes'])(
    'XLSX cell %j marks a choice',
    async (v) => {
      expect(
        await exclusiveOf(survey, [
          { list_name: 'l', name: 'a', label: 'A' },
          { list_name: 'l', name: 'none', label: 'None', exclusive: v },
        ]),
      ).toBe('none');
    },
  );

  test('with or_other, the exclusive code is kept', async () => {
    expect(
      await exclusiveOf(
        [{ type: 'select_multiple l or_other', name: 'q', label: 'Q?' }],
        [
          { list_name: 'l', name: 'a', label: 'A' },
          { list_name: 'l', name: 'none', label: 'None', exclusive: 'yes' },
        ],
      ),
    ).toBe('none');
  });

  test('a select_multiple_from_file has no exclusive column to read', async () => {
    const { rows } = await convert([
      {
        type: 'select_multiple_from_file iso_3166_1.csv',
        name: 'q',
        label: 'Q?',
      },
    ]);
    expect(rows.find((r) => r.class === 'Q')?.exclude_all_others ?? '').toBe(
      '',
    );
  });
});

describe('range parameters', () => {
  test('defaults apply when the cell is empty or not key=value', () => {
    for (const cell of ['', 5, undefined]) {
      expect(parameterAttributes('range', cell, 'r')).toEqual({
        min_num_value_n: '1',
        max_num_value_n: '10',
        num_value_int_only: '1',
      });
    }
    expect(parseParameters('start=1, end=5;step=2')).toEqual({
      start: '1',
      end: '5',
      step: '2',
    });
  });

  test('a descending range becomes min < max', () => {
    expect(parameterAttributes('range', 'start=10 end=1', 'r')).toMatchObject({
      min_num_value_n: '1',
      max_num_value_n: '10',
    });
  });

  test('step=0 is parameter-invalid', () => {
    expect(() =>
      parameterAttributes('range', 'start=0 end=10 step=0', 'r'),
    ).toThrow(expect.objectContaining({ code: 'parameter-invalid' }));
  });

  test('a fractional step or start drops num_value_int_only', () => {
    expect(
      parameterAttributes('range', 'start=0 end=1 step=0.1', 'r'),
    ).not.toHaveProperty('num_value_int_only');
  });
});

describe('TypeMapper (internals)', () => {
  test('an unregistered type warns type-unregistered and falls back to text', () => {
    const warnings: Diagnostic[] = [];
    const mapper = new TypeMapper((w) => warnings.push(w));
    expect(mapper.mapType(mapper.parseType('frobnicate'))).toEqual({
      type: 'S',
    });
    expect(warnings.map((w) => w.code)).toEqual(['type-unregistered']);
  });
});

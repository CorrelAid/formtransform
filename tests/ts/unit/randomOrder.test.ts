/**
 * convention:randomOrder (#213): `parameters: randomize=true` on a select
 * becomes LimeSurvey's ordering attribute, and comes back from it.
 */
import { describe, expect, test } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { lstsvToDdiXml } from '../../../src/pipelines/lstsv2ddi/index.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { findRowByName, parseTSV } from './helpers';

const choices = [
  { list_name: 'l', name: 'umw', label: 'Umwelt' },
  { list_name: 'l', name: 'bil', label: 'Bildung' },
  { list_name: 'l', name: 'arb', label: 'Arbeit' },
];

const exclusiveChoices = [
  ...choices,
  { list_name: 'l', name: 'keine', label: 'Keine', exclusive: 'yes' },
  { list_name: 'l', name: 'wn', label: 'Weiß nicht', exclusive: 'yes' },
];

async function convert(
  survey: Record<string, unknown>[],
  choiceRows: Record<string, unknown>[] = choices,
) {
  const warnings: Diagnostic[] = [];
  const tsv = await new XLSFormToTSVConverter({
    onWarning: (w) => warnings.push(w),
  }).convert(survey, choiceRows, [{ form_title: 'T', default_language: 'de' }]);
  return { tsv, rows: parseTSV(tsv), warnings };
}

const attr = (rows: unknown[], name: string, key: string): string =>
  ((findRowByName(rows as never, name) ?? {}) as Record<string, string>)[key] ??
  '';

describe('randomize=true → LimeSurvey', () => {
  test('select_one (list) gets answer_order=random', async () => {
    const { rows, warnings } = await convert([
      {
        type: 'select_one l',
        name: 'q1',
        label: 'Q',
        parameters: 'randomize=true',
      },
    ]);
    expect(attr(rows, 'q1', 'answer_order')).toBe('random');
    expect(attr(rows, 'q1', 'subquestion_order')).toBe('');
    expect(warnings).toEqual([]);
  });

  test('a dropdown (minimal) gets answer_order=random', async () => {
    const { rows } = await convert([
      {
        type: 'select_one l',
        name: 'q1',
        label: 'Q',
        appearance: 'minimal',
        parameters: 'randomize=true',
      },
    ]);
    expect(attr(rows, 'q1', 'type/scale')).toBe('!');
    expect(attr(rows, 'q1', 'answer_order')).toBe('random');
  });

  test('select_multiple gets subquestion_order=random', async () => {
    const { rows } = await convert([
      {
        type: 'select_multiple l',
        name: 'q1',
        label: 'Q',
        parameters: 'randomize=true',
      },
    ]);
    expect(attr(rows, 'q1', 'subquestion_order')).toBe('random');
    expect(attr(rows, 'q1', 'answer_order')).toBe('');
  });

  test('a select_one filtered by an earlier select_multiple', async () => {
    const { rows } = await convert([
      { type: 'select_multiple l', name: 'k04', label: 'Welche?' },
      {
        type: 'select_one l',
        name: 'k04haupt',
        label: 'Welches am meisten?',
        choice_filter: 'selected(${k04}, name)',
        parameters: 'randomize=true',
      },
    ]);
    expect(attr(rows, 'k04haupt', 'array_filter')).toBe('k04');
    expect(attr(rows, 'k04haupt', 'answer_order')).toBe('random');
  });

  test('no attribute without randomize, or with randomize=false', async () => {
    for (const parameters of ['', 'randomize=false']) {
      const { tsv } = await convert([
        { type: 'select_one l', name: 'q1', label: 'Q', parameters },
      ]);
      expect(tsv).not.toMatch(/answer_order|subquestion_order/);
    }
  });

  test('a seed is dropped with a warning', async () => {
    const { rows, warnings } = await convert([
      {
        type: 'select_one l',
        name: 'q1',
        label: 'Q',
        parameters: 'randomize=true seed=42',
      },
    ]);
    expect(attr(rows, 'q1', 'answer_order')).toBe('random');
    expect(warnings.map((w) => [w.code, w.name])).toEqual([
      ['randomize-seed-dropped', 'q1'],
    ]);
  });

  test('exclusive answers keep their position, with a warning', async () => {
    const { rows, warnings } = await convert(
      [
        {
          type: 'select_multiple l',
          name: 'q1',
          label: 'Q',
          parameters: 'randomize=true',
        },
      ],
      exclusiveChoices,
    );
    expect(attr(rows, 'q1', 'subquestion_order')).toBe('random');
    expect(attr(rows, 'q1', 'exclude_all_others')).toBe('keine;wn');
    expect(attr(rows, 'q1', 'keep_codes_order')).toBe('keine;wn');
    expect(warnings.map((w) => w.code)).toEqual(['randomize-pinned']);
    expect(warnings[0].message).toMatch(/keine, wn/);
  });

  test('without randomize, exclusive answers get no keep_codes_order', async () => {
    const { tsv } = await convert(
      [{ type: 'select_multiple l', name: 'q1', label: 'Q' }],
      exclusiveChoices,
    );
    expect(tsv).not.toMatch(/keep_codes_order/);
  });

  test('a randomized select in a table-list grid is dropped with a warning', async () => {
    const { tsv, warnings } = await convert([
      {
        type: 'begin_group',
        name: 'g',
        label: 'G',
        appearance: 'table-list',
      },
      {
        type: 'select_one l',
        name: 'r1',
        label: 'R1',
        parameters: 'randomize=true',
      },
      { type: 'select_one l', name: 'r2', label: 'R2' },
      { type: 'end_group' },
    ]);
    expect(tsv).not.toMatch(/answer_order/);
    expect(warnings.map((w) => [w.code, w.name])).toEqual([
      ['randomize-dropped', 'r1'],
    ]);
  });
});

describe('LimeSurvey → randomize=true', () => {
  test('round-trips through LimeSurvey TSV → XLSForm', async () => {
    const survey = [
      {
        type: 'select_one l',
        name: 'q1',
        label: 'Q',
        parameters: 'randomize=true',
      },
      {
        type: 'select_multiple l',
        name: 'q2',
        label: 'Q',
        parameters: 'randomize=true',
      },
      { type: 'select_one l', name: 'q3', label: 'Q' },
    ];
    const { tsv } = await convert(survey, exclusiveChoices);
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    const params = Object.fromEntries(
      back.survey.map((r) => [r.name, r.parameters ?? '']),
    );
    expect(params).toEqual({
      q1: 'randomize=true',
      q2: 'randomize=true',
      q3: '',
    });
    // The pinned exclusive answers stay exclusive (from exclude_all_others).
    expect(
      back.choices
        .filter((c) => c.list_name === 'q2' && c.exclusive === 'yes')
        .map((c) => c.name),
    ).toEqual(['keine', 'wn']);
  });

  test('the legacy random_order=1 reads back too', () => {
    const header = [
      'class',
      'type/scale',
      'name',
      'relevance',
      'text',
      'help',
      'language',
      'validation',
      'mandatory',
      'other',
      'default',
      'same_default',
      'random_order',
    ];
    const line = (cells: Record<string, string>) =>
      header.map((h) => cells[h] ?? '').join('\t');
    const tsv = [
      header.join('\t'),
      line({ class: 'S', name: 'language', text: 'de' }),
      line({ class: 'G', name: 'G', text: 'G', language: 'de' }),
      line({
        class: 'Q',
        'type/scale': 'M',
        name: 'q1',
        relevance: '1',
        text: 'Q',
        language: 'de',
        random_order: '1',
      }),
      line({
        class: 'SQ',
        name: 'a',
        relevance: '1',
        text: 'A',
        language: 'de',
      }),
      line({
        class: 'SQ',
        name: 'b',
        relevance: '1',
        text: 'B',
        language: 'de',
      }),
    ].join('\n');
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    expect(back.survey.find((r) => r.name === 'q1')?.parameters).toBe(
      'randomize=true',
    );
  });
});

describe('fixed choices (#237)', () => {
  const fixedChoices = [
    { list_name: 'l', name: 'umw', label: 'Umwelt' },
    { list_name: 'l', name: 'sonst', label: 'Sonstiges', fixed: 'yes' },
    { list_name: 'l', name: 'bil', label: 'Bildung' },
    { list_name: 'l', name: 'keine', label: 'Keine', exclusive: 'yes' },
    { list_name: 'l', name: 'wn', label: 'WN', exclusive: 'yes', fixed: 'yes' },
  ];
  const randomized = (type: string, extra: Record<string, unknown> = {}) => ({
    type,
    name: 'q1',
    label: 'Q',
    parameters: 'randomize=true',
    ...extra,
  });

  test('select_multiple: fixed and exclusive codes in list order, once each', async () => {
    const { rows, warnings } = await convert(
      [randomized('select_multiple l')],
      fixedChoices,
    );
    expect(attr(rows, 'q1', 'keep_codes_order')).toBe('sonst;keine;wn');
    expect(attr(rows, 'q1', 'exclude_all_others')).toBe('keine;wn');
    expect(warnings.map((w) => w.code)).toEqual(['randomize-pinned']);
    expect(warnings[0].message).toMatch(/exclusive or fixed.*sonst, keine, wn/);
  });

  test('select_one: fixed codes in keep_codes_order, exclusive ones are not', async () => {
    const { rows, warnings } = await convert(
      [randomized('select_one l')],
      fixedChoices,
    );
    expect(attr(rows, 'q1', 'answer_order')).toBe('random');
    expect(attr(rows, 'q1', 'keep_codes_order')).toBe('sonst;wn');
    expect(attr(rows, 'q1', 'exclude_all_others')).toBe('');
    expect(warnings.map((w) => w.code)).toEqual(['randomize-pinned']);
  });

  test('a select_one filtered by a select_multiple on the same list', async () => {
    const { rows } = await convert(
      [
        { type: 'select_multiple l', name: 'k04', label: 'Welche?' },
        randomized('select_one l', {
          name: 'k04haupt',
          choice_filter: 'selected(${k04}, name)',
        }),
      ],
      fixedChoices,
    );
    expect(attr(rows, 'k04haupt', 'array_filter')).toBe('k04');
    expect(attr(rows, 'k04haupt', 'keep_codes_order')).toBe('sonst;wn');
  });

  test('without randomize, fixed has no effect and no warning', async () => {
    const { tsv, warnings } = await convert(
      [{ type: 'select_one l', name: 'q1', label: 'Q' }],
      fixedChoices,
    );
    expect(tsv).not.toMatch(/keep_codes_order/);
    expect(warnings).toEqual([]);
  });

  test('true/1 spellings count, other values do not', async () => {
    const { rows } = await convert(
      [randomized('select_one l')],
      choices.map((c, i) => ({ ...c, fixed: ['TRUE', '1', 'no'][i] })),
    );
    expect(attr(rows, 'q1', 'keep_codes_order')).toBe('umw;bil');
  });

  test('round-trips: keep_codes_order reads back as fixed=yes', async () => {
    const { tsv } = await convert(
      [
        randomized('select_multiple l', { name: 'q2' }),
        randomized('select_one l'),
      ],
      fixedChoices,
    );
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    const fixed = (list: string) =>
      back.choices
        .filter((c) => c.list_name === list && c.fixed === 'yes')
        .map((c) => c.name);
    expect(fixed('q2')).toEqual(['sonst']);
    expect(fixed('q1')).toEqual(['sonst', 'wn']);
    // Exclusive stays exclusive.
    expect(
      back.choices
        .filter((c) => c.list_name === 'q2' && c.exclusive === 'yes')
        .map((c) => c.name),
    ).toEqual(['keine', 'wn']);
  });

  test('lstsv2ddi carries fixed as a choice column', async () => {
    const { tsv } = await convert([randomized('select_one l')], fixedChoices);
    const xml = lstsvToDdiXml(tsv);
    expect(xml).toMatch(/cdl:choice_column"[^>]*>yes</);
    expect(xml).toMatch(/subject="sonst fixed"/);
  });
});

/**
 * convention:choiceFilter (#187): a `choice_filter` keeping the options
 * ticked in an earlier select_multiple becomes LimeSurvey's `array_filter`.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { XLSLoader } from '../../../src/xlsform/loader.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { convertAndParse, findRowByName } from './helpers';

/** A select_multiple and a select_one on the same codes. */
const shared = [
  { list_name: 'm', name: 'umw', label: 'Umwelt' },
  { list_name: 'm', name: 'bil', label: 'Bildung' },
  { list_name: 'm', name: 'arb', label: 'Arbeit' },
];

/** The issue's case: numeric codes, the matching m code in column `kurz`. */
const keyed = [
  ...shared,
  { list_name: 'r', name: '1', label: 'Umwelt', kurz: 'umw' },
  { list_name: 'r', name: '2', label: 'Bildung', kurz: 'bil' },
  { list_name: 'r', name: '3', label: 'Arbeit', kurz: 'arb' },
];

const survey = (type: string, filter: string, extra = {}) => [
  { type: 'select_multiple m', name: 'k04', label: 'Welche?' },
  {
    type,
    name: 'k04haupt',
    label: 'Welches am meisten?',
    choice_filter: filter,
    ...extra,
  },
];

async function convert(
  rows: Record<string, unknown>[],
  choices: Record<string, unknown>[],
) {
  const warnings: Diagnostic[] = [];
  const out = (await convertAndParse(rows, choices, undefined, {
    onWarning: (w: Diagnostic) => warnings.push(w),
  })) as unknown as Record<string, string>[];
  const row = (name: string) =>
    findRowByName(out as never, name) as unknown as Record<string, string>;
  const answers = out
    .filter((r) => r.class === 'A')
    .map((r) => [r.name, r.text]);
  return { row, answers, warnings, rows: out };
}

describe('choice_filter → array_filter', () => {
  test('selected(${q}, name) on shared codes: array_filter = q, codes unchanged', async () => {
    const { row, answers, warnings } = await convert(
      survey('select_one m', 'selected(${k04}, name)'),
      shared,
    );
    expect(row('k04haupt').array_filter).toBe('k04');
    expect(answers).toEqual([
      ['umw', 'Umwelt'],
      ['bil', 'Bildung'],
      ['arb', 'Arbeit'],
    ]);
    expect(warnings.map((w) => w.code)).toEqual([]);
  });

  test('selected(${q}, column): the answer codes come from the column, with a warning', async () => {
    const { row, answers, warnings } = await convert(
      survey('select_one r', 'selected(${k04}, kurz)', {
        relevant: '',
      }),
      keyed,
    );
    expect(row('k04haupt').array_filter).toBe('k04');
    expect(answers).toEqual([
      ['umw', 'Umwelt'],
      ['bil', 'Bildung'],
      ['arb', 'Arbeit'],
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['choice-filter-recoded']);
    expect(warnings[0].name).toBe('k04haupt');
  });

  test('expressions comparing with a recoded question use the new codes', async () => {
    const rows = [
      ...survey('select_one r', 'selected(${k04}, kurz)'),
      {
        type: 'text',
        name: 'warum',
        label: 'Warum Arbeit?',
        relevant: "${k04haupt} = '3'",
      },
    ];
    const { row } = await convert(rows, keyed);
    expect(row('warum').relevance).toBe("k04haupt == 'arb'");
  });

  test('a select_multiple can be filtered too', async () => {
    const { row } = await convert(
      survey('select_multiple m', 'selected(${k04}, name)'),
      shared,
    );
    expect(row('k04haupt').array_filter).toBe('k04');
  });

  test('a renamed filter question is referenced by its LimeSurvey name', async () => {
    const rows = survey('select_one m', 'selected(${k04_themen}, name)');
    rows[0].name = 'k04_themen';
    const { row } = await convert(rows, shared);
    expect(row('k04haupt').array_filter).toBe('k04themen');
  });

  test.each([
    ['another expression', "filter = 'a'", 'm'],
    ['a select_one as filter', 'selected(${k04}, name)', 'm', 'select_one m'],
    ['a value that is no answer of q', 'selected(${k04}, kurz)', 'r2'],
    ['an option without a value', 'selected(${k04}, kurz)', 'r3'],
    ['two options on one code', 'selected(${k04}, kurz)', 'r4'],
  ])(
    '%s: dropped with a warning, no array_filter',
    async (_, filter, list, filterType = 'select_multiple m') => {
      const choices = [
        ...shared,
        { list_name: 'r2', name: '1', label: 'A', kurz: 'umw' },
        { list_name: 'r2', name: '2', label: 'B', kurz: 'xyz' },
        { list_name: 'r3', name: '1', label: 'A', kurz: 'umw' },
        { list_name: 'r3', name: '9', label: 'Keins' },
        { list_name: 'r4', name: '1', label: 'A', kurz: 'umw' },
        { list_name: 'r4', name: '2', label: 'B', kurz: 'umw' },
      ];
      const rows = survey(`select_one ${list}`, filter);
      rows[0].type = filterType;
      const { row, answers, warnings } = await convert(rows, choices);
      expect(row('k04haupt').array_filter ?? '').toBe('');
      expect(warnings.map((w) => w.code)).toContain('choice-filter-dropped');
      // The options keep the list's own codes.
      expect(answers.length).toBeGreaterThan(0);
      expect(
        answers.every(([code]) =>
          (choices as { name: string; list_name: string }[]).some(
            (c) => c.list_name === list && c.name === code,
          ),
        ),
      ).toBe(true);
    },
  );

  test('a form without choice_filter gets no array_filter column', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      [{ type: 'select_one m', name: 'q', label: 'Q' }],
      shared,
      [],
    );
    expect(tsv.split('\n')[0]).not.toContain('array_filter');
  });
});

describe('the way back (lstsv2xlsform)', () => {
  test('array_filter = q comes back as choice_filter selected(${q}, name)', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      survey('select_one r', 'selected(${k04}, kurz)'),
      keyed,
      [],
    );
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    const main = back.survey.find((r) => r.name === 'k04haupt');
    expect(main?.choice_filter).toBe('selected(${k04}, name)');
    // ...which converts to the same array_filter again, without recoding.
    const warnings: Diagnostic[] = [];
    const again = await new XLSFormToTSVConverter({
      onWarning: (w) => warnings.push(w),
    }).convert(back.survey, back.choices, back.settings);
    expect(again).toBe(tsv);
    expect(warnings.map((w) => w.code)).not.toContain('choice-filter-dropped');
  });
});

describe('the loader', () => {
  test('choice_filter and the column it reads are expected columns', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['type', 'name', 'label', 'choice_filter'],
        ['select_multiple m', 'k04', 'Welche?', ''],
        ['select_one r', 'k04haupt', 'Welches?', 'selected(${k04}, kurz)'],
      ]),
      'survey',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['list_name', 'name', 'label', 'kurz'],
        ...keyed.map((c) => [
          c.list_name,
          c.name,
          c.label,
          (c as { kurz?: string }).kurz ?? '',
        ]),
      ]),
      'choices',
    );
    const warnings: Diagnostic[] = [];
    XLSLoader.parseXLSData(
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      { onWarning: (w) => warnings.push(w) },
    );
    expect(warnings.filter((w) => w.code === 'column-unexpected')).toEqual([]);
  });
});

describe('property: any one-to-one code column converts and round-trips', () => {
  test('the options keep their labels, take the filter codes, and come back unchanged', async () => {
    const codes = ['umw', 'bil', 'arb'];
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(codes, { minLength: 1 }),
        async (picked) => {
          const choices = [
            ...shared,
            ...picked.map((code, i) => ({
              list_name: 'r',
              name: String(i + 1),
              label: `Option ${i + 1}`,
              kurz: code,
            })),
          ];
          const rows = survey('select_one r', 'selected(${k04}, kurz)');
          const { row, answers } = await convert(rows, choices);
          expect(row('k04haupt').array_filter).toBe('k04');
          expect(answers).toEqual(
            picked.map((code, i) => [code, `Option ${i + 1}`]),
          );
          const tsv = await new XLSFormToTSVConverter({
            onWarning: () => {},
          }).convert(rows, choices, []);
          const back = lstsvToXlsform(tsv, { skipValidation: true });
          const again = await new XLSFormToTSVConverter({
            onWarning: () => {},
          }).convert(back.survey, back.choices, back.settings);
          expect(again).toBe(tsv);
        },
      ),
      { numRuns: 30 },
    );
  });
});

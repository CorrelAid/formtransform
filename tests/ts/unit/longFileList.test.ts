/**
 * #188: a long `select_one_from_file` list (convention:externalCodeList
 * `limesurveyCodes`): stable codes derived from each code, a mapping back to
 * the file's codes, and a dropdown for `autocomplete` / `minimal`.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import {
  lstsvToXlsform,
  XLSValidator,
  xlsformToLstsvWithMapping,
} from '../../../src/index.js';
import { lstsvToDataCsv } from '../../../src/pipelines/lstsv2ddi/index.js';
import {
  fitsLimeSurvey,
  vocabAnswerCodes,
} from '../../../src/conventions/fromFile.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import type { ChoiceRow } from '../../../src/xlsform/types.js';

/** Synthetic 12-digit regional codes (the shape of an ARS, not real ones). */
const ars = (i: number) => String(10_000_000_000 + i * 7919).padStart(12, '0');
const municipalities = (n: number): ChoiceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    list_name: 'kommunen.csv',
    name: ars(i),
    label: `Gemeinde ${i}`,
  }));

const survey = (appearance = '') => [
  {
    type: 'select_one_from_file kommunen.csv',
    name: 'kommune',
    label: 'In welcher Gemeinde wohnen Sie?',
    ...(appearance ? { appearance } : {}),
  },
];

async function convert(rows: Record<string, unknown>[], file: ChoiceRow[]) {
  const warnings: Diagnostic[] = [];
  const result = await xlsformToLstsvWithMapping(
    { surveyData: rows, choicesData: [] },
    {
      fileChoices: { 'kommunen.csv': file },
      onWarning: (w) => warnings.push(w),
    },
  );
  const lines = result.tsv
    .trim()
    .split('\n')
    .map((l) => l.split('\t'));
  const header = lines[0];
  const col = (name: string) => header.indexOf(name);
  const answers = lines
    .filter((l) => l[col('class')] === 'A')
    .map((l) => l[col('name')]);
  const q = lines.find((l) => l[col('class')] === 'Q')!;
  return { ...result, warnings, answers, type: q[col('type/scale')] };
}

describe('vocabAnswerCodes', () => {
  test('a code that fits is kept, the others get 5 base-36 characters', () => {
    const codes = vocabAnswerCodes(['DE', 'AT', '059700040040', 'abwesend']);
    expect(codes.slice(0, 2)).toEqual(['DE', 'AT']);
    for (const c of codes.slice(2)) expect(c).toMatch(/^[0-9a-z]{5}$/);
  });

  test('20 000 codes stay distinct (collisions are re-hashed)', () => {
    const names = Array.from({ length: 20_000 }, (_, i) => ars(i));
    const codes = vocabAnswerCodes(names);
    expect(new Set(codes.map((c) => c.toLowerCase())).size).toBe(names.length);
    expect(codes.every(fitsLimeSurvey)).toBe(true);
  });

  test('property: a code does not depend on the order or on other rows', () => {
    // Only a collision (two codes hashing alike, about one in 10^4 at this
    // size) could move a code; the seed keeps the run reproducible.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 150,
        }),
        fc.integer({ min: 0, max: 1008 }),
        (ids, seed) => {
          const names = ids.map(ars);
          const codes = vocabAnswerCodes(names);
          const byName = new Map(names.map((n, i) => [n, codes[i]]));
          // Shuffle and drop some rows: every remaining code stays.
          const kept = names
            .map((n, i) => ({ n, k: (i * 7919 + seed) % 1009 }))
            .filter(({ k }) => k % 7 !== 0)
            .sort((a, b) => a.k - b.k)
            .map(({ n }) => n);
          const again = vocabAnswerCodes(kept);
          expect(again).toEqual(kept.map((n) => byName.get(n)));
        },
      ),
      { numRuns: 100, seed: 188 },
    );
  });
});

describe('select_one_from_file with a long list', () => {
  const file = municipalities(2000);

  test('no duplicate-code warnings: one note for the derived codes', async () => {
    const { warnings, answers } = await convert(survey(), file);
    expect(warnings.map((w) => w.code)).toEqual(['vocab-codes-derived']);
    expect(warnings[0].message).toContain('2000 code(s) of kommunen.csv');
    expect(new Set(answers).size).toBe(file.length);
  });

  test('the codes are the same however the file is ordered or trimmed', async () => {
    const a = await convert(survey(), file);
    const reordered = [...file].reverse().filter((_, i) => i % 3 !== 0);
    const b = await convert(survey(), reordered);
    const codeOf = (r: typeof a, names: ChoiceRow[]) =>
      new Map(names.map((c, i) => [c.name, r.answers[i]]));
    const before = codeOf(a, file);
    for (const [name, code] of codeOf(b, reordered)) {
      expect(code).toBe(before.get(name));
    }
  });

  test('the mapping gives every derived code back', async () => {
    const { mapping, answers } = await convert(survey(), file);
    const codes = mapping.codes.kommune;
    expect(Object.keys(codes)).toHaveLength(file.length);
    answers.forEach((code, i) => expect(codes[code]).toBe(file[i].name));
  });

  test("lstsv2ddi --data stores the file's codes, not LimeSurvey's", async () => {
    const { tsv, mapping, answers } = await convert(survey(), file);
    const csv = lstsvToDataCsv(
      tsv,
      [
        { id: '1', kommune: answers[42] },
        { id: '2', kommune: '' },
      ],
      { mapping },
    );
    const [header, first, second] = csv.trim().split(/\r?\n/);
    expect(header).toBe('kommune');
    expect(first).toBe(file[42].name);
    expect(second).toMatch(/^("")?$/);
  });

  test.each(['autocomplete', 'minimal', 'minimal autocomplete'])(
    'appearance %s: a dropdown (!), valid on the from-file type',
    async (appearance) => {
      const { type, warnings } = await convert(survey(appearance), file);
      expect(type).toBe('!');
      expect(warnings.map((w) => w.code)).not.toContain(
        'appearance-unregistered',
      );
      const subset = XLSValidator.validateSubset(survey(appearance), [], {
        fileChoices: { 'kommunen.csv': file },
      }).map((d) => d.code);
      expect(subset).not.toContain('appearance-invalid-for-type');
      expect(subset).not.toContain('appearance-unregistered');
    },
  );

  test('the way back reads the dropdown as minimal', async () => {
    const { tsv } = await convert(survey('autocomplete'), file);
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    expect(back.survey[0]).toMatchObject({
      type: 'select_one_from_file kommunen.csv',
      appearance: 'minimal',
    });
  });

  test('a registered vocabulary whose codes fit keeps them', async () => {
    const { mapping } = await xlsformToLstsvWithMapping(
      {
        surveyData: [
          {
            type: 'select_one_from_file iso_3166_1.csv',
            name: 'land',
            label: 'Land?',
          },
        ],
        choicesData: [],
      },
      { onWarning: () => {} },
    );
    expect(mapping.codes).toEqual({});
  });
});

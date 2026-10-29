/**
 * convention:logicMapping `selectionCount`: `count-selected()` (#185, #186).
 * In an expression it counts a select_multiple's ticked subquestions; a
 * constraint bounding it on the question itself becomes `min_answers` /
 * `max_answers`.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { convertAndParse, findRowByName } from './helpers';

const choices = [
  { list_name: 'm', name: 'a', label: 'A' },
  { list_name: 'm', name: 'b', label: 'B' },
  { list_name: 'm', name: 'c', label: 'C' },
];

/** "Tick all that apply, then pick the most important" (AES DIFFTYPE/DIFFMAIN). */
const pickMain = (constraint = '') => [
  { type: 'select_multiple m', name: 'k04', label: 'Which?', constraint },
  {
    type: 'select_one m',
    name: 'k04haupt',
    label: 'Most important?',
    relevant: 'count-selected(${k04}) > 1',
  },
];

async function convert(
  survey: Record<string, unknown>[],
  list = choices,
): Promise<{ rows: Record<string, string>[]; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const rows = (await convertAndParse(survey, list, undefined, {
    onWarning: (w: Diagnostic) => warnings.push(w),
  })) as unknown as Record<string, string>[];
  return { rows, warnings };
}

const q = (rows: Record<string, string>[], name: string) =>
  findRowByName(rows as never, name) as unknown as Record<string, string>;

describe('count-selected() in relevance (#185)', () => {
  test('counts the subquestions of the select_multiple', async () => {
    const { rows } = await convert(pickMain());
    expect(q(rows, 'k04haupt').relevance).toBe(
      'count(k04_a.NAOK, k04_b.NAOK, k04_c.NAOK) > 1',
    );
  });

  test('uses the emitted (sanitized, deduplicated) answer codes', async () => {
    const list = [
      { list_name: 'm', name: 'arbeit_los', label: 'A' },
      { list_name: 'm', name: 'arbeit_suchend', label: 'B' },
    ];
    const { rows } = await convert(pickMain(), list);
    const sqs = rows.filter((r) => r.class === 'SQ').map((r) => r.name);
    expect(q(rows, 'k04haupt').relevance).toBe(
      `count(${sqs.map((c) => `k04_${c}.NAOK`).join(', ')}) > 1`,
    );
    expect(new Set(sqs).size).toBe(2);
  });

  test('a native other (or_other) is counted through its text field', async () => {
    const survey = pickMain();
    survey[0].type = 'select_multiple m or_other';
    const { rows } = await convert(survey);
    expect(q(rows, 'k04haupt').relevance).toBe(
      'count(k04_a.NAOK, k04_b.NAOK, k04_c.NAOK, k04_other.NAOK) > 1',
    );
  });

  test('a renamed (truncated) question is referenced by its LimeSurvey name', async () => {
    const survey = pickMain();
    survey[0].name = 'welche_themen_sind_wichtig';
    survey[1].relevant = 'count-selected(${welche_themen_sind_wichtig}) >= 2';
    const { rows } = await convert(survey);
    expect(q(rows, 'k04haupt').relevance).toBe(
      'count(welchethemensindwich_a.NAOK, welchethemensindwich_b.NAOK, welchethemensindwich_c.NAOK) >= 2',
    );
  });

  test('on anything but a select_multiple, the conversion fails clearly', async () => {
    const survey = [
      { type: 'select_one m', name: 'eins', label: 'One' },
      {
        type: 'text',
        name: 't',
        label: 'T',
        relevant: 'count-selected(${eins}) > 0',
      },
    ];
    await expect(convert(survey)).rejects.toMatchObject({
      code: 'xpath-unsupported',
    });
  });
});

describe('count-selected(.) constraint → min_answers/max_answers (#186)', () => {
  test.each([
    ['count-selected(.) <= 3', undefined, '3'],
    ['count-selected(.) < 3', undefined, '2'],
    ['count-selected(.) >= 2', '2', undefined],
    ['count-selected(.) > 1', '2', undefined],
    ['count-selected(.) = 2', '2', '2'],
    ['3 >= count-selected(.)', undefined, '3'],
    ['count-selected(.) >= 1 and count-selected(.) <= 3', '1', '3'],
    ['count-selected(${k04}) <= 2', undefined, '2'],
  ])('%s', async (constraint, min, max) => {
    const { rows, warnings } = await convert(pickMain(constraint));
    const row = q(rows, 'k04');
    expect(row.min_answers || undefined).toBe(min);
    expect(row.max_answers || undefined).toBe(max);
    expect(row.em_validation_q).toBe('');
    expect(warnings.filter((w) => w.code === 'constraint-dropped')).toEqual([]);
  });

  test('the other terms stay the validation equation', async () => {
    const { rows } = await convert(
      pickMain("count-selected(.) <= 2 and not(selected(., 'c'))"),
    );
    const row = q(rows, 'k04');
    expect(row.max_answers).toBe('2');
    expect(row.em_validation_q).toBe('!((self=="c"))');
  });

  test('a count inside or/not stays in the equation as count()', async () => {
    const { rows } = await convert(
      pickMain("not(selected(., 'c') and count-selected(.) > 1)"),
    );
    const row = q(rows, 'k04');
    expect(row.max_answers ?? '').toBe('');
    expect(row.em_validation_q).toBe(
      '!((self=="c") and count(k04_a.NAOK, k04_b.NAOK, k04_c.NAOK) > 1)',
    );
  });

  test('constraint_message stays the validation tip', async () => {
    const survey = pickMain('count-selected(.) <= 2');
    survey[0].constraint_message = 'Höchstens zwei';
    const { rows } = await convert(survey);
    expect(q(rows, 'k04').em_validation_q_tip).toBe('Höchstens zwei');
  });

  test('without a count bound, no attribute is written', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      pickMain(),
      choices,
      [],
    );
    expect(tsv.split('\n')[0]).not.toMatch(/(min|max)_answers/);
  });
});

describe('the way back (lstsv2xlsform)', () => {
  const roundTrip = async (survey: Record<string, unknown>[]) => {
    const tsv = await new XLSFormToTSVConverter().convert(survey, choices, []);
    return lstsvToXlsform(tsv, { skipValidation: true }).survey;
  };

  test('min_answers/max_answers come back as a count-selected(.) constraint', async () => {
    const back = await roundTrip(
      pickMain('count-selected(.) >= 1 and count-selected(.) <= 3'),
    );
    const k04 = back.find((r) => r.name === 'k04');
    expect(k04?.constraint).toBe(
      'count-selected(.) >= 1 and count-selected(.) <= 3',
    );
  });

  test('count() over all subquestions comes back as count-selected()', async () => {
    const back = await roundTrip(pickMain());
    const main = back.find((r) => r.name === 'k04haupt');
    expect(main?.relevant).toBe('count-selected(${k04}) > 1');
  });
});

describe('property: count bounds survive XLSForm → LimeSurvey → XLSForm', () => {
  const ops = ['<', '<=', '>', '>=', '='] as const;
  const term = fc.record({
    op: fc.constantFrom(...ops),
    n: fc.integer({ min: 1, max: 4 }),
    flipped: fc.boolean(),
  });
  /** The answer counts 0..4 a term (or a conjunction of terms) allows. */
  const allows = (
    terms: { op: (typeof ops)[number]; n: number; flipped: boolean }[],
    k: number,
  ) =>
    terms.every(({ op, n }) =>
      op === '<'
        ? k < n
        : op === '<='
          ? k <= n
          : op === '>'
            ? k > n
            : op === '>='
              ? k >= n
              : k === n,
    );
  const mirrored = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };

  test('min_answers/max_answers allow exactly the counts the constraint allows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(term, { minLength: 1, maxLength: 3 }),
        async (terms) => {
          const constraint = terms
            .map(({ op, n, flipped }) =>
              flipped
                ? `${n} ${mirrored[op]} count-selected(.)`
                : `count-selected(.) ${op} ${n}`,
            )
            .join(' and ');
          const { rows } = await convert(pickMain(constraint));
          const row = q(rows, 'k04');
          expect(row.em_validation_q).toBe('');
          const min = Number(row.min_answers || 0);
          const max = row.max_answers ? Number(row.max_answers) : Infinity;
          // An empty answer (0 ticks) is the "not answered" case for both ODK
          // and LimeSurvey; compare the counts a respondent can tick.
          for (let k = 1; k <= 4; k++) {
            expect(k >= min && k <= max).toBe(allows(terms, k));
          }
          // ...and the way back gives the same bounds again.
          const tsv = await new XLSFormToTSVConverter().convert(
            pickMain(constraint),
            choices,
            [],
          );
          const back = lstsvToXlsform(tsv, { skipValidation: true }).survey;
          const again = await convert(
            pickMain(
              String(back.find((r) => r.name === 'k04')?.constraint ?? ''),
            ),
          );
          expect(q(again.rows, 'k04').min_answers ?? '').toBe(
            row.min_answers ?? '',
          );
          expect(q(again.rows, 'k04').max_answers ?? '').toBe(
            row.max_answers ?? '',
          );
        },
      ),
      { numRuns: 60 },
    );
  });
});

/** LimeSurvey arrays built from grids and matrices (#105). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

async function convert(survey: Row[], choices: Row[]) {
  const warnings: Diagnostic[] = [];
  const tsv = await xlsformToLstsv(
    { surveyData: survey as never, choicesData: choices as never },
    { skipValidation: true, onWarning: (w) => warnings.push(w) },
  );
  return { rows: parseTSV(tsv), warnings };
}

const grid = (...members: Row[]): Row[] => [
  { type: 'begin_group', name: 'g', label: 'G', appearance: 'table-list' },
  ...members,
  { type: 'end_group' },
];
const s = [
  { list_name: 's', name: 'ja', label: 'Ja' },
  { list_name: 's', name: 'nein', label: 'Nein' },
];

describe('grid answer scale', () => {
  test('codes that truncate alike are made unique, with code-duplicate', async () => {
    const { rows, warnings } = await convert(
      grid(
        { type: 'select_one l', name: 'r1', label: 'R1' },
        { type: 'select_one l', name: 'r2', label: 'R2' },
      ),
      [
        { list_name: 'l', name: 'strongly_agree', label: 'SA' },
        { list_name: 'l', name: 'strongly_disagree', label: 'SD' },
      ],
    );
    const codes = rows.filter((r) => r.class === 'A').map((r) => r.name);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(['stron', 'stro1']);
    expect(warnings.map((w) => w.code)).toContain('code-duplicate');
  });

  test('a relevance on the answer code matches the deduplicated code', async () => {
    const { rows } = await convert(
      [
        ...grid({ type: 'select_one l', name: 'r1', label: 'R1' }),
        {
          type: 'text',
          name: 'why',
          label: 'Why?',
          relevant: "${r1} = 'strongly_disagree'",
        },
      ],
      [
        { list_name: 'l', name: 'strongly_agree', label: 'SA' },
        { list_name: 'l', name: 'strongly_disagree', label: 'SD' },
      ],
    );
    expect(rows.find((r) => r.name === 'why')?.relevance).toContain('stro1');
  });

  test('rows with different lists warn grid-list-mismatch', async () => {
    const { rows, warnings } = await convert(
      grid(
        { type: 'select_one s', name: 'a', label: 'A' },
        { type: 'select_one t', name: 'b', label: 'B' },
      ),
      [...s, { list_name: 't', name: 'x', label: 'X' }],
    );
    expect(rows.filter((r) => r.class === 'A').map((r) => r.name)).toEqual([
      'ja',
      'nein',
    ]);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'grid-list-mismatch', name: 'b' }),
    );
  });
});

describe('grid structure', () => {
  test('a non-select row ends the array; it follows as its own question', async () => {
    const { rows } = await convert(
      grid(
        { type: 'select_one s', name: 'a', label: 'A' },
        { type: 'text', name: 'c', label: 'C' },
      ),
      s,
    );
    expect(rows.map((r) => `${r.class}:${r['type/scale']}:${r.name}`)).toEqual(
      expect.arrayContaining(['Q:F:g', 'SQ::a', 'Q:S:c']),
    );
    const order = rows.map((r) => r.name);
    expect(order.indexOf('nein')).toBeLessThan(order.indexOf('c'));
  });

  test('group relevance goes on the array; required stays on its row', async () => {
    const { rows } = await convert(
      [
        { type: 'text', name: 'z', label: 'Z' },
        ...grid(
          { type: 'select_one s', name: 'a', label: 'A', required: 'yes' },
          { type: 'select_one s', name: 'b', label: 'B' },
        ).map((r) =>
          r.type === 'begin_group' ? { ...r, relevant: "${z} = 'y'" } : r,
        ),
      ],
      s,
    );
    expect(rows.find((r) => r.class === 'Q' && r.name === 'g')?.relevance).toBe(
      "z == 'y'",
    );
    const sq = (n: string) =>
      rows.find((r) => r.class === 'SQ' && r.name === n);
    expect(sq('a')?.mandatory).toBe('Y');
    expect(sq('b')?.mandatory).toBe('');
  });

  test('a label/list-nolabel matrix ends at the next plain question', async () => {
    const { rows } = await convert(
      [
        { type: 'select_one s', name: 'h', label: 'H', appearance: 'label' },
        {
          type: 'select_one s',
          name: 'a',
          label: 'A',
          appearance: 'list-nolabel',
        },
        { type: 'text', name: 'after', label: 'After' },
      ],
      s,
    );
    expect(rows.map((r) => `${r.class}:${r['type/scale']}:${r.name}`)).toEqual(
      expect.arrayContaining(['Q:F:h', 'SQ::a', 'Q:S:after']),
    );
  });

  test('list-nolabel outside a matrix is an ordinary list question', async () => {
    const { rows } = await convert(
      [
        {
          type: 'select_one s',
          name: 'a',
          label: 'A',
          appearance: 'list-nolabel',
        },
      ],
      s,
    );
    expect(rows.find((r) => r.class === 'Q')?.['type/scale']).toBe('L');
  });
});

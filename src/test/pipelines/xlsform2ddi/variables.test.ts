/** Variable extraction from parsed XLSForm rows. */
import { describe, test, expect } from 'vitest';

import {
  extractVariables,
  choicesByListFromRows,
  normalizeChoices,
} from '../../../pipelines/xlsform2ddi/variables.js';

describe('extractVariables — types', () => {
  test('maps XLSForm aliases to canonical slugs', () => {
    const vars = extractVariables(
      [
        { type: 'int', name: 'a', label: 'A' },
        { type: 'string', name: 'b', label: 'B' },
      ],
      {},
    );
    expect(vars.map((v) => v.type)).toEqual(['integer', 'text']);
  });

  test('resolves select_one list name and choices', () => {
    const vars = extractVariables(
      [{ type: 'select_one colors', name: 'c', label: 'Colour' }],
      {
        colors: [
          { name: 'r', label: 'Red' },
          { name: 'g', label: 'Green' },
        ],
      },
    );
    expect(vars[0].type).toBe('select_one');
    expect(vars[0].listName).toBe('colors');
    expect(vars[0].choices).toEqual([
      { name: 'r', label: 'Red' },
      { name: 'g', label: 'Green' },
    ]);
  });

  test('derives vocab stem from select_one_from_file filename', () => {
    const vars = extractVariables(
      [
        {
          type: 'select_one_from_file iso_3166_1.csv',
          name: 'country',
          label: 'Country',
        },
      ],
      {},
    );
    expect(vars[0].type).toBe('select_one_from_file');
    expect(vars[0].vocab).toBe('iso_3166_1');
    expect(vars[0].choices).toEqual([]);
  });

  test('keeps note rows (needed for classification)', () => {
    const vars = extractVariables(
      [{ type: 'note', name: 'n', label: 'Info' }],
      {},
    );
    expect(vars).toHaveLength(1);
    expect(vars[0].type).toBe('note');
  });

  test('skips rows with an empty or missing type', () => {
    const vars = extractVariables(
      [
        { type: '', name: 'a' },
        { name: 'b' },
        { type: 'text', name: 'c', label: 'C' },
      ],
      {},
    );
    expect(vars.map((v) => v.name)).toEqual(['c']);
  });

  test('skips rows without a name', () => {
    const vars = extractVariables([{ type: 'text', label: 'no name' }], {});
    expect(vars).toHaveLength(0);
  });
});

describe('extractVariables — groups', () => {
  test('records nested group path and innermost metadata', () => {
    const vars = extractVariables(
      [
        { type: 'begin_group', name: 'outer', label: 'Outer' },
        {
          type: 'begin_group',
          name: 'inner',
          label: 'Inner',
          appearance: 'Table-List',
        },
        { type: 'integer', name: 'q', label: 'Q' },
        { type: 'end_group' },
        { type: 'end_group' },
      ],
      {},
    );
    expect(vars[0].group).toBe('outer/inner');
    expect(vars[0].groupLabel).toBe('Inner');
    expect(vars[0].groupAppearance).toBe('table-list');
  });

  test('closing a group pops the stack', () => {
    const vars = extractVariables(
      [
        { type: 'begin_group', name: 'g', label: 'G' },
        { type: 'text', name: 'a', label: 'A' },
        { type: 'end_group' },
        { type: 'text', name: 'b', label: 'B' },
      ],
      {},
    );
    expect(vars.find((v) => v.name === 'a')?.group).toBe('g');
    expect(vars.find((v) => v.name === 'b')?.group).toBe('');
  });
});

describe('extractVariables — labels', () => {
  test('prefers a label::<lang> column over plain label', () => {
    const vars = extractVariables(
      [
        {
          type: 'text',
          name: 'a',
          'label::Deutsch': 'Hallo',
          label: 'ignored',
        },
      ],
      {},
    );
    expect(vars[0].label).toBe('Hallo');
  });

  test('reads first value from a label map', () => {
    const vars = extractVariables(
      [{ type: 'text', name: 'a', label: { en: 'Hi', de: 'Hallo' } }],
      {},
    );
    expect(vars[0].label).toBe('Hi');
  });
});

describe('choices helpers', () => {
  test('choicesByListFromRows groups a flat sheet by list_name', () => {
    const grouped = choicesByListFromRows([
      { list_name: 'x', name: '1', label: 'One' },
      { list_name: 'x', name: '2', label: 'Two' },
      { list_name: 'y', name: 'a', label: 'A' },
      { name: 'orphan', label: 'no list' },
    ]);
    expect(grouped.x).toHaveLength(2);
    expect(grouped.y).toEqual([{ name: 'a', label: 'A' }]);
    expect(grouped.orphan).toBeUndefined();
  });

  test('normalizeChoices coerces values to strings', () => {
    const norm = normalizeChoices({ nums: [{ name: 1, label: 2 }] });
    expect(norm.nums).toEqual([{ name: '1', label: '2' }]);
  });
});

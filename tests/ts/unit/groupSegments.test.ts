/**
 * A LimeSurvey question belongs to the G row before it, so an outer group's
 * own questions after a nested group get a G row there, and no G row is left
 * without questions (#206).
 */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

const convert = async (survey: Row[]) =>
  parseTSV(
    await xlsformToLstsv({ surveyData: survey as never, choicesData: [] }),
  );

/** Each G row's name with the Q rows that follow it. */
function groupsOf(rows: ReturnType<typeof parseTSV>): [string, string[]][] {
  const groups: [string, string[]][] = [];
  for (const r of rows) {
    if (r.class === 'G') groups.push([r.name, []]);
    if (r.class === 'Q') groups[groups.length - 1][1].push(r.name);
  }
  return groups;
}

describe('group segments (#206)', () => {
  test('an outer group that opens with nested groups: no empty G row', async () => {
    const rows = await convert([
      { type: 'text', name: 'a', label: 'A?' },
      {
        type: 'begin_group',
        name: 'bd',
        label: 'Digitalisierung',
        relevant: "${a} = '1'",
      },
      { type: 'begin_group', name: 'gd8', label: 'Wissen' },
      { type: 'text', name: 'k20', label: 'K20?' },
      { type: 'end_group' },
      { type: 'begin_group', name: 'gd12', label: 'Nutzung' },
      { type: 'text', name: 'k12', label: 'K12?' },
      { type: 'end_group' },
      { type: 'text', name: 'k13', label: 'K13?' },
      { type: 'text', name: 'k13haupt', label: 'K13 Haupt?' },
      { type: 'end_group' },
    ]);
    expect(groupsOf(rows)).toEqual([
      ['G0', ['a']],
      ['Wissen', ['bd', 'k20']],
      ['Nutzung', ['k12']],
      ['Digitalisierung', ['k13', 'k13haupt']],
    ]);
    // The outer title is a note, and its condition reaches every G row.
    expect(rows.find((r) => r.name === 'bd')?.['type/scale']).toBe('X');
    expect(rows.filter((r) => r.class === 'G').map((r) => r.relevance)).toEqual(
      ['1', "a == '1'", "a == '1'", "a == '1'"],
    );
  });

  test('own questions before and after a nested group: two G rows, one description', async () => {
    const rows = await convert([
      {
        type: 'begin_group',
        name: 'outer',
        label: 'Outer',
        hint: 'About the outer topic',
      },
      { type: 'text', name: 'o1', label: 'O1?' },
      { type: 'begin_group', name: 'inner', label: 'Inner' },
      { type: 'text', name: 'i1', label: 'I1?' },
      { type: 'end_group' },
      { type: 'text', name: 'o2', label: 'O2?' },
      { type: 'end_group' },
    ]);
    expect(groupsOf(rows)).toEqual([
      ['Outer', ['o1']],
      ['Inner', ['i1']],
      ['Outer', ['o2']],
    ]);
    expect(rows.filter((r) => r.class === 'G').map((r) => r.text)).toEqual([
      'About the outer topic',
      '',
      '',
    ]);
  });
});

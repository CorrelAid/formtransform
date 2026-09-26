/** An enclosing group's relevance reaches every LimeSurvey group inside it (#104). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

const convert = async (survey: Row[]) =>
  parseTSV(
    await xlsformToLstsv({ surveyData: survey as never, choicesData: [] }),
  );

const groupRelevance = (rows: ReturnType<typeof parseTSV>) =>
  rows.filter((r) => r.class === 'G').map((r) => [r.name, r.relevance]);

describe('group relevance', () => {
  test('a flattened outer group: its condition reaches the inner group', async () => {
    const rows = await convert([
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'begin_group', name: 'outer', relevant: "${a} = '1'" },
      { type: 'begin_group', name: 'inner', label: 'Inner' },
      { type: 'text', name: 't', label: 'T?' },
      { type: 'end_group' },
      { type: 'end_group' },
    ]);
    expect(groupRelevance(rows)).toContainEqual(['Inner', "a == '1'"]);
  });

  test("an inner group's own condition is AND-ed with the outer one", async () => {
    const rows = await convert([
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'text', name: 'b', label: 'B?' },
      {
        type: 'begin_group',
        name: 'outer',
        label: 'Outer',
        relevant: "${a} = '1'",
      },
      { type: 'text', name: 'o', label: 'O?' },
      {
        type: 'begin_group',
        name: 'inner',
        label: 'Inner',
        relevant: "${b} = '2'",
      },
      { type: 'text', name: 't', label: 'T?' },
      { type: 'end_group' },
      { type: 'end_group' },
    ]);
    const g = Object.fromEntries(groupRelevance(rows));
    expect(g.Outer).toBe("a == '1'");
    expect(g.Inner).toBe("a == '1' and b == '2'");
  });

  test('three levels, and a sibling after the inner group closes', async () => {
    const rows = await convert([
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'begin_group', name: 'l1', relevant: "${a} = '1'" },
      { type: 'begin_group', name: 'l2', relevant: "${a} != '9'" },
      { type: 'begin_group', name: 'l3', label: 'Deep' },
      { type: 'text', name: 't', label: 'T?' },
      { type: 'end_group' },
      { type: 'end_group' },
      { type: 'begin_group', name: 'sib', label: 'Sibling' },
      { type: 'text', name: 's', label: 'S?' },
      { type: 'end_group' },
      { type: 'end_group' },
      { type: 'text', name: 'after', label: 'After?' },
    ]);
    const g = Object.fromEntries(groupRelevance(rows));
    expect(g.Deep).toBe("a == '1' and a != '9'");
    expect(g.Sibling).toBe("a == '1'");
    expect(rows.find((r) => r.name === 'after')?.relevance).toBe('1');
  });

  test('an outer `or` keeps its parentheses under the inner `and`', async () => {
    const rows = await convert([
      { type: 'text', name: 'a', label: 'A?' },
      {
        type: 'begin_group',
        name: 'outer',
        relevant: "${a} = '1' or ${a} = '2'",
      },
      {
        type: 'begin_group',
        name: 'inner',
        label: 'Inner',
        relevant: "${a} != '3'",
      },
      { type: 'text', name: 't', label: 'T?' },
      { type: 'end_group' },
      { type: 'end_group' },
    ]);
    expect(Object.fromEntries(groupRelevance(rows)).Inner).toBe(
      "(a == '1' or a == '2') and a != '3'",
    );
  });
});

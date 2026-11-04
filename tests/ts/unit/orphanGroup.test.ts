/**
 * Questions outside every group go on a page named like the default group
 * (`defaults.groupName`) with no description; hidden ones need no page of
 * their own (#223).
 */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

const convert = async (survey: Row[], config?: Row) =>
  parseTSV(
    await xlsformToLstsv(
      { surveyData: survey as never, choicesData: [] },
      (config ?? {}) as never,
    ),
  );

function groupsOf(rows: ReturnType<typeof parseTSV>) {
  const groups: { name: string; text: string; qs: string[] }[] = [];
  for (const r of rows) {
    if (r.class === 'G') groups.push({ name: r.name, text: r.text, qs: [] });
    if (r.class === 'Q') groups[groups.length - 1].qs.push(r.name);
  }
  return groups;
}

const hidden = { type: 'hidden', name: 'partner', label: 'Partner' };
const note = { type: 'note', name: 'intro', label: 'Hello' };
const grp = (name: string, ...qs: Row[]) => [
  { type: 'begin_group', name, label: name },
  ...qs,
  { type: 'end_group' },
];
const text = (name: string) => ({ type: 'text', name, label: name });

describe('orphan group (#223)', () => {
  test('is named like the default group, with no description', async () => {
    const rows = await convert([note, ...grp('g', text('a'))]);
    expect(groupsOf(rows)).toEqual([
      { name: 'Questions', text: '', qs: ['intro'] },
      { name: 'g', text: '', qs: ['a'] },
    ]);
  });

  test('uses the configured group name; later runs get a number', async () => {
    const rows = await convert([note, ...grp('g', text('a')), text('b')], {
      defaults: { groupName: 'Seite' },
    });
    expect(groupsOf(rows).map((g) => [g.name, g.text])).toEqual([
      ['Seite', ''],
      ['g', ''],
      ['Seite 2', ''],
    ]);
  });

  test('hidden rows before a group join that group', async () => {
    const rows = await convert([hidden, ...grp('g', text('a'))]);
    expect(groupsOf(rows)).toEqual([
      { name: 'g', text: '', qs: ['partner', 'a'] },
    ]);
  });

  test('hidden rows after the last group join it', async () => {
    const rows = await convert([...grp('g', text('a')), hidden]);
    expect(groupsOf(rows)).toEqual([
      { name: 'g', text: '', qs: ['a', 'partner'] },
    ]);
  });

  test('hidden rows with a note keep the note page, hidden stay on it', async () => {
    const rows = await convert([hidden, note, ...grp('g', text('a'))]);
    expect(groupsOf(rows).map((g) => [g.name, g.qs])).toEqual([
      ['Questions', ['partner', 'intro']],
      ['g', ['a']],
    ]);
  });

  test('only hidden rows and no group: the default group holds them', async () => {
    const rows = await convert([hidden]);
    expect(groupsOf(rows)).toEqual([
      { name: 'Questions', text: '', qs: ['partner'] },
    ]);
  });
});

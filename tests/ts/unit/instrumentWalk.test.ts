/** xlsform2lstsv walks the Instrument's group tree (#69, phase 3a). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../src/api.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;
const groups = async (survey: Row[]) =>
  parseTSV(
    await xlsformToLstsv({ surveyData: survey as never, choicesData: [] }),
  )
    .filter((r) => r.class === 'G')
    .map((r) => r.name);

describe('group structure', () => {
  test('`begin group` with a space is a group: no default group is added', async () => {
    expect(
      await groups([
        { type: 'begin group', name: 'g', label: 'Meine Gruppe' },
        { type: 'text', name: 'q', label: 'Q?' },
        { type: 'end group' },
      ]),
    ).toEqual(['Meine Gruppe']);
  });

  test('a group left open ends with the survey', async () => {
    expect(
      await groups([
        { type: 'begin_group', name: 'g', label: 'Offen' },
        { type: 'text', name: 'q', label: 'Q?' },
      ]),
    ).toEqual(['Offen']);
  });

  test('a parent-only group is flattened; its children keep their groups', async () => {
    expect(
      await groups([
        { type: 'begin_group', name: 'outer', label: 'Outer' },
        { type: 'begin_group', name: 'a', label: 'A' },
        { type: 'text', name: 'q1', label: 'Q1?' },
        { type: 'end_group' },
        { type: 'begin_group', name: 'b', label: 'B' },
        { type: 'text', name: 'q2', label: 'Q2?' },
        { type: 'end_group' },
        { type: 'end_group' },
      ]),
    ).toEqual(['A', 'B']);
  });
});

describe('question fields from the Instrument (#69, 3b-2)', () => {
  const q = async (row: Row, choices: Row[] = []) =>
    parseTSV(
      await xlsformToLstsv(
        { surveyData: [row] as never, choicesData: choices as never },
        { skipValidation: true },
      ),
    ).find((r) => r.class === 'Q');

  test('required accepts TRUE / 1 / Yes, as XLSForm does', async () => {
    for (const required of ['TRUE', '1', 'Yes', 'yes']) {
      expect(
        (await q({ type: 'text', name: 'a', label: 'A?', required }))
          ?.mandatory,
      ).toBe('Y');
    }
    expect(
      (await q({ type: 'text', name: 'a', label: 'A?', required: 'no' }))
        ?.mandatory,
    ).toBe('');
  });

  test('an appearance is matched case-insensitively', async () => {
    const row = await q(
      { type: 'select_one l', name: 'a', label: 'A?', appearance: 'Minimal' },
      [{ list_name: 'l', name: 'x', label: 'X' }],
    );
    expect(row?.['type/scale']).toBe('!');
  });
});

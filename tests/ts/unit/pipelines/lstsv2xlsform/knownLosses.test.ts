/**
 * The lossy reconstructions README.md documents, pinned to their exact output
 * (#106), plus settings paths no fixture reaches. A change here is either a
 * fix (update README.md) or a new loss.
 */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../../../src/api.js';
import { lstsvToXlsform } from '../../../../../src/pipelines/lstsv2xlsform/index.js';

type Row = Record<string, unknown>;

async function roundTrip(
  survey: Row[],
  choices: Row[] = [],
  settings: Row[] = [],
) {
  const tsv = await xlsformToLstsv({
    surveyData: survey as never,
    choicesData: choices as never,
    settingsData: settings as never,
  });
  return { tsv, back: lstsvToXlsform(tsv) };
}

const question = (back: { survey: Row[] }, name: string) =>
  back.survey.find((r) => r.name === name);

describe('README known losses', () => {
  test('concat() comes back as arithmetic +', async () => {
    const { tsv, back } = await roundTrip([
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'text', name: 'b', label: 'B?' },
      {
        type: 'text',
        name: 'c',
        label: 'C?',
        relevant: "concat(${a}, ${b}) = 'xy'",
      },
    ]);
    expect(tsv).toContain("a + b == 'xy'");
    expect(question(back, 'c')?.relevant).toBe("${a} + ${b} = 'xy'");
  });

  test('range step: step=5 comes back as step=1, a fractional step is dropped', async () => {
    const { back } = await roundTrip([
      {
        type: 'range',
        name: 'r',
        label: 'R?',
        parameters: 'start=0 end=100 step=5',
      },
      {
        type: 'range',
        name: 's',
        label: 'S?',
        parameters: 'start=0 end=1 step=0.5',
      },
    ]);
    expect(question(back, 'r')).toMatchObject({
      type: 'range',
      parameters: 'start=0 end=100 step=1',
    });
    expect(question(back, 's')).toMatchObject({
      type: 'range',
      parameters: 'start=0 end=1',
    });
  });

  test('regexMatch: the reverse assumes the generic (field, pattern) order', async () => {
    const { tsv, back } = await roundTrip([
      // XPath regex(): the generic path, which round-trips.
      {
        type: 'text',
        name: 'a',
        label: 'A?',
        constraint: "regex(., '^[0-9]{5}$')",
      },
      // An EM-style regexMatch(pattern, field) takes the escape hatch, which
      // swaps the arguments; the TSV can't show which path applied.
      {
        type: 'text',
        name: 'b',
        label: 'B?',
        constraint: "regexMatch('^[0-9]{5}$', .)",
      },
    ]);
    expect(tsv).toContain("regexMatch(self, '^[0-9]{5}$')");
    expect(tsv).toContain("regexMatch('^[0-9]{5}$', self)");
    expect(question(back, 'a')?.constraint).toBe("regex(., '^[0-9]{5}$')");
    expect(question(back, 'b')?.constraint).toBe("regex('^[0-9]{5}$', .)");
  });

  test('a multilingual survey with several groups keeps every translation', async () => {
    // The shape XLSLoader gives `label::de` / `label::en` columns.
    const lang = (de: string, en: string) => ({
      label: { de, en },
      _languages: ['de', 'en'],
    });
    const { back } = await roundTrip(
      [
        { type: 'begin_group', name: 'g1', ...lang('Eins', 'One') },
        { type: 'text', name: 'a', ...lang('A de', 'A en') },
        { type: 'end_group' },
        { type: 'begin_group', name: 'g2', ...lang('Zwei', 'Two') },
        { type: 'text', name: 'b', ...lang('B de', 'B en') },
        { type: 'end_group' },
      ],
      [],
      [{ default_language: 'de' }],
    );
    expect(question(back, 'a')?.label).toEqual({ de: 'A de', en: 'A en' });
    expect(question(back, 'b')?.label).toEqual({ de: 'B de', en: 'B en' });
    const groups = back.survey.filter((r) => r.type === 'begin_group');
    expect(groups.map((g) => g.label)).toEqual([
      { de: 'Eins', en: 'One' },
      { de: 'Zwei', en: 'Two' },
    ]);
  });
});

describe('settings', () => {
  test('style: pages (format G) round-trips', async () => {
    const { tsv, back } = await roundTrip(
      [{ type: 'text', name: 'a', label: 'A?' }],
      [],
      [{ style: 'pages' }],
    );
    expect(tsv).toMatch(/^S\t\tformat\t1\tG\t/m);
    expect(back.settings).toEqual([{ style: 'pages' }]);
  });

  test('welcome/end notes come back as notes', async () => {
    const { tsv, back } = await roundTrip([
      { type: 'note', name: 'welcome', label: 'Hallo!' },
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'note', name: 'end', label: 'Danke!' },
    ]);
    expect(tsv).toContain('surveyls_welcometext');
    expect(tsv).toContain('surveyls_endtext');
    expect(question(back, 'welcome')).toMatchObject({
      type: 'note',
      label: 'Hallo!',
    });
    expect(question(back, 'end')).toMatchObject({
      type: 'note',
      label: 'Danke!',
    });
  });
});

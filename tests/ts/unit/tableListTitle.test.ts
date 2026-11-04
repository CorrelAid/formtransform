/**
 * A `table-list` group's label is shown once (#224): its G row's title is the
 * `label_short` and the array's text the label, or, without a `label_short`,
 * the title is the label and the array has no text. The reverse paths read
 * the label (and the `label_short`) back from wherever it is.
 */
import { describe, expect, test } from 'vitest';

import { lstsvToDdi, xlsformToLstsv } from '../../../src/api.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { parseTSV } from './helpers';

type Row = Record<string, unknown>;

const choices = [
  { list_name: 's', name: 'ja', label: 'Ja' },
  { list_name: 's', name: 'nein', label: 'Nein' },
];

const LABEL = 'Inwieweit treffen die folgenden Aussagen zu?';
const HINT = 'Eine Antwort je Zeile.';

const grid = (extra: Row = {}): Row[] => [
  {
    type: 'begin_group',
    name: 'gb10',
    label: LABEL,
    hint: HINT,
    appearance: 'table-list',
    ...extra,
  },
  { type: 'select_one s', name: 'k24', label: 'Bei Einsparungen' },
  { type: 'select_one s', name: 'k25', label: 'Beim Budget' },
  { type: 'end_group' },
];

/** The grid inside a section with a question before and after it. */
const nested = (extra: Row = {}): Row[] => [
  { type: 'begin_group', name: 'fb', label: 'Fortbildung, Budget' },
  { type: 'text', name: 'vorher', label: 'Vorher' },
  ...grid(extra),
  { type: 'text', name: 'nachher', label: 'Nachher' },
  { type: 'end_group' },
];

async function tsvOf(survey: Row[]): Promise<string> {
  return xlsformToLstsv(
    { surveyData: survey as never, choicesData: choices as never },
    { skipValidation: true },
  );
}

/** The G row the array sits in and the array (F) row. */
function arrayRows(tsv: string) {
  const rows = parseTSV(tsv);
  const f = rows.findIndex((r) => r.class === 'Q' && r['type/scale'] === 'F');
  const g = rows.slice(0, f).findLastIndex((r) => r.class === 'G');
  return { g: rows[g], f: rows[f] };
}

const gridGroup = (tsv: string) =>
  lstsvToXlsform(tsv).survey.find((r) => r.appearance === 'table-list');

describe.each([
  ['top-level', grid],
  ['nested in a section', nested],
])('table-list %s', (_, form) => {
  test('without label_short: the label is the page title, the array has no text', async () => {
    const { g, f } = arrayRows(await tsvOf(form()));
    expect(g.name).toBe(LABEL);
    expect(g.text).toBe(HINT);
    expect(f.text).toBe('');
    expect(f.help).toBe('');
  });

  test('with label_short: it is the page title, the label the array text', async () => {
    const { g, f } = arrayRows(await tsvOf(form({ label_short: 'B10' })));
    expect(g.name).toBe('B10');
    expect(g.text).toBe('');
    expect(f.text).toBe(LABEL);
    expect(f.help).toBe(HINT);
  });

  test('without label_short: lstsv2xlsform reads label and hint back', async () => {
    const back = gridGroup(await tsvOf(form()));
    expect(back).toMatchObject({ name: 'gb10', label: LABEL, hint: HINT });
    expect(back).not.toHaveProperty('label_short');
  });

  test('with label_short: lstsv2xlsform reads it back with the label', async () => {
    const back = gridGroup(await tsvOf(form({ label_short: 'B10' })));
    expect(back).toMatchObject({
      name: 'gb10',
      label: LABEL,
      hint: HINT,
      label_short: 'B10',
    });
  });

  test('lstsv2ddi: the grid varGrp has the label as txt, label_short as labl', async () => {
    const plain = lstsvToDdi(await tsvOf(form()), { prodDate: '2020-01-01' });
    const short = lstsvToDdi(await tsvOf(form({ label_short: 'B10' })), {
      prodDate: '2020-01-01',
    });
    const varGrp = (xml: string) =>
      /<varGrp[^>]*type="grid"[^>]*>[\s\S]*?<\/varGrp>/.exec(xml)?.[0] ?? '';
    expect(varGrp(plain)).toContain(LABEL);
    expect(varGrp(plain)).not.toContain('<labl');
    expect(varGrp(short)).toContain(LABEL);
    expect(varGrp(short)).toMatch(/<labl[^>]*>B10<\/labl>/);
  });
});

test('per language: each title is its label_short, each array text its label', async () => {
  const tsv = await xlsformToLstsv(
    {
      surveyData: [
        {
          type: 'begin_group',
          name: 'v',
          appearance: 'table-list',
          'label::Deutsch (de)': 'Wie sehr vertrauen Sie …',
          'label::English (en)': 'How much do you trust …',
          'label_short::Deutsch (de)': 'Vertrauen',
          'label_short::English (en)': 'Trust',
        },
        {
          type: 'select_one s',
          name: 'p',
          'label::Deutsch (de)': 'Parlament',
          'label::English (en)': 'Parliament',
        },
        { type: 'end_group' },
      ] as never,
      choicesData: [
        {
          list_name: 's',
          name: 'ja',
          'label::Deutsch (de)': 'Ja',
          'label::English (en)': 'Yes',
        },
      ] as never,
    },
    { skipValidation: true },
  );
  const rows = parseTSV(tsv);
  const by = (cls: string, lang: string) =>
    rows.find(
      (r) =>
        r.class === cls &&
        r.language === lang &&
        (cls === 'G' || r['type/scale'] === 'F'),
    );
  expect(by('G', 'de')?.name).toBe('Vertrauen');
  expect(by('G', 'en')?.name).toBe('Trust');
  expect(by('Q', 'de')?.text).toBe('Wie sehr vertrauen Sie …');
  expect(by('Q', 'en')?.text).toBe('How much do you trust …');
  expect(gridGroup(tsv)).toMatchObject({
    label: { de: 'Wie sehr vertrauen Sie …', en: 'How much do you trust …' },
    label_short: { de: 'Vertrauen', en: 'Trust' },
  });
});

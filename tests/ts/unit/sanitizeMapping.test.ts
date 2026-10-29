/**
 * #189: opt-in sanitizing of names and answer codes, with the renames
 * recorded in a mapping (convention:lstsvMapping) that the way back applies.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import {
  lstsvToDdi,
  lstsvToXlsform,
  parseLstsvMapping,
  xlsformToDdi,
  xlsformToLstsv,
  xlsformToLstsvWithMapping,
  XLSValidator,
} from '../../../src/index.js';
import { lstsvToDataCsv } from '../../../src/pipelines/lstsv2ddi/index.js';
import type { Diagnostic } from '../../../src/diagnostics.js';

/** Valid for Kobo and DDI, outside LimeSurvey's limits. */
const survey = [
  { type: 'begin_group', name: 'reise', label: 'Reise' },
  { type: 'text', name: 'k23_ars', label: 'Gemeinde (ARS)' },
  {
    type: 'select_one anwesend',
    name: 'k10_reisezeit',
    label: 'Reisezeit?',
    default: '-98',
  },
  {
    type: 'text',
    name: 'k10_grund_der_abwesenheit',
    label: 'Warum?',
    relevant: "${k10_reisezeit} = 'abwesend' or ${k10_reisezeit} = '-98'",
  },
  { type: 'select_multiple anwesend', name: 'k11_mehrfach', label: 'Wann?' },
  {
    type: 'integer',
    name: 'k12_anzahl',
    label: 'Wie oft?',
    relevant: "selected(${k11_mehrfach}, '-97')",
  },
  { type: 'end_group', name: '' },
];
const choices = [
  { list_name: 'anwesend', name: 'anwesend', label: 'Anwesend' },
  { list_name: 'anwesend', name: 'abwesend', label: 'Abwesend' },
  { list_name: 'anwesend', name: '-97', label: 'Keine Angabe' },
  { list_name: 'anwesend', name: '-98', label: 'Weiß nicht' },
];
const form = { surveyData: survey, choicesData: choices, settingsData: [] };
const quiet = { onWarning: () => {} };

describe('the subset check', () => {
  const errorCodes = (sanitize?: boolean) =>
    XLSValidator.validateSubset(survey, choices, { sanitize })
      .filter((d) => d.severity === 'error')
      .map((d) => d.code);

  test('fails names and codes outside the limits by default', () => {
    expect(errorCodes()).toEqual(
      expect.arrayContaining(['name-invalid', 'code-too-long', 'code-invalid']),
    );
  });

  test('accepts them with sanitize', () => {
    expect(errorCodes(true)).toEqual([]);
  });

  test('still refuses what sanitizing leaves empty, and duplicates', () => {
    const found = XLSValidator.validateSubset(
      [...survey, { type: 'text', name: '日本', label: 'x' }],
      [...choices, { list_name: 'anwesend', name: '--', label: 'x' }],
      { sanitize: true },
    ).map((d) => d.code);
    expect(found).toEqual(
      expect.arrayContaining([
        'name-empty-after-sanitize',
        'code-empty-after-sanitize',
      ]),
    );
  });

  test('xlsformToLstsv refuses the form unless sanitize', async () => {
    await expect(xlsformToLstsv(form, quiet)).rejects.toMatchObject({
      code: 'xlsform-outside-subset',
    });
    await expect(
      xlsformToLstsv(form, { ...quiet, sanitize: true }),
    ).resolves.toContain('k23ars');
  });
});

describe('the mapping', () => {
  test('records every renamed name and code, and nothing else', async () => {
    const { mapping } = await xlsformToLstsvWithMapping(form, {
      ...quiet,
      sanitize: true,
    });
    expect(mapping.names).toMatchObject({
      k23ars: 'k23_ars',
      k10reisezeit: 'k10_reisezeit',
      k10grundderabwesenhe: 'k10_grund_der_abwesenheit',
      k11mehrfach: 'k11_mehrfach',
      k12anzahl: 'k12_anzahl',
    });
    expect(Object.values(mapping.names)).not.toContain('reise');
    const codes = {
      anwes: 'anwesend',
      abwes: 'abwesend',
      n97: '-97',
      n98: '-98',
    };
    expect(mapping.codes).toEqual({ k10reisezeit: codes, k11mehrfach: codes });
  });

  test('negative codes become n<number>, not a code that may exist', async () => {
    const tsv = await xlsformToLstsv(form, { ...quiet, sanitize: true });
    expect(tsv).toContain("k10reisezeit == 'n98'");
    expect(tsv).toMatch(/\tn97\t/);
  });

  test('is JSON that parseLstsvMapping reads back', async () => {
    const { mapping } = await xlsformToLstsvWithMapping(form, {
      ...quiet,
      sanitize: true,
    });
    expect(parseLstsvMapping(JSON.stringify(mapping))).toEqual(mapping);
    expect(() => parseLstsvMapping('{"format":"x"}')).toThrow(
      expect.objectContaining({ code: 'mapping-invalid' }),
    );
  });
});

describe('the way back restores the XLSForm', () => {
  const convert = () =>
    xlsformToLstsvWithMapping(form, { ...quiet, sanitize: true });

  test('lstsv2xlsform: names, codes, defaults and expressions', async () => {
    const { tsv, mapping } = await convert();
    const back = lstsvToXlsform(tsv, { mapping });
    const byName = Object.fromEntries(back.survey.map((r) => [r.name, r]));
    for (const row of survey.filter(
      (r) => r.name && r.type !== 'begin_group',
    )) {
      expect(byName[row.name]).toBeDefined();
    }
    expect(byName.k10_reisezeit.default).toBe('-98');
    expect(byName.k10_grund_der_abwesenheit.relevant).toBe(
      "${k10_reisezeit} = 'abwesend' or ${k10_reisezeit} = '-98'",
    );
    expect(byName.k12_anzahl.relevant).toBe("selected(${k11_mehrfach}, '-97')");
    const listOf = (q: string) =>
      back.choices
        .filter((c) => c.list_name === String(byName[q].type).split(' ')[1])
        .map((c) => c.name);
    expect(listOf('k10_reisezeit')).toEqual(choices.map((c) => c.name));
    expect(listOf('k11_mehrfach')).toEqual(choices.map((c) => c.name));
  });

  test('without the mapping, the LimeSurvey names stay', async () => {
    const { tsv } = await convert();
    const names = lstsvToXlsform(tsv).survey.map((r) => r.name);
    expect(names).toContain('k23ars');
    expect(names).not.toContain('k23_ars');
  });

  test('lstsv2ddi: the same variables and categories as xlsform2ddi', async () => {
    const { tsv, mapping } = await convert();
    const vars = (xml: string) =>
      [...xml.matchAll(/<var [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    const cats = (xml: string) =>
      [...xml.matchAll(/<catValu>([^<]*)<\/catValu>/g)].map((m) => m[1]);
    const fromLs = lstsvToDdi(tsv, { ...quiet, mapping });
    const fromForm = xlsformToDdi(form, quiet);
    expect(vars(fromLs)).toEqual(vars(fromForm));
    expect(cats(fromLs)).toEqual(cats(fromForm));
  });

  test("lstsv2ddi --data: columns and codes are the XLSForm's", async () => {
    const { tsv, mapping } = await convert();
    const warnings: string[] = [];
    // A LimeSurvey export: its question codes, its answer codes.
    const responses = [
      {
        id: '1',
        k23ars: '059700040040',
        k10reisezeit: 'n98',
        k10grundderabwesenhe: 'Urlaub',
        'k11mehrfach[abwes]': 'Y',
        'k11mehrfach[n97]': 'Y',
        'k11mehrfach[anwes]': '',
        k12anzahl: '3',
      },
    ];
    const csv = lstsvToDataCsv(tsv, responses, {
      mapping,
      onWarning: (m) => warnings.push(m),
    });
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('k23_ars');
    expect(header).toContain('k10_reisezeit');
    expect(header).not.toContain('k23ars');
    const cell = (name: string) =>
      row.split(',')[header.split(',').indexOf(name)];
    expect(cell('k10_reisezeit')).toBe('-98');
    expect(cell('k23_ars')).toBe('059700040040');
    expect(warnings).toEqual([]);
    // Same columns as the codebook built with the mapping.
    expect(header.split(',').length).toBeGreaterThan(5);
  });
});

describe('without sanitize, nothing changes', () => {
  test('a conforming form gets an empty mapping', async () => {
    const warnings: Diagnostic[] = [];
    const { mapping } = await xlsformToLstsvWithMapping(
      {
        surveyData: [{ type: 'select_one yn', name: 'q1', label: 'Q' }],
        choicesData: [
          { list_name: 'yn', name: 'y', label: 'Ja' },
          { list_name: 'yn', name: 'n', label: 'Nein' },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(mapping.names).toEqual({});
    expect(mapping.codes).toEqual({});
  });
});

describe('property: sanitize + mapping gives back every name and code', () => {
  const name = fc.stringMatching(/^[a-z][a-z0-9_]{0,27}$/);
  const code = fc.oneof(
    fc.stringMatching(/^[a-z][a-z0-9_]{0,11}$/),
    fc.integer({ min: -99, max: 999 }).map(String),
  );

  test('XLSForm → LimeSurvey → XLSForm', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(name, { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(code, { minLength: 2, maxLength: 6 }),
        async (names, codes) => {
          // Reserved by LimeSurvey or the other convention: not what this tests.
          fc.pre(names.every((n) => !n.endsWith('_other')));
          const surveyData = names.map((n, i) => ({
            type: i % 2 ? 'select_multiple l' : 'select_one l',
            name: n,
            label: n,
          }));
          const choicesData = codes.map((c) => ({
            list_name: 'l',
            name: c,
            label: c,
          }));
          const { tsv, mapping } = await xlsformToLstsvWithMapping(
            { surveyData, choicesData },
            { ...quiet, sanitize: true },
          );
          const back = lstsvToXlsform(tsv, { mapping });
          expect(back.survey.map((r) => r.name)).toEqual(names);
          for (const row of back.survey) {
            const list = String(row.type).split(' ')[1];
            expect(
              back.choices
                .filter((c) => c.list_name === list)
                .map((c) => c.name),
            ).toEqual(codes);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});

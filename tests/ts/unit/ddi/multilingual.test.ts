/**
 * Multilingual DDI (#135): the base language untagged and first, each other
 * language the form has as an `xml:lang` sibling, and nothing that isn't the
 * form's own text. The whole-survey fixture `bilingual_survey` covers every
 * element kind; these pin the edge cases.
 */
import * as XLSX from 'xlsx';
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from '../../../../src/pipelines/lstsv2ddi/index.js';
import {
  ddiToXlsform,
  xlsformToDdi,
  xlsformToLstsv,
} from '../../../../src/index.js';

const OPTS = { prodDate: '2020-01-01' };

function rootLang(xml: string): string | undefined {
  return /<codeBook [^>]*xml:lang="([^"]+)"/.exec(xml)?.[1];
}

describe('xlsform → multilingual DDI', () => {
  test('without default_language, the first language is the declared base', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'text',
          name: 'job',
          'label::Deutsch (de)': 'Beruf?',
          'label::English (en)': 'Occupation?',
        },
      ],
      [],
      OPTS,
    );
    expect(rootLang(xml)).toBe('de');
    expect(xml).toContain('<qstnLit>Beruf?</qstnLit>');
    expect(xml).toContain('<qstnLit xml:lang="en">Occupation?</qstnLit>');
  });

  test('a single-language form declares no language, as before', () => {
    const xml = buildDdiXml(
      [{ type: 'text', name: 'job', 'label::Deutsch (de)': 'Beruf?' }],
      [],
      OPTS,
    );
    expect(rootLang(xml)).toBeUndefined();
    expect(xml).not.toContain('xml:lang');
  });

  test('default_language picks the base, whatever the column order', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'text',
          name: 'job',
          'label::English (en)': 'Occupation?',
          'label::Deutsch (de)': 'Beruf?',
        },
      ],
      [],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    expect(rootLang(xml)).toBe('de');
    const base = xml.indexOf('<qstnLit>Beruf?</qstnLit>');
    const other = xml.indexOf('<qstnLit xml:lang="en">Occupation?</qstnLit>');
    expect(base).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(base);
  });

  test('xlsformToDdi warns about a language without a tag it leaves out', () => {
    const warnings: string[] = [];
    const xml = xlsformToDdi(
      {
        surveyData: [
          {
            type: 'text',
            name: 'job',
            'label::Deutsch (de)': 'Beruf?',
            'label::English': 'Occupation?',
          },
        ],
        choicesData: [],
        settingsData: [{ default_language: 'Deutsch (de)' }],
      },
      { onWarning: (w) => warnings.push(`${w.code}: ${w.message}`) },
    );
    expect(xml).not.toContain('Occupation?');
    expect(warnings).toEqual([
      expect.stringMatching(
        /^language-invalid: Language "English" has no language tag/,
      ),
    ]);
  });

  test('an untagged base language needs no tag and draws no warning', () => {
    const warnings: string[] = [];
    const xml = xlsformToDdi(
      {
        surveyData: [{ type: 'text', name: 'job', 'label::English': 'Job?' }],
        choicesData: [],
      },
      { onWarning: (w) => warnings.push(w.code) },
    );
    expect(xml).toContain('<qstnLit>Job?</qstnLit>');
    expect(warnings).not.toContain('language-invalid');
  });

  test('unvalidated, a language without a tag is left out, not mistagged', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'text',
          name: 'job',
          'label::Deutsch (de)': 'Beruf?',
          'label::English': 'Occupation?',
        },
      ],
      [],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    expect(xml).not.toContain('Occupation?');
    expect(xml).not.toContain('xml:lang="English"');
  });

  test('a text a language lacks gets no element, not the base text', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'text',
          name: 'job',
          'label::Deutsch (de)': 'Beruf?',
          'label::English (en)': 'Occupation?',
          'hint::Deutsch (de)': 'Aktuelle Tätigkeit',
        },
      ],
      [],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    expect(xml).toContain('<postQTxt>Aktuelle Tätigkeit</postQTxt>');
    expect(xml).not.toContain('<postQTxt xml:lang');
  });

  test("or_other's unauthored texts are LimeSurvey's, in each language", () => {
    const xml = buildDdiXml(
      [
        {
          type: 'select_one src or_other',
          name: 'src',
          'label::Deutsch (de)': 'Quelle?',
          'label::English (en)': 'Source?',
        },
      ],
      [
        {
          list_name: 'src',
          name: 'web',
          'label::Deutsch (de)': 'Webseite',
          'label::English (en)': 'Website',
        },
      ],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    expect(xml).toContain('<labl xml:lang="en">Website</labl>');
    // LimeSurvey's own `Other:` in each survey language: what it shows for
    // the answer and its text box alike.
    expect(xml).toContain('<labl>Sonstiges:</labl>');
    expect(xml).toContain('<labl xml:lang="en">Other:</labl>');
    expect(xml).toContain('<qstnLit>Sonstiges:</qstnLit>');
    expect(xml).toContain('<qstnLit xml:lang="en">Other:</qstnLit>');
  });
});

describe('lstsv → multilingual DDI', () => {
  const header = [
    'class',
    'type/scale',
    'name',
    'relevance',
    'text',
    'help',
    'language',
    'mandatory',
  ].join('\t');
  const line = (...cells: string[]) => cells.join('\t');

  test('additional languages become xml:lang siblings, the S language the base', () => {
    const tsv = [
      header,
      line('S', '', 'language', '1', 'de', '', '', ''),
      line('S', '', 'additional_languages', '1', 'en', '', '', ''),
      line('G', '1', 'Gruppe', '1', '', '', 'de', ''),
      line('G', '1', 'Group', '1', '', '', 'en', ''),
      line('Q', 'S', 'job', '1', 'Beruf?', '', 'de', 'N'),
      line('Q', 'S', 'job', '1', 'Occupation?', '', 'en', 'N'),
    ].join('\n');
    const xml = lstsvToDdiXml(tsv, OPTS);
    expect(rootLang(xml)).toBe('de');
    expect(xml).toContain('<qstnLit>Beruf?</qstnLit>');
    expect(xml).toContain('<qstnLit xml:lang="en">Occupation?</qstnLit>');
  });

  test('a single-language survey declares its language (#160)', () => {
    const tsv = [
      header,
      line('S', '', 'language', '1', 'de', '', '', ''),
      line('G', '1', 'Gruppe', '1', '', '', 'de', ''),
      line('Q', 'S', 'job', '1', 'Beruf?', '', 'de', 'N'),
    ].join('\n');
    expect(rootLang(lstsvToDdiXml(tsv, OPTS))).toBe('de');
  });
});

describe("the form's names for its languages (#183)", () => {
  const quiet = () => {};
  const survey = [
    {
      type: 'select_one yn',
      name: 'job',
      'label::Deutsch (de)': 'Beruf?',
      'label::English (en)': 'Occupation?',
      'hint::Deutsch (de)': 'Aktuelle Tätigkeit',
      'hint::English (en)': 'Current one',
    },
  ];
  const choices = [
    {
      list_name: 'yn',
      name: 'y',
      'label::Deutsch (de)': 'Ja',
      'label::English (en)': 'Yes',
    },
  ];
  const settings = [{ default_language: 'Deutsch (de)' }];
  const NAMES = [
    '<notes type="cdl:language" subject="de">Deutsch (de)</notes>',
    '<notes type="cdl:language" subject="en">English (en)</notes>',
  ];

  /** The sheets as an `.xlsx` workbook, as a form author saves them. */
  function workbook(): Buffer {
    const wb = XLSX.utils.book_new();
    const sheet = (rows: Record<string, unknown>[], name: string) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    sheet(survey, 'survey');
    sheet(choices, 'choices');
    sheet(settings, 'settings');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  test('JSON rows: cdl:language carries the names, and they come back', () => {
    const xml = xlsformToDdi(
      { surveyData: survey, choicesData: choices, settingsData: settings },
      { onWarning: quiet },
    );
    for (const note of NAMES) expect(xml).toContain(note);
    const back = ddiToXlsform(xml, { onWarning: quiet });
    expect(back.survey[0]).toMatchObject({
      label: { 'Deutsch (de)': 'Beruf?', 'English (en)': 'Occupation?' },
      hint: {
        'Deutsch (de)': 'Aktuelle Tätigkeit',
        'English (en)': 'Current one',
      },
    });
    expect(back.choices[0]).toMatchObject({
      label: { 'Deutsch (de)': 'Ja', 'English (en)': 'Yes' },
    });
    expect(back.settings[0]).toMatchObject({
      default_language: 'Deutsch (de)',
    });
    // The sheets it gives back convert as the form did.
    const form = {
      surveyData: back.survey,
      choicesData: back.choices,
      settingsData: back.settings,
    };
    expect(xlsformToDdi(form, { onWarning: quiet })).toBe(xml);
  });

  test('JSON rows and the .xlsx give the same codebook', () => {
    const fromJson = xlsformToDdi(
      { surveyData: survey, choicesData: choices, settingsData: settings },
      { onWarning: quiet },
    );
    expect(xlsformToDdi(workbook(), { onWarning: quiet })).toBe(fromJson);
  });

  test('the sheets read back by name convert to LimeSurvey as the form', async () => {
    const original = await xlsformToLstsv(
      { surveyData: survey, choicesData: choices, settingsData: settings },
      { onWarning: quiet },
    );
    const back = ddiToXlsform(
      xlsformToDdi(
        { surveyData: survey, choicesData: choices, settingsData: settings },
        { onWarning: quiet },
      ),
      { onWarning: quiet },
    );
    expect(
      await xlsformToLstsv(
        {
          surveyData: back.survey,
          choicesData: back.choices,
          settingsData: back.settings,
        },
        { onWarning: quiet },
      ),
    ).toBe(original);
  });

  test('a form with bare tags gets them back bare', () => {
    const xml = xlsformToDdi(
      {
        surveyData: [
          { type: 'text', name: 't', 'label::de': 'T', 'label::en': 'T' },
        ],
        choicesData: [],
      },
      { onWarning: quiet },
    );
    expect(xml).toContain('<notes type="cdl:language" subject="de">de</notes>');
    expect(ddiToXlsform(xml, { onWarning: quiet }).survey[0]).toMatchObject({
      label: { de: 'T', en: 'T' },
    });
  });
});

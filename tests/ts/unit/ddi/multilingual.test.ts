/**
 * Multilingual DDI (#135): the base language untagged and first, each other
 * language the form has as an `xml:lang` sibling, and nothing that isn't the
 * form's own text. The whole-survey fixture `bilingual_survey` covers every
 * element kind; these pin the edge cases.
 */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from '../../../../src/pipelines/lstsv2ddi/index.js';
import { xlsformToDdi } from '../../../../src/index.js';

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

  test('a single-language survey declares no language', () => {
    const tsv = [
      header,
      line('S', '', 'language', '1', 'de', '', '', ''),
      line('G', '1', 'Gruppe', '1', '', '', 'de', ''),
      line('Q', 'S', 'job', '1', 'Beruf?', '', 'de', 'N'),
    ].join('\n');
    expect(rootLang(lstsvToDdiXml(tsv, OPTS))).toBeUndefined();
  });
});

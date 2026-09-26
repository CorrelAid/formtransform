/** BCP 47 language tags (convention:languageTagging, #67). */
import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';

import { toLimeSurveyLanguage } from '../../../src/conventions/language.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import {
  extractLanguageCode,
  getBaseLanguage,
  isValidLanguageCode,
} from '../../../src/utils/languageUtils.js';
import { XLSLoader } from '../../../src/xlsform/loader.js';
import { parseTSV } from './helpers';

describe('tags', () => {
  test('well-formed BCP 47 tags are valid', () => {
    for (const tag of [
      'de',
      'fr-BE',
      'pt-br',
      'zh-Hans',
      'es-419',
      'ca-ES-valencia',
      'ckb',
    ]) {
      expect(isValidLanguageCode(tag), tag).toBe(true);
    }
    for (const tag of ['deu', 'eng', 'xx', 'en_US', 'fr-', 'english', '']) {
      expect(isValidLanguageCode(tag), tag).toBe(false);
    }
  });

  test('read from column headers and default_language', () => {
    expect(extractLanguageCode('label::Français (fr-BE)')).toBe('fr-BE');
    expect(extractLanguageCode('label::pt-br')).toBe('pt-BR');
    expect(extractLanguageCode('hint::English (en)')).toBe('en');
    expect(extractLanguageCode('label::English')).toBeNull();
    expect(getBaseLanguage({ default_language: 'de' })).toBe('de');
    expect(getBaseLanguage({ default_language: 'Deutsch (de-AT)' })).toBe(
      'de-AT',
    );
    expect(getBaseLanguage({ default_language: 'English' })).toBe('en');
  });
});

describe('BCP 47 → LimeSurvey', () => {
  test('exact, alias, then primary language', () => {
    expect(toLimeSurveyLanguage('pt-br')).toEqual({
      code: 'pt-BR',
      approximate: false,
    });
    expect(toLimeSurveyLanguage('de-informal')).toEqual({
      code: 'de-informal',
      approximate: false,
    });
    expect(toLimeSurveyLanguage('zh-TW')).toEqual({
      code: 'zh-Hant-TW',
      approximate: false,
    });
    expect(toLimeSurveyLanguage('sw')).toEqual({
      code: 'swh',
      approximate: false,
    });
    expect(toLimeSurveyLanguage('fr-BE')).toEqual({
      code: 'fr',
      approximate: true,
    });
    expect(toLimeSurveyLanguage('eo')).toBeNull();
  });
});

const survey = (langs: string[]) => [
  {
    type: 'text',
    name: 'q1',
    label: Object.fromEntries(langs.map((l) => [l, `Q (${l})`])),
    _languages: langs,
  },
];

async function convert(langs: string[], base: string) {
  const warnings: Diagnostic[] = [];
  const tsv = await new XLSFormToTSVConverter({
    onWarning: (w) => warnings.push(w),
  }).convert(survey(langs), [], [{ default_language: base }]);
  return { rows: parseTSV(tsv), warnings };
}

describe('xlsform → LimeSurvey TSV', () => {
  test('writes LimeSurvey codes, reads the XLSForm tags', async () => {
    const { rows, warnings } = await convert(['pt-BR', 'zh-TW'], 'pt-BR');
    const lang = rows.find((r) => r.class === 'S' && r.name === 'language');
    const extra = rows.find(
      (r) => r.class === 'S' && r.name === 'additional_languages',
    );
    expect(lang?.text).toBe('pt-BR');
    expect(extra?.text).toBe('zh-Hant-TW');
    const q = rows.filter((r) => r.class === 'Q' && r.name === 'q1');
    expect(q.map((r) => [r.language, r.text])).toEqual([
      ['pt-BR', 'Q (pt-BR)'],
      ['zh-Hant-TW', 'Q (zh-TW)'],
    ]);
    expect(warnings.filter((w) => w.code.startsWith('language-'))).toEqual([]);
  });

  test('a regional tag without its own code warns and uses the language', async () => {
    const { rows, warnings } = await convert(['fr-BE'], 'fr-BE');
    expect(rows.find((r) => r.class === 'Q')?.language).toBe('fr');
    expect(warnings.map((w) => w.code)).toContain('language-approximated');
  });

  test('a tag LimeSurvey cannot hold is an error', async () => {
    await expect(convert(['eo'], 'eo')).rejects.toMatchObject({
      code: 'language-unmapped',
    });
  });

  test('two tags on one LimeSurvey code is an error', async () => {
    await expect(convert(['fr', 'fr-BE'], 'fr')).rejects.toMatchObject({
      code: 'language-unmapped',
    });
  });
});

describe('loader', () => {
  test('keeps BCP 47 columns instead of dropping them', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['type', 'name', 'label::Deutsch (de)', 'label::Français (fr-BE)'],
        ['text', 'q1', 'Frage', 'Question'],
      ]),
      'survey',
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const warnings: Diagnostic[] = [];
    const { surveyData } = XLSLoader.parseXLSData(buf, {
      skipValidation: true,
      onWarning: (w) => warnings.push(w),
    });
    expect(surveyData[0].label).toEqual({ de: 'Frage', 'fr-BE': 'Question' });
    expect(warnings.filter((w) => w.code === 'language-invalid')).toEqual([]);
  });
});

describe('xlsform → DDI', () => {
  test("a regional label column uses its language's other label", () => {
    const xml = buildDdiXml(
      [{ type: 'select_one l or_other', name: 'q', 'label::de-AT': 'Q?' }],
      [{ list_name: 'l', name: 'a', 'label::de-AT': 'A' }],
      { prodDate: '2000-01-01' },
    );
    expect(xml).toContain('<labl>Sonstiges</labl>');
  });
});

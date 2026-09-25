/** FieldSanitizer output always satisfies the validator's pattern (#44). */
import { describe, test, expect } from 'vitest';

import { FieldSanitizer } from '../../../src/xlsform/sanitize.js';
import { XLSValidator } from '../../../src/xlsform/validate.js';
import { convertAndParse, findRowByName } from './helpers';

describe('FieldSanitizer (#44)', () => {
  test.each([
    ['aktivitätshäufigkeit', 'aktivitaetshaeufigke'],
    ['job satisfaction', 'jobsatisfaction'],
    ['größe', 'groesse'],
    ['q.1', 'q1'],
    ['Ärger_über-Café', 'AergerueberCafe'],
    ['snake_case_name', 'snakecasename'],
  ])('name %j → %j', (input, expected) => {
    expect(new FieldSanitizer().sanitizeNameUnique(input)).toBe(expected);
  });

  test.each([
    ['täglich', 'taegl'],
    ['sehr gut', 'sehrg'],
    ['ja/nein', 'janei'],
    ['très', 'tres'],
  ])('answer code %j → %j', (input, expected) => {
    expect(new FieldSanitizer().sanitizeAnswerCode(input)).toBe(expected);
  });

  test('sanitized names and codes pass validateSubset', () => {
    const inputs = [
      'aktivitätshäufigkeit',
      'job satisfaction',
      'größe',
      'q.1',
      'naïve façade',
    ];
    const s = new FieldSanitizer();
    const survey = inputs.map((n) => ({
      type: 'select_one c',
      name: s.sanitizeNameUnique(n),
      label: n,
    }));
    const codes = ['täglich', 'sehr gut', 'ja/nein', 'très'];
    const choices = codes.map((c) => ({
      list_name: 'c',
      name: s.sanitizeAnswerCode(c),
      label: c,
    }));
    expect(XLSValidator.validateSubset(survey, choices)).toEqual([]);
  });

  test('input with no letter or digit left is an error, not an empty name', () => {
    expect(() => new FieldSanitizer().sanitizeNameUnique('日本')).toThrow(
      /Field name "日本" has no letters or digits left/,
    );
    expect(() => new FieldSanitizer().sanitizeAnswerCode('—')).toThrow(
      /Answer code "—"/,
    );
  });
});

describe('references follow the sanitized name', () => {
  test('${größe} in relevance and labels resolves to groesse', async () => {
    const rows = await convertAndParse([
      { type: 'integer', name: 'größe', label: 'Größe' },
      {
        type: 'text',
        name: 'grund',
        label: 'Warum ${größe}?',
        relevant: '${größe} > 180',
      },
    ]);
    expect(findRowByName(rows, 'groesse')?.['type/scale']).toBe('N');
    const q = findRowByName(rows, 'grund');
    expect(q?.relevance).toBe('groesse > 180');
    expect(q?.text).toBe('Warum {groesse}?');
  });
});

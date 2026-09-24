import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';
import { parseParameters } from '../../../../src/pipelines/xlsform2lstsv/parameters.js';
import { buildDdiXml } from '../../../../src/index.js';

const range = (parameters?: string) => [
  {
    type: 'range',
    name: 'score',
    label: 'Score',
    ...(parameters ? { parameters } : {}),
  },
];

describe('Range Question Type (#33)', () => {
  test('becomes a numeric input bounded by start/end', async () => {
    const q = findRowByName(
      await convertAndParse(range('start=0 end=100 step=5')),
      'score',
    );
    expect(q?.['type/scale']).toBe('N');
    expect(q?.min_num_value_n).toBe('0');
    expect(q?.max_num_value_n).toBe('100');
    expect(q?.num_value_int_only).toBe('1');
  });

  test("uses pyxform's defaults (1..10, step 1) without parameters", async () => {
    const q = findRowByName(await convertAndParse(range()), 'score');
    expect(q?.min_num_value_n).toBe('1');
    expect(q?.max_num_value_n).toBe('10');
    expect(q?.num_value_int_only).toBe('1');
  });

  test('allows decimals when start or step is fractional', async () => {
    const q = findRowByName(
      await convertAndParse(range('start=0 end=1 step=0.1')),
      'score',
    );
    expect(q?.max_num_value_n).toBe('1');
    expect(q?.num_value_int_only ?? '').toBe('');
  });

  test('rejects a non-numeric bound', async () => {
    await expect(convertAndParse(range('start=low end=10'))).rejects.toThrow(
      /range 'score': parameter start=low is not a number/,
    );
  });

  test('is numeric/contin in DDI', () => {
    const xml = buildDdiXml(range('start=0 end=10'), []);
    expect(xml).toMatch(/<var [^>]*name="score" intrvl="contin"/);
    expect(xml).toContain('responseDomainType="numeric"');
    expect(xml).toContain('<varFormat type="numeric"');
  });

  test('other numeric types get no bound attributes', async () => {
    const q = findRowByName(
      await convertAndParse([
        { type: 'integer', name: 'n', label: 'N', parameters: 'start=0' },
      ]),
      'n',
    );
    expect(q?.min_num_value_n ?? '').toBe('');
  });
});

describe('parseParameters', () => {
  test('accepts space, comma and semicolon separators and ignores junk', () => {
    expect(parseParameters('start=0, end=100;step=5 junk')).toEqual({
      start: '0',
      end: '100',
      step: '5',
    });
  });

  test('returns {} for an empty or missing cell', () => {
    expect(parseParameters(undefined)).toEqual({});
    expect(parseParameters('')).toEqual({});
  });
});

/**
 * #239: `appearance: columns-n` (and `columns`) on select_one / select_multiple
 * becomes LimeSurvey's `display_columns` question attribute, and comes back.
 */
import { describe, expect, test } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { findRowByName, parseTSV } from './helpers';

const choices = [
  { list_name: 'yn', name: 'ja', label: 'Ja' },
  { list_name: 'yn', name: 'nein', label: 'Nein' },
];

async function convert(survey: Record<string, unknown>[]) {
  const warnings: Diagnostic[] = [];
  const tsv = await new XLSFormToTSVConverter({
    onWarning: (w) => warnings.push(w),
  }).convert(survey, choices, [{ form_title: 'T', default_language: 'de' }]);
  return { tsv, rows: parseTSV(tsv), warnings };
}

const q = (appearance: string, type = 'select_one yn') => ({
  type,
  name: 'q1',
  label: 'Q',
  appearance,
});

const cols = (rows: unknown[]) =>
  ((findRowByName(rows as never, 'q1') ?? {}) as Record<string, string>)[
    'display_columns'
  ] ?? '';

describe('columns-n → display_columns', () => {
  test.each([
    ['columns-2', 'select_one yn', '2'],
    ['columns-3', 'select_one yn', '3'],
    ['columns-3', 'select_multiple yn', '3'],
    ['columns', 'select_one yn', '2'],
    ['columns', 'select_multiple yn', '2'],
    ['columns-8', 'select_one yn', '8'],
  ])('%s on %s sets display_columns=%s, no warning', async (a, t, n) => {
    const { rows, warnings } = await convert([q(a, t)]);
    expect(cols(rows)).toBe(n);
    expect(warnings).toEqual([]);
  });

  test('no display_columns column without the appearance', async () => {
    const { tsv } = await convert([q('')]);
    expect(tsv.split('\n')[0].split('\t')).not.toContain('display_columns');
  });

  test.each(['columns-0', 'columns-9', 'columns-x', 'columns-'])(
    '%s warns and sets nothing',
    async (a) => {
      const { rows, warnings } = await convert([q(a)]);
      expect(cols(rows)).toBe('');
      expect(warnings.map((w) => w.code)).toEqual(
        a === 'columns-x' || a === 'columns-'
          ? ['appearance-unregistered']
          : ['appearance-invalid-columns'],
      );
    },
  );

  test('columns on a text question warns', async () => {
    const { rows, warnings } = await convert([q('columns-2', 'text')]);
    expect(cols(rows)).toBe('');
    expect(warnings.map((w) => w.code)).toEqual([
      'appearance-invalid-for-type',
    ]);
  });

  test('columns wins over horizontal: no button theme', async () => {
    const { rows } = await convert([q('horizontal columns-3')]);
    expect(cols(rows)).toBe('3');
    expect(
      (findRowByName(rows, 'q1') as Record<string, string>)[
        'question_theme_name'
      ] ?? '',
    ).toBe('');
  });

  test('a dropdown has no columns', async () => {
    const { rows } = await convert([q('minimal columns-2')]);
    expect(findRowByName(rows, 'q1')!['type/scale']).toBe('!');
    expect(cols(rows)).toBe('');
  });

  test.each(['select_one yn', 'select_multiple yn'])(
    'round trip %s: columns-3 comes back',
    async (type) => {
      const { tsv } = await convert([q('columns-3', type)]);
      const back = await lstsvToXlsform(tsv);
      const row = back.survey.find((r) => r.name === 'q1')!;
      expect(row['appearance']).toBe('columns-3');
    },
  );

  test('plain columns comes back as columns-2', async () => {
    const { tsv } = await convert([q('columns')]);
    const back = await lstsvToXlsform(tsv);
    expect(back.survey.find((r) => r.name === 'q1')!['appearance']).toBe(
      'columns-2',
    );
  });
});

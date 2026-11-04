/**
 * #227: `appearance: horizontal` (and `horizontal-compact`) on a select_one
 * becomes LimeSurvey's `bootstrap_buttons` question theme, and comes back.
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

const theme = (rows: unknown[]) =>
  ((findRowByName(rows as never, 'q1') ?? {}) as Record<string, string>)[
    'question_theme_name'
  ] ?? '';

describe('horizontal → bootstrap_buttons', () => {
  test.each(['horizontal', 'horizontal-compact'])(
    '%s on select_one sets the theme, type stays L, no warning',
    async (appearance) => {
      const { rows, warnings } = await convert([q(appearance)]);
      expect(theme(rows)).toBe('bootstrap_buttons');
      expect(findRowByName(rows, 'q1')!['type/scale']).toBe('L');
      expect(warnings).toEqual([]);
    },
  );

  test('no question_theme_name column without the appearance', async () => {
    const { tsv } = await convert([q('')]);
    expect(tsv.split('\n')[0].split('\t')).not.toContain('question_theme_name');
  });

  test('a dropdown appearance wins over the theme', async () => {
    const { rows } = await convert([q('minimal horizontal')]);
    expect(findRowByName(rows, 'q1')!['type/scale']).toBe('!');
    expect(theme(rows)).toBe('');
  });

  test('horizontal on select_multiple warns and sets no theme', async () => {
    const { rows, warnings } = await convert([
      q('horizontal', 'select_multiple yn'),
    ]);
    expect(theme(rows)).toBe('');
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('round trip: bootstrap_buttons comes back as horizontal', async () => {
    for (const appearance of ['horizontal', 'horizontal-compact']) {
      const { tsv } = await convert([q(appearance)]);
      const back = await lstsvToXlsform(tsv);
      const row = back.survey.find((r) => r.name === 'q1');
      expect(row?.type).toBe('select_one q1');
      // Both give the same theme; the first registered appearance is the way back.
      expect(row?.appearance).toBe('horizontal');
    }
  });
});

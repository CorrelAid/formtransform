/** convention:exclusiveChoice — the `exclusive` choices column (#53). */
import { describe, test, expect, vi } from 'vitest';

import { XLSValidator } from '../../../src/xlsform/validate.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { convertAndParse, findRowByName } from './helpers';

const survey = [{ type: 'select_multiple l', name: 'q1', label: 'Was?' }];
const choices = [
  { list_name: 'l', name: 'a', label: 'A' },
  { list_name: 'l', name: 'none', label: 'Nichts davon', exclusive: 'yes' },
  { list_name: 'l', name: 'dontknow', label: 'Weiß nicht', exclusive: 'TRUE' },
];

describe('exclusive → exclude_all_others', () => {
  test('lists the exclusive codes, sanitized, `;`-joined', async () => {
    const q = findRowByName(await convertAndParse(survey, choices), 'q1');
    // dontknow is truncated to the 5-character code LimeSurvey stores.
    expect(q?.exclude_all_others).toBe('none;dontk');
  });

  test('no attribute without exclusive choices, or on select_one', async () => {
    const plain = choices.map(({ exclusive: _, ...c }) => c);
    expect(
      findRowByName(await convertAndParse(survey, plain), 'q1')
        ?.exclude_all_others ?? '',
    ).toBe('');
    const one = [{ type: 'select_one l', name: 'q1', label: 'Was?' }];
    expect(
      findRowByName(await convertAndParse(one, choices), 'q1')
        ?.exclude_all_others ?? '',
    ).toBe('');
  });

  test('round-trips through LimeSurvey TSV → XLSForm', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(survey, choices, []);
    const back = lstsvToXlsform(tsv, { skipValidation: true });
    const marked = back.choices
      .filter((c) => c.exclusive === 'yes')
      .map((c) => c.name);
    expect(marked).toEqual(['none', 'dontk']);
  });
});

describe('validateSubset and the loader', () => {
  const warnings = (s: typeof survey, c: Record<string, unknown>[]) =>
    XLSValidator.validateSubset(s, c)
      .filter((v) => v.severity === 'warning')
      .map((v) => v.message);

  test('a valid mark gives no finding', () => {
    expect(warnings(survey, choices)).toEqual([]);
  });

  test('an unrecognised value is a warning', () => {
    expect(
      warnings(survey, [
        { list_name: 'l', name: 'a', label: 'A', exclusive: 'maybe' },
      ]),
    ).toEqual([
      'choice "a" (list "l"): "exclusive" value "maybe" isn\'t recognised (use yes/true/1) and is ignored',
    ]);
  });

  test('a mark on a list no select_multiple uses is a warning', () => {
    expect(
      warnings(
        [{ type: 'select_one l', name: 'q1', label: 'Q' }],
        [{ list_name: 'l', name: 'none', label: 'Keine', exclusive: 'yes' }],
      ),
    ).toEqual([
      'choice "none" (list "l") is marked "exclusive", but no select_multiple uses this list, so it has no effect',
    ]);
  });

  test('the choices sheet accepts the exclusive column without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    XLSValidator.validateChoicesSheetColumns(choices, 'choices');
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/unexpected columns/);
    warn.mockRestore();
  });
});

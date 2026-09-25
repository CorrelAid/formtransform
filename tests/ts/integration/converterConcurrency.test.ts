/**
 * #62: XLSFormToTSVConverter keeps no per-conversion state on the instance, so
 * one instance can run several conversions at once. Before, a second call's
 * reset wiped the first call's choice lists mid-run.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/index.js';

const SURVEYS = resolve(__dirname, '../../fixtures/surveys');
type Form = { survey: never[]; choices?: never[]; settings?: never[] };
const load = (name: string) =>
  JSON.parse(
    readFileSync(join(SURVEYS, name, 'xlsform.json'), 'utf-8'),
  ) as Form;
const run = (c: XLSFormToTSVConverter, f: Form) =>
  c.convert(f.survey, f.choices ?? [], f.settings ?? []);

const NAMES = [
  'complex_survey',
  'multilingual_survey',
  'complex_xpath_survey',
  'validation_relevance_survey',
];

describe('XLSFormToTSVConverter concurrency', () => {
  test('concurrent convert() calls on one instance match separate instances', async () => {
    const forms = NAMES.map(load);
    const expected = await Promise.all(
      forms.map((f) => run(new XLSFormToTSVConverter(), f)),
    );

    const shared = new XLSFormToTSVConverter();
    const actual = await Promise.all(forms.map((f) => run(shared, f)));
    expect(actual).toEqual(expected);
  });

  test('reusing one instance sequentially gives identical output', async () => {
    const c = new XLSFormToTSVConverter();
    const f = load('complex_survey');
    expect(await run(c, f)).toBe(await run(c, f));
  });

  test('a conversion error rejects the promise; it does not throw synchronously', async () => {
    const c = new XLSFormToTSVConverter();
    const p = c.convert(
      [{ type: 'select_one missing', name: 'q', label: 'Q' }] as never[],
      [],
      [],
    );
    await expect(p).rejects.toMatchObject({ code: 'choice-list-empty' });
  });
});

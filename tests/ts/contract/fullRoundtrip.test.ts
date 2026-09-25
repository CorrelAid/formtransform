/**
 * Full-pipeline round-trip: XLSForm → (xlsform2lstsv) → TSV → (lstsv2xlsform)
 * → XLSForm, on synthetic forms that exercise fields NO registry fixture uses.
 *
 * The fixture-based `lstsv2xlsformRoundtrip.test.ts` compares committed `tsv.tsv` against
 * committed `xlsform.json`, but none of the 13 fixtures uses `constraint`,
 * `required`, or `default` — so those paths would otherwise only ever be tested
 * against hand-built row arrays, never through the real forward converter.
 */
import { describe, test, expect } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import type { SurveyRow, ChoiceRow } from '../../../src/xlsform/types.js';

async function roundTrip(
  survey: SurveyRow[],
  choices: ChoiceRow[] = [],
): Promise<SurveyRow[]> {
  const tsv = await new XLSFormToTSVConverter().convert(
    survey,
    choices,
    [],
    {},
  );
  return lstsvToXlsform(tsv).survey;
}

describe('full pipeline round-trip (forward → reverse)', () => {
  test('constraint survives the round trip', async () => {
    const survey = await roundTrip([
      {
        type: 'integer',
        name: 'alter',
        label: 'Alter?',
        constraint: '. >= 18 and . <= 100',
      },
    ]);
    expect(survey[0]).toMatchObject({
      name: 'alter',
      constraint: '. >= 18 and . <= 100',
    });
  });

  test('relevance referencing a select_one survives the round trip', async () => {
    const survey = await roundTrip(
      [
        { type: 'select_one farbe', name: 'farbe', label: 'Farbe?' },
        {
          type: 'text',
          name: 'grund',
          label: 'Warum?',
          relevant: "${farbe} = 'rot'",
        },
      ],
      [
        { list_name: 'farbe', name: 'rot', label: 'Rot' },
        { list_name: 'farbe', name: 'blau', label: 'Blau' },
      ],
    );
    expect(survey[1]).toMatchObject({
      name: 'grund',
      relevant: "${farbe} = 'rot'",
    });
  });

  test('relevance referencing a select_multiple survives as selected()', async () => {
    const survey = await roundTrip(
      [
        { type: 'select_multiple lang', name: 'lang', label: 'Sprachen?' },
        {
          type: 'text',
          name: 'wo',
          label: 'Wo gelernt?',
          relevant: "selected(${lang}, 'de')",
        },
      ],
      [
        { list_name: 'lang', name: 'de', label: 'Deutsch' },
        { list_name: 'lang', name: 'en', label: 'Englisch' },
      ],
    );
    expect(survey[1]).toMatchObject({
      name: 'wo',
      relevant: "selected(${lang}, 'de')",
    });
  });

  test('required and default survive the round trip', async () => {
    const survey = await roundTrip([
      {
        type: 'integer',
        name: 'alter',
        label: 'Alter?',
        required: 'yes',
        default: '18',
      },
    ]);
    expect(survey[0]).toMatchObject({ required: 'yes', default: '18' });
  });
});

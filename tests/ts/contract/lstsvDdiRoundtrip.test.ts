/**
 * The DDI round trips through LimeSurvey (#160), on every fixture form
 * (`roundtripCases.ts`), compared on the model (`canonicalInstrument.ts`):
 *
 * - A LimeSurvey TSV → DDI → Instrument is the TSV's own Instrument: the
 *   codebook loses nothing a TSV holds.
 * - XLSForm → LimeSurvey → DDI → XLSForm is XLSForm → LimeSurvey → XLSForm:
 *   going through DDI adds no loss to LimeSurvey's.
 * - XLSForm → DDI → XLSForm → LimeSurvey is XLSForm → LimeSurvey, to the
 *   byte: the XLSForm DDI gives back converts as the original does.
 *
 * `lstsv2ddiRoundtrip.test.ts` compares the codebooks of both paths as text.
 */
import { describe, test, expect } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { lstsvToDdiXml } from '../../../src/pipelines/lstsv2ddi/index.js';
import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../src/pipelines/ddi2xlsform/index.js';
import { instrumentFromDdi } from '../../../src/instrument/fromDdi.js';
import { instrumentFromLstsv } from '../../../src/instrument/fromLstsv.js';
import { instrumentFromXlsform } from '../../../src/instrument/fromXlsform.js';
import { parseLstsv } from '../../../src/lstsv/parser.js';
import type { XlsformOutput } from '../../../src/xlsform/fromInstrument.js';
import type {
  ChoiceRow,
  SettingsRow,
  SurveyRow,
} from '../../../src/xlsform/types.js';
import { canonical } from './canonicalInstrument.js';
import { cases, type Case } from './roundtripCases.js';

const CASES = cases();
const WITH_TSV = CASES.filter((c) => c.tsv);
const quiet = () => {};

/** The form's LimeSurvey TSV, or `null` for a form LimeSurvey can't hold. */
async function toTsv(sheets: {
  survey: unknown[];
  choices: unknown[];
  settings: unknown[];
}): Promise<string | null> {
  try {
    return await new XLSFormToTSVConverter().convert(
      sheets.survey as SurveyRow[],
      sheets.choices as ChoiceRow[],
      sheets.settings as SettingsRow[],
    );
  } catch {
    return null;
  }
}

const fromSheets = (s: XlsformOutput) =>
  canonical(instrumentFromXlsform(s.survey, s.choices, s.settings));

function codebook(c: Pick<Case, 'survey' | 'choices' | 'settings'>): string {
  return buildDdiXml(c.survey, c.choices, {
    prodDate: '2020-01-01',
    settings: c.settings[0] ?? {},
  });
}

describe('LimeSurvey TSV → DDI → Instrument', () => {
  test('there are TSVs', () => {
    expect(WITH_TSV.length).toBeGreaterThan(20);
  });

  test.each(WITH_TSV)('$name', (c) => {
    const tsv = c.tsv!;
    const own = instrumentFromLstsv(parseLstsv(tsv), {
      expressions: true,
      onWarning: quiet,
    });
    const back = instrumentFromDdi(
      lstsvToDdiXml(tsv, { prodDate: '2020-01-01', onWarning: quiet }),
    );
    expect(canonical(back)).toEqual(canonical(own));
  });
});

describe('XLSForm → LimeSurvey → DDI → XLSForm', () => {
  test.each(CASES)('$name', async (c) => {
    const tsv = await toTsv(c);
    if (tsv === null) return;
    const viaDdi = ddiToXlsform(
      lstsvToDdiXml(tsv, { prodDate: '2020-01-01', onWarning: quiet }),
    );
    expect(fromSheets(viaDdi)).toEqual(fromSheets(lstsvToXlsform(tsv)));
  });
});

describe('XLSForm → LimeSurvey → DDI → XLSForm, found by the generated forms', () => {
  // A group titled like a question: LimeSurvey's group name is its title,
  // which the way back took for the XLSForm name, so the table and the
  // select were both `q4` and the codebook lost the group (#197).
  test('a table of numbers titled like the select after it', async () => {
    const label = (de: string, en: string) => ({
      'label::Deutsch (de)': de,
      'label::English (en)': en,
    });
    const tsv = await toTsv({
      survey: [
        {
          type: 'begin_group',
          name: 'table1',
          appearance: 'table-list',
          ...label('q4', 'a'),
        },
        { type: 'integer', name: 'q2', ...label('A', 'B') },
        { type: 'end_group' },
        { type: 'begin_group', name: 'g3', ...label('C', 'D') },
        { type: 'select_one q4 or_other', name: 'q4', ...label('E', 'F') },
        { type: 'end_group' },
      ],
      choices: [{ list_name: 'q4', name: 'c1', ...label('G', 'H') }],
      settings: [{ default_language: 'Deutsch (de)' }],
    });
    const back = lstsvToXlsform(tsv!);
    const names = back.survey.map((r) => r['name']).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
    const viaDdi = ddiToXlsform(
      lstsvToDdiXml(tsv!, { prodDate: '2020-01-01', onWarning: quiet }),
    );
    expect(fromSheets(viaDdi)).toEqual(fromSheets(back));
  });
});

describe('XLSForm → DDI → XLSForm → LimeSurvey', () => {
  test.each(CASES)('$name', async (c) => {
    const tsv = await toTsv(c);
    if (tsv === null) return;
    expect(await toTsv(ddiToXlsform(codebook(c)))).toBe(tsv);
  });
});

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

describe('XLSForm → DDI → XLSForm → LimeSurvey', () => {
  test.each(CASES)('$name', async (c) => {
    const tsv = await toTsv(c);
    if (tsv === null) return;
    expect(await toTsv(ddiToXlsform(codebook(c)))).toBe(tsv);
  });
});

/**
 * LimeSurvey structure-TSV rows → XLSForm: parsed into the Instrument
 * (`instrumentFromLstsv`, expressions reversed), then emitted by the shared
 * XLSForm emitter (`src/xlsform/fromInstrument.ts`). See `./README.md` for
 * the known losses.
 */
import { instrumentFromLstsv } from '../../instrument/fromLstsv.js';
import {
  xlsformFromInstrument,
  type XlsformOutput,
} from '../../xlsform/fromInstrument.js';

export type { XlsformOutput };

type Row = Record<string, string>;

/**
 * Reconstruct XLSForm survey/choices/settings rows from parsed LimeSurvey
 * structure-TSV rows: parsed into the Instrument (`instrumentFromLstsv`),
 * then emitted from it. See the module docstring for the known lossy
 * reconstructions.
 */
export function lstsvRowsToXlsform(rows: Row[]): XlsformOutput {
  return xlsformFromInstrument(
    instrumentFromLstsv(rows, { expressions: true }),
  );
}

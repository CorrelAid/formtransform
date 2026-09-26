/**
 * LimeSurvey structure-TSV rows → the DDI's {@link Variable} list. The rows are
 * parsed into the Instrument model (`src/instrument/fromLstsv.ts`), which maps
 * LimeSurvey codes back to XLSForm types, then projected exactly like an
 * XLSForm (`src/ddi/fromInstrument.ts`). LimeSurvey's collapses (D → date,
 * N → decimal, S/T → text) are DDI-lossless.
 */

import type { Variable } from '../../ddi/types.js';
import {
  choicesFromInstrument,
  variablesFromInstrument,
} from '../../ddi/fromInstrument.js';
import { instrumentFromLstsv } from '../../instrument/fromLstsv.js';

type Row = Record<string, string>;

/**
 * Flatten LimeSurvey structure-TSV rows into an ordered {@link Variable} list:
 * parsed into the Instrument model (#69), then projected like an XLSForm's.
 */
export function lstsvToVariables(rows: Row[]): Variable[] {
  const instrument = instrumentFromLstsv(rows);
  return variablesFromInstrument(instrument, choicesFromInstrument(instrument));
}

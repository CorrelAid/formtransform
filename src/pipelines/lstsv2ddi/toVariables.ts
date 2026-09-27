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
import type { WarningHandler } from '../../diagnostics.js';

type Row = Record<string, string>;

/**
 * Flatten LimeSurvey structure-TSV rows into an ordered {@link Variable} list:
 * parsed into the Instrument model (#69), then projected like an XLSForm's.
 */
export function lstsvToVariables(rows: Row[]): Variable[] {
  return lstsvProjection(rows).variables;
}

/**
 * {@link lstsvToVariables} with relevance and constraints reversed into XPath
 * for the DDI's logic (#151): one outside the dialect gets a warning and is
 * left out, rather than failing the conversion. Plus, for a survey in several languages, its base
 * language (the `language` S row, as a BCP 47 tag): the DDI declares it as
 * `codeBook/@xml:lang` so the untagged texts say their language. A
 * single-language survey's DDI stays undeclared, as an XLSForm's without
 * `default_language` does.
 */
export function lstsvProjection(
  rows: Row[],
  onWarning?: WarningHandler,
): {
  variables: Variable[];
  language?: string;
} {
  const instrument = instrumentFromLstsv(rows, {
    expressions: true,
    onWarning: onWarning ?? (() => {}),
  });
  return {
    variables: variablesFromInstrument(
      instrument,
      choicesFromInstrument(instrument),
      { onWarning },
    ),
    language:
      instrument.languages.length > 1 ? instrument.defaultLanguage : undefined,
  };
}

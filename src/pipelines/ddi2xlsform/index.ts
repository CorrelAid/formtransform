/**
 * DDI Codebook 2.5 → XLSForm (#154): parsed into the Instrument
 * (`src/instrument/fromDdi.ts`), then emitted by the shared XLSForm emitter
 * (`src/xlsform/fromInstrument.ts`). See `./README.md` for what a CDL
 * codebook gives back and what any other DDI can't.
 */
import type { WarningHandler } from '../../diagnostics.js';
import { instrumentFromDdi } from '../../instrument/fromDdi.js';
import {
  xlsformFromInstrument,
  type XlsformOutput,
} from '../../xlsform/fromInstrument.js';

export type { XlsformOutput };

export interface DdiToXlsformOptions {
  /** Receives what the DDI can't supply; the conversion never stops for it. */
  onWarning?: WarningHandler;
}

/**
 * The XLSForm sheets (`{ survey, choices, settings }`) of a DDI codebook or
 * fragment (`<dataDscr>`, `<var>`, `<varGrp>`). Throws `ddi-invalid` only
 * when the XML is not well-formed or holds no `<var>`.
 */
export function ddiToXlsform(
  xml: string,
  options: DdiToXlsformOptions = {},
): XlsformOutput {
  return xlsformFromInstrument(instrumentFromDdi(xml, options));
}

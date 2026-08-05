/**
 * DDI-Codebook 2.5 format module: the XML emitter over the canonical
 * `Variable[]` model, plus the model itself.
 *
 * Direction-specific work lives in `pipelines/` — `xlsform2ddi/` extracts
 * variables from XLSForm rows, `lstsv2ddi/` from LimeSurvey TSV rows. Both then
 * call `buildDdiCodebook` here.
 */

export { buildDdiCodebook } from './codebook.js';
export type { BuildDdiOptions, DdiSettings } from './codebook.js';
export { classifyNotes } from './notes.js';
export type { ClassifiedNotes } from './notes.js';
export { XmlElement, escapeXml } from './xml.js';
export type { Choice, Variable } from './types.js';

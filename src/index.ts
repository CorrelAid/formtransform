// ── Format modules ─────────────────────────────────────────────────────
export { XLSLoader } from './xlsform/loader.js';
export { XLSFormParser } from './xlsform/parser.js';
export { XLSValidator } from './xlsform/validate.js';
export type { SubsetViolation } from './xlsform/validate.js';
export { FieldSanitizer } from './xlsform/sanitize.js';

export { parseLstsv } from './lstsv/parser.js';
export { TSVGenerator } from './lstsv/serialize.js';
export { validateLstsvSubset } from './lstsv/validate.js';

export { buildDdiCodebook } from './ddi/index.js';
export type {
  BuildDdiOptions,
  DdiSettings,
  Choice,
  Variable,
} from './ddi/index.js';

// ── Pipelines (one per supported direction) ────────────────────────────
export { XLSFormToTSVConverter } from './pipelines/xlsform2lstsv/index.js';
export {
  convertRelevance,
  convertConstraint,
  xpathToLimeSurvey,
} from './pipelines/xlsform2lstsv/xpathTranspiler.js';
export {
  TypeMapper,
  TypeInfo,
  LSType,
  TYPE_MAPPINGS,
} from './pipelines/xlsform2lstsv/typeMapper.js';

export { buildDdiXml } from './pipelines/xlsform2ddi/index.js';

export {
  lstsvToDdiXml,
  lstsvToVariables,
} from './pipelines/lstsv2ddi/index.js';
export type { LstsvToDdiOptions } from './pipelines/lstsv2ddi/index.js';

export {
  lstsvToXlsform,
  lstsvRowsToXlsform,
} from './pipelines/lstsv2xlsform/index.js';
export type {
  LstsvToXlsformOptions,
  XlsformOutput,
} from './pipelines/lstsv2xlsform/index.js';

// ── Config ─────────────────────────────────────────────────────────────
export { ConfigManager, ConversionConfig } from './config/ConfigManager.js';
export { defaultConfig } from './config/types.js';

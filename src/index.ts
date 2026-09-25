// ── Format modules ─────────────────────────────────────────────────────
export { XLSLoader } from './xlsform/loader.js';
export { XLSFormParser } from './xlsform/parser.js';
export { XLSValidator } from './xlsform/validate.js';
export type {
  SubsetViolation,
  SubsetOptions,
  SubsetTarget,
} from './xlsform/validate.js';
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

// ── Registry catalogues (generated; the public "what exists" surface) ──
export { QUESTION_TYPES } from './generated/QuestionTypes.js';
export type {
  QuestionTypeEntry,
  QuestionTypeConstraints,
} from './generated/QuestionTypes.js';
export { APPEARANCES } from './generated/Appearances.js';
export type { AppearanceSpec } from './generated/Appearances.js';

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
  extractVariables,
  choicesByListFromRows,
  normalizeChoices,
} from './pipelines/xlsform2ddi/variables.js';
export {
  buildDataCsv,
  getDdiColumnNames,
  remapSubmissionsToDdi,
} from './pipelines/xlsform2ddi/data.js';
export type { Submission } from './pipelines/xlsform2ddi/data.js';
export { parseResponses } from './responseFile.js';
export { parseVocabCsv } from './vocab.js';

export {
  lstsvToDataCsv,
  lstsvToDdiXml,
  lstsvToVariables,
  normalizeLimeSurveyResponses,
} from './pipelines/lstsv2ddi/index.js';
export type {
  LstsvToDataCsvOptions,
  LstsvToDdiOptions,
  NormalizeResponsesOptions,
} from './pipelines/lstsv2ddi/index.js';

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

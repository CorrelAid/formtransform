// ── Conversions (one function per direction) ───────────────────────────
export { xlsformToLstsv, xlsformToDdi, lstsvToDdi } from './api.js';
export type {
  XlsformSource,
  XlsformToLstsvOptions,
  XlsformToDdiOptions,
} from './api.js';
export { lstsvToXlsform } from './pipelines/lstsv2xlsform/index.js';
export type {
  LstsvToXlsformOptions,
  XlsformOutput,
} from './pipelines/lstsv2xlsform/index.js';
export type { LstsvToDdiOptions } from './pipelines/lstsv2ddi/index.js';

// ── Diagnostics ────────────────────────────────────────────────────────
export { ConversionError, consoleWarning } from './diagnostics.js';
export type {
  Diagnostic,
  DiagnosticCode,
  Severity,
  WarningHandler,
} from './diagnostics.js';

// ── Loading and validation ─────────────────────────────────────────────
export { XLSLoader } from './xlsform/loader.js';
export type { LoadOptions } from './xlsform/loader.js';
export { XLSValidator } from './xlsform/validate.js';
export type {
  SubsetViolation,
  SubsetOptions,
  SubsetTarget,
} from './xlsform/validate.js';
export { FieldSanitizer } from './xlsform/sanitize.js';
export { parseLstsv } from './lstsv/parser.js';
export { validateLstsvSubset } from './lstsv/validate.js';
export { parseVocabCsv } from './vocab.js';

// ── Registry catalogues (generated; the public "what exists" surface) ──
export { QUESTION_TYPES } from './generated/QuestionTypes.js';
export type {
  QuestionTypeEntry,
  QuestionTypeConstraints,
} from './generated/QuestionTypes.js';
export { APPEARANCES } from './generated/Appearances.js';
export type { AppearanceSpec } from './generated/Appearances.js';
export { TYPE_MAPPINGS } from './pipelines/xlsform2lstsv/typeMapper.js';

// ── Response data ──────────────────────────────────────────────────────
export {
  extractVariables,
  choicesByListFromRows,
} from './pipelines/xlsform2ddi/variables.js';
export {
  buildDataCsv,
  getDdiColumnNames,
  remapSubmissionsToDdi,
} from './ddi/data.js';
export type { Submission } from './ddi/data.js';
export { parseResponses } from './responseFile.js';
export {
  lstsvToDataCsv,
  lstsvToVariables,
  normalizeLimeSurveyResponses,
} from './pipelines/lstsv2ddi/index.js';
export type {
  LstsvToDataCsvOptions,
  NormalizeResponsesOptions,
} from './pipelines/lstsv2ddi/index.js';

// ── Types and config ───────────────────────────────────────────────────
export type {
  BuildDdiOptions,
  DdiSettings,
  Choice,
  Variable,
} from './ddi/index.js';
export { defaultConfig } from './config/types.js';
export type { LstsvConfig } from './config/types.js';
export type {
  SurveyRow,
  ChoiceRow,
  SettingsRow,
  XLSFormData,
} from './xlsform/types.js';

// ── Deprecated: renamed, or moving to `@correlaid/formtransform/internals`
// (#66). Kept here until the next minor release.
export * from './deprecated.js';

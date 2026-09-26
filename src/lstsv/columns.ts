/**
 * The LimeSurvey structure-TSV columns this library writes: the single list
 * the row type and the header order are derived from.
 *
 * https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure
 */

/** Always written, in this order. `hidden` is optional per row. */
export const BASE_COLUMNS = [
  'class',
  'type/scale',
  'name',
  'relevance',
  'text',
  'help',
  'language',
  'validation',
  'em_validation_q',
  'mandatory',
  'other',
  'default',
  'same_default',
  'hidden',
] as const;

/**
 * LimeSurvey question-attribute columns, written only when some row sets them
 * (a survey that uses none keeps a lean TSV), in this order.
 *
 * - `cssclass`: vocabulary provenance on `select_*_from_file` questions
 *   (`cdlvocab-<id>`, convention:externalCodeList). A registered attribute,
 *   so it survives import; an unregistered custom column would be dropped.
 * - `hide_tip`: `1` suppresses LimeSurvey's stock per-question tip
 *   (config `hideQuestionTips`).
 * - `date_format`: date/time widget format, from the registry's
 *   `limesurvey.dateFormat`.
 * - `min_num_value_n`, `max_num_value_n`, `num_value_int_only`: numeric input
 *   bounds from the XLSForm `parameters` column (`range`), via the registry's
 *   `limesurvey.parameterAttributes` / `integerOnly`.
 * - `exclude_all_others`: exclusive answers of a multiple choice
 *   (convention:exclusiveChoice).
 * - `other_replace_text`: the label of the native "other" answer's text box,
 *   carrying the XLSForm `<question>_other` companion's label (convention:other).
 *
 * A registry attribute missing here would be dropped silently; a test checks
 * the registry against this list.
 */
export const ATTRIBUTE_COLUMNS = [
  'cssclass',
  'hide_tip',
  'date_format',
  'min_num_value_n',
  'max_num_value_n',
  'num_value_int_only',
  'exclude_all_others',
  'other_replace_text',
] as const;

export type BaseColumn = (typeof BASE_COLUMNS)[number];
export type AttributeColumn = (typeof ATTRIBUTE_COLUMNS)[number];

/** One TSV row: every base column except `hidden` is set; attributes are optional. */
export type TSVRow = Record<Exclude<BaseColumn, 'hidden'>, string> &
  Partial<Record<'hidden' | AttributeColumn, string>>;

/** XLSForm data as the loaders produce it: one object per sheet row. */

/**
 * Represents a row in the survey section of an XLSForm
 */
export interface SurveyRow {
  type?: string;
  name?: string;
  label?: string | Record<string, string>;
  hint?: string | Record<string, string>;
  required?: string;
  relevant?: string;
  constraint?: string;
  constraint_message?: string | Record<string, string>;
  calculation?: string;
  default?: string;
  _languages?: string[];
  [key: string]: unknown;
}

/**
 * Represents a row in the choices section of an XLSForm
 */
export interface ChoiceRow {
  list_name?: string;
  name?: string;
  label?: string | Record<string, string>;
  filter?: string;
  _languages?: string[];
  [key: string]: unknown;
}

/**
 * Represents a row in the settings section of an XLSForm
 */
export interface SettingsRow {
  form_title?: string;
  form_id?: string;
  default_language?: string;
  style?: string;
  [key: string]: unknown;
}

/**
 * Result type returned by XLS/XLSX loaders
 */
export interface XLSFormData {
  surveyData: SurveyRow[];
  choicesData: ChoiceRow[];
  settingsData: SettingsRow[];
  hasSurveySheet: boolean;
  hasChoicesSheet: boolean;
  hasSettingsSheet: boolean;
}

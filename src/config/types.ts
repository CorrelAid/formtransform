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
  constraint_message?: string;
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

export interface ConversionConfig {
  /**
   * How to handle repeats: 'warn', 'error', or 'ignore' (default: 'warn')
   */
  handleRepeats?: 'warn' | 'error' | 'ignore';

  /**
   * Enable debug logging (default: false)
   */
  debugLogging?: boolean;

  /**
   * Promote a note named "welcome" to LimeSurvey's surveyls_welcometext (default: true)
   */
  convertWelcomeNote?: boolean;

  /**
   * Promote a note named "end" to LimeSurvey's surveyls_endtext (default: true)
   */
  convertEndNote?: boolean;

  /**
   * Detect the _other question pattern and convert to LimeSurvey's native "other" option (default: true)
   */
  convertOtherPattern?: boolean;

  /**
   * Parse labels and hints as markdown and convert to HTML (default: true)
   */
  convertMarkdown?: boolean;

  /**
   * Hide the "no answer" option on non-mandatory questions (default: true)
   */
  hideNoAnswer?: boolean;

  /**
   * Suppress LimeSurvey's automatic per-question tips — e.g. "Only numbers may
   * be entered in this field." (numeric) or "Select all that apply" (multiple
   * choice) — by setting the `hide_tip` question attribute (default: true).
   * These stock hints are noise in this ecosystem; the authored `help` text is
   * unaffected.
   */
  hideQuestionTips?: boolean;

  /**
   * Default values for survey elements
   */
  defaults: {
    language: string;
    groupName: string;
    surveyTitle: string;
    description: string;
  };
}

/**
 * Default configuration with sensible defaults
 */
export const defaultConfig: ConversionConfig = {
  handleRepeats: 'warn',
  debugLogging: false,
  convertWelcomeNote: true,
  convertEndNote: true,
  convertOtherPattern: true,
  convertMarkdown: true,
  hideNoAnswer: true,
  hideQuestionTips: true,

  defaults: {
    language: 'en',
    groupName: 'Questions',
    surveyTitle: 'Untitled Survey',
    description: '',
  },
};

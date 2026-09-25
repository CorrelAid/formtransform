/**
 * Configuration for the XLSForm → LimeSurvey TSV conversion.
 *
 * The XLSForm row types used to live here; they are in `src/xlsform/types.ts`
 * now and re-exported below for compatibility.
 */
import type { WarningHandler } from '../diagnostics.js';

export type {
  SurveyRow,
  ChoiceRow,
  SettingsRow,
  XLSFormData,
} from '../xlsform/types.js';

/**
 * Options for the XLSForm → LimeSurvey TSV conversion (`xlsform2lstsv`). The
 * other directions take their own option objects.
 */
export interface LstsvConfig {
  /** @deprecated Never read; accepted so existing callers keep compiling. */
  handleRepeats?: 'warn' | 'error' | 'ignore';

  /** @deprecated Never read; accepted so existing callers keep compiling. */
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
   * Receives the conversion's non-fatal findings (truncated names, ignored
   * appearances, a dropped constraint, …) with a stable `code`. Defaults to
   * printing them with `console.warn`.
   */
  onWarning?: WarningHandler;

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
export const defaultConfig: LstsvConfig = {
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

/** @deprecated Use {@link LstsvConfig}. */
export type ConversionConfig = LstsvConfig;

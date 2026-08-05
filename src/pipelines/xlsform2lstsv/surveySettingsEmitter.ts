import { SurveyRow, SettingsRow } from '../../config/types.js';
import { RowEmitter } from './rowEmitter.js';
import { LanguageHandler } from './languageHandler.js';
import { ConfigManager } from '../../config/ConfigManager.js';

/**
 * Emits the S (survey-level settings) and SL (survey-language) rows that
 * make up the TSV header. Tracks welcome/end note rows separately so they
 * can be promoted to SL messages.
 */
export class SurveySettingsEmitter {
  private welcomeNote: SurveyRow | null = null;
  private endNote: SurveyRow | null = null;

  constructor(
    private configManager: ConfigManager,
    private rowEmitter: RowEmitter,
    private languageHandler: LanguageHandler,
  ) {}

  clear(): void {
    this.welcomeNote = null;
    this.endNote = null;
  }

  /**
   * Pre-scan for welcome/end notes (must happen before group identification).
   * Promotes a row named "welcome"/"end" to its own SL row so the message
   * can be re-displayed on every entry to the survey.
   */
  captureNotes(surveyData: SurveyRow[]): void {
    this.welcomeNote = null;
    this.endNote = null;
    const config = this.configManager.getConfig();
    for (const row of surveyData) {
      const type = (row.type || '').trim();
      const name = (row.name || '').trim().toLowerCase();
      if (config.convertWelcomeNote && type === 'note' && name === 'welcome')
        this.welcomeNote = row;
      if (config.convertEndNote && type === 'note' && name === 'end')
        this.endNote = row;
    }
  }

  /**
   * Emit the S rows (language, additional_languages, format, shownoanswer) and
   * the SL rows (title + optional welcome/end text) for the survey.
   */
  emit(settings: SettingsRow): void {
    const defaults = this.configManager.getDefaults();
    const surveyTitle = settings.form_title || defaults.surveyTitle;

    this.rowEmitter.addRow(
      this.rowEmitter.row({
        class: 'S',
        name: 'language',
        text: this.languageHandler.getBaseLanguage(),
      }),
    );

    if (this.languageHandler.getAvailableLanguages().length > 1) {
      const additionalLanguages = this.languageHandler
        .getAvailableLanguages()
        .filter((lang) => lang !== this.languageHandler.getBaseLanguage())
        .join(' ');
      this.rowEmitter.addRow(
        this.rowEmitter.row({
          class: 'S',
          name: 'additional_languages',
          text: additionalLanguages,
        }),
      );
    }

    const surveyFormat =
      (settings.style || '').trim().toLowerCase() === 'pages' ? 'G' : 'A';
    this.rowEmitter.addRow(
      this.rowEmitter.row({
        class: 'S',
        name: 'format',
        text: surveyFormat,
      }),
    );

    if (this.configManager.getConfig().hideNoAnswer !== false) {
      this.rowEmitter.addRow(
        this.rowEmitter.row({
          class: 'S',
          name: 'shownoanswer',
          text: 'N',
        }),
      );
    }

    // SL rows: title + welcome/end text, base language first then others.
    const emitSLRows = (lang: string) => {
      this.rowEmitter.addRow(
        this.rowEmitter.row({
          class: 'SL',
          name: 'surveyls_title',
          language: lang,
          text: this.languageHandler.renderLabel(
            settings.form_title,
            lang,
            surveyTitle,
          ),
        }),
      );
      this.emitSLMessageRows(lang);
    };

    emitSLRows(this.languageHandler.getBaseLanguage());
    for (const lang of this.languageHandler
      .getAvailableLanguages()
      .filter((l) => l !== this.languageHandler.getBaseLanguage())
      .sort()) {
      emitSLRows(lang);
    }
  }

  /**
   * Emit surveyls_welcometext and surveyls_endtext SL rows for a given language.
   */
  private emitSLMessageRows(lang: string): void {
    if (this.welcomeNote) {
      this.rowEmitter.addRow(
        this.rowEmitter.row({
          class: 'SL',
          name: 'surveyls_welcometext',
          language: lang,
          text: this.languageHandler.renderLabel(this.welcomeNote.label, lang),
        }),
      );
    }
    if (this.endNote) {
      this.rowEmitter.addRow(
        this.rowEmitter.row({
          class: 'SL',
          name: 'surveyls_endtext',
          language: lang,
          text: this.languageHandler.renderLabel(this.endNote.label, lang),
        }),
      );
    }
  }
}

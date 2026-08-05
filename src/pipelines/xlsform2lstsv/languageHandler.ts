import { SurveyRow, ChoiceRow, SettingsRow } from '../../config/types.js';
import { getBaseLanguage } from '../../utils/languageUtils.js';
import { markdownToHtml } from '../../utils/markdownRenderer.js';
import { ConfigManager } from '../../config/ConfigManager.js';

/**
 * Handles language detection and multilingual content for XLSForm to TSV conversion
 */
export class LanguageHandler {
  private availableLanguages: string[] = ['en'];
  private baseLanguage: string = 'en';

  constructor(private configManager: ConfigManager) {}

  getAvailableLanguages(): string[] {
    return this.availableLanguages;
  }

  getBaseLanguage(): string {
    return this.baseLanguage;
  }

  setBaseLanguage(settings: SettingsRow): void {
    this.baseLanguage = getBaseLanguage(settings);
  }

  detectAvailableLanguages(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    settingsData: SettingsRow[],
  ): void {
    const languageCodes = new Set<string>();

    // Check survey data for language codes
    for (const row of surveyData) {
      if (row._languages) {
        row._languages.forEach((lang: string) => languageCodes.add(lang));
      } else {
        for (const field of [row.label, row.hint]) {
          if (typeof field === 'object' && field !== null) {
            for (const lang of Object.keys(field)) languageCodes.add(lang);
          }
        }
      }
    }

    // Check choices data for language codes
    for (const row of choicesData) {
      if (row._languages) {
        row._languages.forEach((lang: string) => languageCodes.add(lang));
      } else {
        if (typeof row.label === 'object' && row.label !== null) {
          for (const lang of Object.keys(row.label)) languageCodes.add(lang);
        }
      }
    }

    // Check settings data for language-specific fields
    const settings = settingsData[0] || {};
    for (const [, value] of Object.entries(settings)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        for (const lang of Object.keys(value)) {
          languageCodes.add(lang);
        }
      }
    }

    // Only use multiple languages if we actually have language-specific data
    const hasLanguageSpecificData =
      surveyData.some(
        (row) =>
          row._languages ||
          (typeof row.label === 'object' && row.label !== null) ||
          (typeof row.hint === 'object' && row.hint !== null),
      ) ||
      choicesData.some(
        (row) =>
          row._languages ||
          (typeof row.label === 'object' && row.label !== null),
      ) ||
      Object.values(settings).some(
        (value) =>
          typeof value === 'object' && value !== null && !Array.isArray(value),
      );

    if (hasLanguageSpecificData && languageCodes.size > 0) {
      const languagesArray = Array.from(languageCodes);
      const defaultLang = this.baseLanguage;
      this.availableLanguages = [
        defaultLang,
        ...languagesArray.filter((lang) => lang !== defaultLang).sort(),
      ];
    } else {
      // Monolingual survey: use its declared base language (from
      // settings.default_language), not a hardcoded 'en'.
      this.availableLanguages = [this.baseLanguage];
    }
  }

  getLanguageSpecificValue(
    value: unknown,
    languageCode: string,
  ): string | undefined {
    if (!value) return undefined;

    if (typeof value === 'string') return value;

    if (typeof value === 'object' && value !== null) {
      const valueObj: Record<string, unknown> = value as Record<
        string,
        unknown
      >;
      if (languageCode in valueObj) {
        return valueObj[languageCode] as string;
      }
      for (const lang of this.availableLanguages) {
        if (lang in valueObj) return valueObj[lang] as string;
      }
    }

    return undefined;
  }

  /**
   * Resolve a multilingual label/hint value for the given language and optionally
   * convert it from markdown to HTML. Falls back to `fallback` when no value is found.
   */
  renderLabel(value: unknown, lang: string, fallback = ''): string {
    const raw = this.getLanguageSpecificValue(value, lang) || fallback;
    return this.configManager.getConfig().convertMarkdown
      ? markdownToHtml(raw)
      : raw;
  }
}

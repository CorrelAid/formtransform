import { SurveyRow, ChoiceRow, SettingsRow } from '../../config/types.js';
import { getBaseLanguage } from '../../utils/languageUtils.js';
import { markdownToHtml } from '../../utils/markdownRenderer.js';
import { ConfigManager } from '../../config/ConfigManager.js';

/** A value that could carry per-language sub-objects (label, hint, settings). */
function isLanguageMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Push every per-language code on `row` into `codes` (`_languages` first, else keys of label/hint). */
function harvestRowCodes(row: SurveyRow | ChoiceRow, codes: Set<string>): void {
  if (row._languages) {
    for (const lang of row._languages) codes.add(lang);
    return;
  }
  const fields: unknown[] = [row.label, (row as SurveyRow).hint];
  for (const field of fields) {
    if (isLanguageMap(field)) {
      for (const lang of Object.keys(field)) codes.add(lang);
    }
  }
}

/** True when `row` carries an explicit `_languages` array OR an object-valued label/hint. */
function rowIsMultilingual(row: SurveyRow | ChoiceRow): boolean {
  if (row._languages) return true;
  const fields: unknown[] = [row.label, (row as SurveyRow).hint];
  return fields.some(isLanguageMap);
}

/** True when any settings entry is a per-language object (form_title, etc.). */
function settingsIsMultilingual(settings: SettingsRow): boolean {
  return Object.values(settings).some(isLanguageMap);
}

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
    for (const row of surveyData) harvestRowCodes(row, languageCodes);
    for (const row of choicesData) harvestRowCodes(row, languageCodes);
    for (const value of Object.values(settingsData[0] ?? {})) {
      if (isLanguageMap(value)) {
        for (const lang of Object.keys(value)) languageCodes.add(lang);
      }
    }

    // Only use multiple languages if we actually have language-specific data
    const hasLanguageSpecificData =
      surveyData.some(rowIsMultilingual) ||
      choicesData.some(rowIsMultilingual) ||
      settingsIsMultilingual(settingsData[0] ?? {});

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

import { SurveyRow, ChoiceRow, SettingsRow } from '../../xlsform/types.js';
import { getBaseLanguage } from '../../utils/languageUtils.js';
import { markdownToHtml } from '../../utils/markdownRenderer.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { toLimeSurveyLanguage } from '../../conventions/language.js';
import { ConversionError, consoleWarning, warning } from '../../diagnostics.js';
import { readText } from '../../instrument/fromXlsform.js';
import type { Text } from '../../instrument/types.js';

/** A value that could carry per-language sub-objects (label, hint, settings). */
function isLanguageMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The language tags a row's label/hint carry: `{lang: text}` keys and `label::<lang>` columns. */
function taggedLanguages(row: SurveyRow | ChoiceRow): string[] {
  return [
    ...Object.keys(readText(row, 'label')),
    ...Object.keys(readText(row, 'hint')),
  ].filter((lang) => lang !== '');
}

/** Push every per-language code on `row` into `codes` (`_languages` first, else its tags). */
function harvestRowCodes(row: SurveyRow | ChoiceRow, codes: Set<string>): void {
  for (const lang of row._languages ?? taggedLanguages(row)) codes.add(lang);
}

/** True when `row` carries an explicit `_languages` array OR tagged label/hint text. */
function rowIsMultilingual(row: SurveyRow | ChoiceRow): boolean {
  return Boolean(row._languages) || taggedLanguages(row).length > 0;
}

/**
 * A {@link Text} in the shape renderLabel takes: the untagged string alone,
 * else the `{lang: text}` map (`undefined` when there is no text).
 */
function legacyValue(text: Text): unknown {
  const langs = Object.keys(text);
  if (langs.length === 0) return undefined;
  if (langs.length === 1 && langs[0] === '') return text[''];
  return Object.fromEntries(
    Object.entries(text).filter(([lang]) => lang !== ''),
  );
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
  /** XLSForm tag → LimeSurvey language code, for every available language. */
  private lsCodes = new Map<string, string>();

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
    this.mapToLimeSurvey();
  }

  /** The LimeSurvey code for an XLSForm language tag. */
  toLs(lang: string): string {
    return this.lsCodes.get(lang) ?? lang;
  }

  /**
   * Map every available tag onto a LimeSurvey code (convention:languageTagging).
   * A tag with no code, or two tags on one code, is an error; a tag reduced to
   * its primary language (`fr-BE` → `fr`) is a warning.
   */
  private mapToLimeSurvey(): void {
    const warn = this.configManager.getConfig().onWarning ?? consoleWarning;
    const byCode = new Map<string, string>();
    this.lsCodes = new Map();
    for (const tag of this.availableLanguages) {
      const mapped = toLimeSurveyLanguage(tag);
      if (!mapped) {
        throw new ConversionError(
          'language-unmapped',
          `LimeSurvey has no language code for "${tag}"`,
          { subject: tag },
        );
      }
      const clash = byCode.get(mapped.code);
      if (clash) {
        throw new ConversionError(
          'language-unmapped',
          `"${clash}" and "${tag}" both map to LimeSurvey language "${mapped.code}"`,
          { subject: tag },
        );
      }
      byCode.set(mapped.code, tag);
      if (mapped.approximate) {
        warn(
          warning(
            'language-approximated',
            `LimeSurvey has no "${tag}"; using "${mapped.code}"`,
            tag,
          ),
        );
      }
      this.lsCodes.set(tag, mapped.code);
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
  /**
   * Render a row's `field` (`label`, `hint`, …) in `lang`, read the way the
   * Instrument reads it (#69): a plain cell, `{lang: text}`, or
   * `<field>::<lang>` columns.
   */
  renderText(
    row: Record<string, unknown>,
    field: string,
    lang: string,
    fallback = '',
  ): string {
    return this.renderLabel(legacyValue(readText(row, field)), lang, fallback);
  }

  /** The row's `field` in `lang`, unrendered (no markdown). */
  textIn(
    row: Record<string, unknown>,
    field: string,
    lang: string,
  ): string | undefined {
    return this.getLanguageSpecificValue(
      legacyValue(readText(row, field)),
      lang,
    );
  }

  renderLabel(value: unknown, lang: string, fallback = ''): string {
    const raw = this.getLanguageSpecificValue(value, lang) || fallback;
    return this.configManager.getConfig().convertMarkdown
      ? markdownToHtml(raw)
      : raw;
  }
}

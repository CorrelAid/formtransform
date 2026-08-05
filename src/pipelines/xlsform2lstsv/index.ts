import { ConfigManager, ConversionConfig } from '../../config/ConfigManager.js';
import { SurveyRow, ChoiceRow, SettingsRow } from '../../config/types.js';
import {
  convertRelevance,
  convertConstraint,
  xpathToLimeSurvey,
  TranspilerContext,
} from './xpathTranspiler.js';
import { APPEARANCES } from '../../generated/Appearances.js';
import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { TSVGenerator } from '../../lstsv/serialize.js';
import { TypeMapper, TypeInfo, LSType, TYPE_MAPPINGS } from './typeMapper.js';
import { deduplicateNames } from '../../utils/helpers.js';
import { getBaseLanguage } from '../../utils/languageUtils.js';
import { markdownToHtml } from '../../utils/markdownRenderer.js';
import conventions from '../../generated/conventions.json' with { type: 'json' };

// Derived from registry convention:unregisteredRows — device/session metadata
// rows are silently skipped; any other unregistered type is an error.
const SKIP_TYPES: string[] =
  conventions.conventions.unregisteredRows.metadataRowTypes;

// Derived from registry: registered types LimeSurvey TSV cannot express
// (supported: false) throw an error. begin_group/end_group are special-cased
// in processRow before this check.
const UNIMPLEMENTED_TYPES: string[] = Object.entries(TYPE_MAPPINGS)
  .filter(([k, v]) => !v.supported && k !== 'begin_group' && k !== 'end_group')
  .map(([k]) => k);

// select_*_from_file has no native LimeSurvey representation, but when the
// referenced CSV is supplied (via convert()'s fileChoices) we emit it as the
// base select with the vocabulary's options inlined + a `cdl_vocab` attribute
// recording the source vocabulary (see convention:externalCodeList).
const FROM_FILE_BASE: Record<string, string> = {
  select_one_from_file: 'select_one',
  select_multiple_from_file: 'select_multiple',
};

// Canonical per-language "other" labels (convention:other). Used to verify an
// author's `other` choice label so the DDI round-trip (which rebuilds this
// label from the convention) stays faithful.
const OTHER_LABELS: Record<string, string> =
  (conventions.conventions.other as { labels?: Record<string, string> })
    .labels ?? {};

// Registry appearances are an allowlist: only 'handled' entries are
// registered. Anything else (or a handled appearance on the wrong type)
// warns and is ignored.

// Naming convention:
// - xfType: XLSForm type (string from row.type)
// - xfTypeInfo: Parsed XLSForm type information (TypeInfo interface)
// - lsType: LimeSurvey type information (LSType interface)

interface TSVRowData {
  class: string;
  'type/scale': string;
  name: string;
  relevance: string;
  text: string;
  help: string;
  language: string;
  validation: string;
  em_validation_q: string;
  mandatory: string;
  other: string;
  default: string;
  same_default: string;
  hidden?: string;
  cssclass?: string;
  hide_tip?: string;
  date_format?: string;
}

export class XLSFormToTSVConverter {
  private configManager: ConfigManager;
  private fieldSanitizer: FieldSanitizer;
  private typeMapper: TypeMapper;
  private tsvGenerator: TSVGenerator;
  private choicesMap: Map<string, ChoiceRow[]>;
  private fileChoices: Record<string, ChoiceRow[]> = {};
  private currentGroup: string | null;
  private groupStack: Array<{
    originalName: string;
    sanitizedName: string;
    emittedAsGroup: boolean;
  }>;
  private parentOnlyGroups: Set<string>;
  private pendingGroupNotes: SurveyRow[];
  private groupSeq: number;
  private questionSeq: number;
  private answerSeq: number;
  private subquestionSeq: number;
  private availableLanguages: string[];
  private baseLanguage: string;
  private inMatrix: boolean;
  private matrixListName: string | null;
  // True while inside a `table-list` group emitted as a LimeSurvey array (F):
  // its select_one children become subquestions of one array question.
  private inTableListMatrix: boolean;
  private groupContentBuffer: TSVRowData[];
  private answerCodeMap: Map<string, Map<string, string>>;
  private questionToListMap: Map<string, string>;
  private questionBaseTypeMap: Map<string, string>;
  private welcomeNote: SurveyRow | null = null;
  private endNote: SurveyRow | null = null;
  private messageOnlyGroups: Set<string> = new Set();
  private surveyDataCache: SurveyRow[] = [];

  constructor(config?: Partial<ConversionConfig>) {
    this.configManager = new ConfigManager(config);
    this.configManager.validateConfig();

    this.fieldSanitizer = new FieldSanitizer();

    this.typeMapper = new TypeMapper();

    this.tsvGenerator = new TSVGenerator();
    this.choicesMap = new Map();
    this.currentGroup = null;
    this.groupStack = [];
    this.parentOnlyGroups = new Set();
    this.pendingGroupNotes = [];
    this.groupSeq = 0;
    this.questionSeq = 0;
    this.answerSeq = 0;
    this.subquestionSeq = 0;
    this.availableLanguages = ['en']; // Default to English
    this.baseLanguage = 'en'; // Default to English
    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
    this.groupContentBuffer = [];
    this.answerCodeMap = new Map();
    this.questionToListMap = new Map();
    this.questionBaseTypeMap = new Map();
  }

  // ── Row helpers ──────────────────────────────────────────────────────

  /**
   * Build a TSVRowData with sensible defaults. Only `class` and `name` are required;
   * all other fields default to empty strings (relevance defaults to '1').
   */
  private row(
    fields: Partial<TSVRowData> & Pick<TSVRowData, 'class' | 'name'>,
  ): TSVRowData {
    return {
      'type/scale': '',
      relevance: '1',
      text: '',
      help: '',
      language: this.baseLanguage,
      validation: '',
      em_validation_q: '',
      mandatory: '',
      other: '',
      default: '',
      same_default: '',
      ...fields,
    };
  }

  /**
   * Emit a buffered row for each available language. The callback receives the
   * language code and returns the language-varying fields; common fields like
   * `class` and `name` should be included in the callback return.
   */
  private emitForEachLanguage(
    buildRow: (
      lang: string,
    ) => Partial<TSVRowData> & Pick<TSVRowData, 'class' | 'name'>,
    target?: 'buffer' | 'direct',
  ): void {
    if (!target) target = 'buffer';
    for (const lang of this.availableLanguages) {
      const row = this.row({ language: lang, ...buildRow(lang) });
      if (target === 'direct') {
        this.tsvGenerator.addRow(row);
      } else {
        this.bufferRow(row);
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Get the current configuration
   */
  getConfig(): ConversionConfig {
    return this.configManager.getConfig();
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(partialConfig: Partial<ConversionConfig>): void {
    this.configManager.updateConfig(partialConfig);
  }

  async convert(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    settingsData: SettingsRow[],
    // Choices for external-file lists (`select_*_from_file <name>.csv`), keyed by
    // the referenced filename. Supplied by fs-aware callers (CLI/bless/tests) via
    // resolveFileChoices; the core stays pure. When present, a from_file question
    // is emitted as its base select with these choices inlined + a `cdl_vocab`
    // attribute naming the source vocabulary.
    fileChoices: Record<string, ChoiceRow[]> = {},
  ): Promise<string> {
    // Reset state
    this.fileChoices = fileChoices;
    this.choicesMap.clear();
    this.currentGroup = null;
    this.groupStack = [];
    this.pendingGroupNotes = [];
    this.tsvGenerator.clear();
    this.groupSeq = 0;
    this.questionSeq = 0;
    this.answerSeq = 0;
    this.subquestionSeq = 0;
    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
    this.groupContentBuffer = [];

    this.welcomeNote = null;
    this.endNote = null;

    // Pre-scan for welcome/end notes (must happen before group identification)
    const config = this.configManager.getConfig();
    for (const row of surveyData) {
      const type = (row.type || '').trim();
      const name = (row.name || '').trim().toLowerCase();
      if (config.convertWelcomeNote && type === 'note' && name === 'welcome')
        this.welcomeNote = row;
      if (config.convertEndNote && type === 'note' && name === 'end')
        this.endNote = row;
    }

    // Pre-scan to identify parent-only groups (no direct questions, only child groups)
    this.parentOnlyGroups = this.identifyParentOnlyGroups(surveyData);

    // Pre-scan to identify groups whose only content is a welcome/end note
    this.messageOnlyGroups = this.identifyMessageOnlyGroups(surveyData);

    // Cache survey data for pattern detection
    this.surveyDataCache = surveyData;

    // Set base language from settings first
    this.baseLanguage = getBaseLanguage(settingsData[0] || {});

    // Detect available languages from survey data (will use baseLanguage for ordering)
    this.detectAvailableLanguages(surveyData, choicesData, settingsData);

    // Build choices map, then overlay external-file lists (keyed by filename).
    this.buildChoicesMap(choicesData);
    for (const [filename, choices] of Object.entries(this.fileChoices)) {
      this.choicesMap.set(filename, choices);
    }

    // Pre-scan: register all field names to detect and resolve collisions
    this.registerFieldNames(surveyData);

    // Build answer code and question-to-list maps for relevance rewriting
    this.buildAnswerCodeMap();
    this.buildQuestionToListMap(surveyData);

    // Add survey row (class S)
    this.addSurveyRow(settingsData[0] || {});

    // Check if we need a default group (if no groups are defined)
    const hasGroups = surveyData.some((row) => {
      const xfType = (row.type || '').trim();
      return xfType === 'begin_group';
    });

    // If no groups, add a default group
    const advancedOptions = this.configManager.getAdvancedOptions();
    if (!hasGroups && advancedOptions.autoCreateGroups) {
      this.addDefaultGroup();
    }

    // Process survey rows
    for (const row of surveyData) {
      await this.processRow(row);
    }

    // Flush any pending matrix at the end
    this.flushMatrix();

    // Flush remaining buffered group content
    this.flushGroupContent();

    // Generate TSV
    return this.tsvGenerator.generateTSV();
  }

  // ── Other question pattern detection ─────────────────────────────────

  /**
   * Check if a question has a corresponding "_other" question with relevance targeting its "other" option.
   * Returns true if pattern is found, and also removes the "other" choice from the choices list if present.
   */
  private hasOtherQuestionPattern(
    currentRow: SurveyRow,
    surveyData: SurveyRow[],
  ): boolean {
    const currentName = currentRow.name?.trim();
    if (!currentName) return false;

    const otherQuestionName = `${currentName}_other`;
    const sanitizedCurrentName = this.sanitizeName(currentName);

    for (const row of surveyData) {
      if (row.name?.trim() !== otherQuestionName || !row.relevant) continue;

      const relevance = row.relevant.trim();
      // Pattern: ${name} = 'other', ${name} == 'other', or selected(${name}, 'other')
      const patterns = [currentName, sanitizedCurrentName].flatMap((n) => [
        new RegExp(`\\$\\{${n}\\}\\s*={1,2}\\s*['"]other['"]`),
        new RegExp(`selected\\(\\s*\\$\\{${n}\\}\\s*,\\s*['"]other['"]\\s*\\)`),
      ]);

      if (patterns.some((p) => p.test(relevance))) {
        const xfTypeInfo = this.parseType(currentRow.type || '');
        this.removeOtherChoiceFromList(currentRow, xfTypeInfo);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove the "other" choice from the choices list for a question.
   * Prevents duplicate "other" options when using the _other question pattern.
   */
  private removeOtherChoiceFromList(row: SurveyRow, typeInfo: TypeInfo): void {
    if (!typeInfo.listName) return;

    const choices = this.choicesMap.get(typeInfo.listName);
    if (!choices) return;

    const otherNames = new Set([
      'other',
      '_other',
      'other_option',
      'other_choice',
    ]);
    const removed = choices.filter((choice) =>
      otherNames.has(choice.name?.trim().toLowerCase() || ''),
    );
    const filteredChoices = choices.filter(
      (choice) => !otherNames.has(choice.name?.trim().toLowerCase() || ''),
    );

    if (filteredChoices.length < choices.length) {
      console.log(
        `Removed "other" choice(s) from list "${typeInfo.listName}" for question "${row.name}" when using _other question pattern`,
      );
      this.verifyOtherLabel(removed, row);
      this.choicesMap.set(typeInfo.listName, filteredChoices);
    }
  }

  /**
   * Warn if the collapsed `other` choice's label doesn't match the canonical
   * `convention:other` label for the survey's base language. The DDI round-trip
   * rebuilds this label from the convention, so a mismatch is silently lost.
   */
  private verifyOtherLabel(removed: ChoiceRow[], row: SurveyRow): void {
    const expected = OTHER_LABELS[this.baseLanguage];
    if (!expected) return;
    for (const choice of removed) {
      const label = this.getLanguageSpecificValue(
        choice.label,
        this.baseLanguage,
      );
      if (label && label.trim() && label.trim() !== expected) {
        console.warn(
          `"other" choice label "${label}" on "${row.name}" is not the canonical ${this.baseLanguage} label "${expected}"; the DDI round-trip will use "${expected}".`,
        );
      }
    }
  }

  // ── Language detection ────────────────────────────────────────────────

  private detectAvailableLanguages(
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

  // ── Map building ─────────────────────────────────────────────────────

  private buildChoicesMap(choices: ChoiceRow[]): void {
    for (const choice of choices) {
      const listName = choice.list_name;
      if (!listName) continue;

      if (!this.choicesMap.has(listName)) {
        this.choicesMap.set(listName, []);
      }
      this.choicesMap.get(listName)!.push(choice);
    }
  }

  private buildAnswerCodeMap(): void {
    this.answerCodeMap = new Map();
    for (const [listName, choices] of this.choicesMap) {
      const codeMap = new Map<string, string>();
      const sanitized = choices.map((c) => {
        const raw = c.name?.trim() || '';
        return raw ? this.sanitizeAnswerCode(raw) : '';
      });
      const deduplicated = deduplicateNames(sanitized, 5);
      for (let i = 0; i < choices.length; i++) {
        const originalName = choices[i].name?.trim() || '';
        if (originalName && deduplicated[i]) {
          codeMap.set(originalName, deduplicated[i]);
        }
      }
      this.answerCodeMap.set(listName, codeMap);
    }
  }

  private buildQuestionToListMap(surveyData: SurveyRow[]): void {
    this.questionToListMap = new Map();
    this.questionBaseTypeMap = new Map();
    for (const row of surveyData) {
      const typeInfo = this.parseType(row.type || '');
      if (typeInfo.listName && row.name) {
        const sanitizedName = this.sanitizeName(row.name.trim());
        this.questionToListMap.set(sanitizedName, typeInfo.listName);
        this.questionBaseTypeMap.set(sanitizedName, typeInfo.base);
      }
    }
  }

  // ── Pre-scanning ─────────────────────────────────────────────────────

  /**
   * Pre-scan survey data to identify groups whose only direct content is a
   * welcome or end note. These groups are silently suppressed.
   */
  private identifyMessageOnlyGroups(surveyData: SurveyRow[]): Set<string> {
    const messageOnly = new Set<string>();
    const stack: string[] = [];
    const groupInfo = new Map<
      string,
      { hasMessageNote: boolean; hasOtherContent: boolean }
    >();

    for (const row of surveyData) {
      const type = (row.type || '').trim();
      const baseType = type.split(/\s+/)[0];

      if (type === 'begin_group' || type === 'begin group') {
        const name = (row.name || '').trim();
        stack.push(name);
        groupInfo.set(name, { hasMessageNote: false, hasOtherContent: false });
      } else if (type === 'end_group' || type === 'end group') {
        const name = stack.pop();
        if (name !== undefined) {
          const info = groupInfo.get(name);
          if (info && info.hasMessageNote && !info.hasOtherContent) {
            messageOnly.add(name);
          }
        }
      } else if (type && stack.length > 0 && !SKIP_TYPES.includes(baseType)) {
        const groupName = stack[stack.length - 1];
        const info = groupInfo.get(groupName);
        if (info) {
          const rowName = (row.name || '').trim().toLowerCase();
          const cfg = this.configManager.getConfig();
          const isMessageNote =
            type === 'note' &&
            ((cfg.convertWelcomeNote && rowName === 'welcome') ||
              (cfg.convertEndNote && rowName === 'end'));
          if (isMessageNote) {
            info.hasMessageNote = true;
          } else {
            info.hasOtherContent = true;
          }
        }
      }
    }

    return messageOnly;
  }

  /**
   * Pre-scan survey data to identify parent-only groups.
   * A parent-only group contains no direct questions — only child groups.
   */
  private identifyParentOnlyGroups(surveyData: SurveyRow[]): Set<string> {
    const parentOnly = new Set<string>();
    const stack: string[] = [];
    const hasDirectContent = new Map<string, boolean>();

    for (const row of surveyData) {
      const type = (row.type || '').trim();
      const baseType = type.split(/\s+/)[0];

      if (type === 'begin_group' || type === 'begin group') {
        const name = (row.name || '').trim();
        stack.push(name);
        hasDirectContent.set(name, false);
      } else if (type === 'end_group' || type === 'end group') {
        const name = stack.pop();
        if (name !== undefined && !hasDirectContent.get(name)) {
          parentOnly.add(name);
        }
      } else if (type && !SKIP_TYPES.includes(baseType)) {
        if (stack.length > 0) {
          hasDirectContent.set(stack[stack.length - 1], true);
        }
      }
    }

    return parentOnly;
  }

  // ── Field name handling ──────────────────────────────────────────────

  /**
   * Pre-scan all survey rows and register every field name with the sanitizer,
   * so that collisions after sanitization + truncation are detected early.
   */
  private registerFieldNames(surveyData: SurveyRow[]): void {
    this.fieldSanitizer.resetNames();
    for (const row of surveyData) {
      const type = (row.type || '').trim();
      if (type === 'end_group' || type === 'end_repeat') continue;
      const name = row.name?.trim();
      if (!name) continue;
      this.fieldSanitizer.sanitizeNameUnique(name);
    }
  }

  private sanitizeName(name: string): string {
    const stripped = name.replace(/[_-]/g, '');
    return this.fieldSanitizer.resolveStrippedName(stripped);
  }

  private sanitizeAnswerCode(code: string): string {
    return this.fieldSanitizer.sanitizeAnswerCode(code);
  }

  /**
   * Convert ${varname} references in text to LimeSurvey EM syntax {sanitizedname}.
   */
  private convertVariableReferences(text: string): string {
    return text.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
      const sanitized = this.sanitizeName(name);
      return `{${sanitized}}`;
    });
  }

  // ── Label rendering ──────────────────────────────────────────────────

  private getLanguageSpecificValue(
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
  private renderLabel(value: unknown, lang: string, fallback = ''): string {
    const raw = this.getLanguageSpecificValue(value, lang) || fallback;
    return this.configManager.getConfig().convertMarkdown
      ? markdownToHtml(raw)
      : raw;
  }

  // ── Buffering / flushing ─────────────────────────────────────────────

  /**
   * Buffer a Q/SQ/A row for later language-grouped output.
   * LimeSurvey's TSV importer uses a question_order counter ($qseq) that gets
   * reset when it encounters a translation of a previously-seen question.
   * By outputting all base-language rows first, the counter increments correctly.
   */
  private bufferRow(row: TSVRowData): void {
    this.groupContentBuffer.push(row);
  }

  /**
   * Flush buffered group content, outputting base language rows first,
   * then each additional language.
   */
  private flushGroupContent(): void {
    if (this.groupContentBuffer.length === 0) return;

    for (const row of this.groupContentBuffer) {
      if (row.language === this.baseLanguage) {
        this.tsvGenerator.addRow(row);
      }
    }

    for (const lang of this.availableLanguages) {
      if (lang === this.baseLanguage) continue;
      for (const row of this.groupContentBuffer) {
        if (row.language === lang) {
          this.tsvGenerator.addRow(row);
        }
      }
    }

    this.groupContentBuffer = [];
  }

  // ── Survey settings (S/SL rows) ─────────────────────────────────────

  private addSurveyRow(settings: SettingsRow): void {
    const defaults = this.configManager.getDefaults();
    const surveyTitle = settings.form_title || defaults.surveyTitle;

    // S rows: language, additional_languages, format
    this.tsvGenerator.addRow(
      this.row({
        class: 'S',
        name: 'language',
        text: this.baseLanguage,
      }),
    );

    if (this.availableLanguages.length > 1) {
      const additionalLanguages = this.availableLanguages
        .filter((lang) => lang !== this.baseLanguage)
        .join(' ');
      this.tsvGenerator.addRow(
        this.row({
          class: 'S',
          name: 'additional_languages',
          text: additionalLanguages,
        }),
      );
    }

    const surveyFormat =
      (settings.style || '').trim().toLowerCase() === 'pages' ? 'G' : 'A';
    this.tsvGenerator.addRow(
      this.row({
        class: 'S',
        name: 'format',
        text: surveyFormat,
      }),
    );

    // Hide "no answer" option on non-mandatory questions
    if (this.configManager.getConfig().hideNoAnswer !== false) {
      this.tsvGenerator.addRow(
        this.row({
          class: 'S',
          name: 'shownoanswer',
          text: 'N',
        }),
      );
    }

    // SL rows: survey title + welcome/end text, base language first then others
    const emitSLRows = (lang: string) => {
      this.tsvGenerator.addRow(
        this.row({
          class: 'SL',
          name: 'surveyls_title',
          language: lang,
          text: this.renderLabel(settings.form_title, lang, surveyTitle),
        }),
      );
      this.addSLMessageRows(lang);
    };

    emitSLRows(this.baseLanguage);
    for (const lang of this.availableLanguages
      .filter((l) => l !== this.baseLanguage)
      .sort()) {
      emitSLRows(lang);
    }
  }

  /**
   * Emit surveyls_welcometext and surveyls_endtext SL rows for a given language.
   */
  private addSLMessageRows(lang: string): void {
    if (this.welcomeNote) {
      this.tsvGenerator.addRow(
        this.row({
          class: 'SL',
          name: 'surveyls_welcometext',
          language: lang,
          text: this.renderLabel(this.welcomeNote.label, lang),
        }),
      );
    }
    if (this.endNote) {
      this.tsvGenerator.addRow(
        this.row({
          class: 'SL',
          name: 'surveyls_endtext',
          language: lang,
          text: this.renderLabel(this.endNote.label, lang),
        }),
      );
    }
  }

  // ── Group handling ───────────────────────────────────────────────────

  private addDefaultGroup(): void {
    const groupName = this.configManager.getDefaults().groupName;
    this.currentGroup = groupName;

    // Emit the group in every detected survey language, NOT the config default
    // ('en'). A group row whose language differs from the survey base language
    // fails LimeSurvey's activation consistency check (e.g. a German-base survey
    // with an English-only "Questions" group).
    this.emitForEachLanguage(
      () => ({ class: 'G', name: groupName, text: groupName }),
      'direct',
    );

    this.groupSeq++;
  }

  private addAutoGroupForOrphans(): void {
    const groupName = `G${this.groupSeq}`;
    this.groupSeq++;
    this.currentGroup = groupName;

    const groupSeqKey = String(this.groupSeq);

    this.emitForEachLanguage(
      () => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: groupName,
        text: groupName,
      }),
      'direct',
    );
  }

  private async addGroup(row: SurveyRow): Promise<void> {
    const groupName =
      row.name && row.name.trim() !== ''
        ? this.sanitizeName(row.name.trim())
        : `G${this.groupSeq}`;

    this.groupSeq++;
    this.currentGroup = groupName;

    // type/scale is used as a stable group sequence key for LimeSurvey's TSV importer
    // to correctly match group translations across languages.
    const groupSeqKey = String(this.groupSeq);
    const relevance = await this.convertRelevance(row.relevant);

    this.emitForEachLanguage(
      (lang) => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: this.renderLabel(row.label, lang, groupName),
        relevance,
        text: this.renderLabel(row.hint, lang),
      }),
      'direct',
    );
  }

  /**
   * Emit pending parent-only group labels as note questions (type X).
   */
  private async emitPendingGroupNotes(): Promise<void> {
    for (const noteRow of this.pendingGroupNotes) {
      const noteName =
        noteRow.name && noteRow.name.trim() !== ''
          ? this.sanitizeName(noteRow.name.trim())
          : `GN${this.questionSeq}`;

      this.questionSeq++;
      const relevance = await this.convertRelevance(noteRow.relevant);

      this.emitForEachLanguage((lang) => ({
        class: 'Q',
        'type/scale': 'X',
        name: noteName,
        relevance,
        text: this.renderLabel(noteRow.label, lang, noteName),
        help: this.renderLabel(noteRow.hint, lang),
      }));
    }
    this.pendingGroupNotes = [];
  }

  // ── Row processing ───────────────────────────────────────────────────

  private async processRow(row: SurveyRow): Promise<void> {
    const xfType = (row.type || '').trim();

    if (!xfType) return;

    const baseType = xfType.split(/\s+/)[0];

    // Silently skip metadata types
    if (SKIP_TYPES.includes(baseType)) return;

    // Skip notes that have been promoted to welcome/end messages
    if (xfType === 'note') {
      const name = (row.name || '').trim().toLowerCase();
      const cfg = this.configManager.getConfig();
      if (cfg.convertWelcomeNote && name === 'welcome') return;
      if (cfg.convertEndNote && name === 'end') return;
    }

    // Registered but not natively expressible in LimeSurvey TSV. Exception:
    // select_*_from_file is emittable when the referenced CSV was supplied
    // (choices get inlined + a cdl_vocab attribute is attached — see addQuestion).
    if (UNIMPLEMENTED_TYPES.includes(baseType)) {
      const filename = xfType.split(/\s+/)[1];
      const canInline =
        baseType in FROM_FILE_BASE &&
        !!filename &&
        (this.fileChoices[filename]?.length ?? 0) > 0;
      if (!canInline) {
        throw new Error(
          `Unimplemented XLSForm type: '${baseType}'. This type is not currently supported.`,
        );
      }
    }

    // Registry is an allowlist: unregistered types abort the transformation
    // (convention:unregisteredRows).
    if (
      !(baseType in TYPE_MAPPINGS) &&
      baseType !== 'begin_group' &&
      baseType !== 'begin' &&
      baseType !== 'end_group'
    ) {
      throw new Error(
        `Unimplemented XLSForm type: '${baseType}'. This type is not registered in the survey type registry.`,
      );
    }

    if (xfType === 'begin_group' || xfType === 'begin group') {
      this.flushMatrix();
      const originalName = (row.name || '').trim();
      const sanitizedName = originalName
        ? this.sanitizeName(originalName)
        : `G${this.groupSeq}`;

      // A `table-list` group is a grid: emit it as one LimeSurvey array (F)
      // whose select_one children become subquestions, instead of a plain
      // group of standalone questions. Preserves the matrix in the TSV and
      // round-trips back to a DDI grid varGrp.
      const groupAppearance =
        typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';
      if (groupAppearance.includes('table-list')) {
        this.groupStack.push({
          originalName,
          sanitizedName,
          emittedAsGroup: true,
        });
        this.flushGroupContent();
        await this.addGroup(row);
        await this.emitPendingGroupNotes();
        await this.addTableListHeader(row, sanitizedName);
        return;
      }

      if (this.messageOnlyGroups.has(originalName)) {
        this.groupStack.push({
          originalName,
          sanitizedName,
          emittedAsGroup: false,
        });
      } else if (this.parentOnlyGroups.has(originalName)) {
        this.groupStack.push({
          originalName,
          sanitizedName,
          emittedAsGroup: false,
        });
        this.pendingGroupNotes.push(row);
      } else {
        this.groupStack.push({
          originalName,
          sanitizedName,
          emittedAsGroup: true,
        });
        this.flushGroupContent();
        await this.addGroup(row);
        await this.emitPendingGroupNotes();
      }
      return;
    }
    if (xfType === 'end_group' || xfType === 'end group') {
      this.flushMatrix();
      this.groupStack.pop();
      this.currentGroup = null;
      for (let i = this.groupStack.length - 1; i >= 0; i--) {
        if (this.groupStack[i].emittedAsGroup) {
          this.currentGroup = this.groupStack[i].sanitizedName;
          break;
        }
      }
      return;
    }

    // Auto-create a group for questions outside any explicit group.
    if (this.currentGroup === null && this.groupStack.length === 0) {
      this.flushGroupContent();
      this.addAutoGroupForOrphans();
    }

    await this.addQuestion(row);
  }

  // ── Question emission ────────────────────────────────────────────────

  private async addQuestion(row: SurveyRow): Promise<void> {
    let xfTypeInfo = this.parseType(row.type || '');

    // select_*_from_file → emit as its base select with the referenced CSV's
    // options inlined. `cdl_vocab` records the source vocabulary (filename minus
    // extension), preserving the controlled-vocabulary link LimeSurvey has no
    // native slot for. listName stays the filename (choicesMap was keyed by it).
    let cdlVocab = '';
    if (xfTypeInfo.base in FROM_FILE_BASE) {
      cdlVocab = (xfTypeInfo.listName ?? '').replace(/\.csv$/i, '');
      xfTypeInfo = { ...xfTypeInfo, base: FROM_FILE_BASE[xfTypeInfo.base] };
    }

    const appearance =
      typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';

    // Inside a `table-list` group: each select_one child is a subquestion of
    // the enclosing array. Capture the shared list from the first child so
    // flushMatrix can emit its answer scale.
    if (this.inTableListMatrix && xfTypeInfo.base === 'select_one') {
      if (!this.matrixListName) this.matrixListName = xfTypeInfo.listName;
      await this.addMatrixSubquestion(row);
      return;
    }

    // Matrix header: select_one with appearance "label"
    if (
      appearance === 'label' &&
      xfTypeInfo.base === 'select_one' &&
      xfTypeInfo.listName
    ) {
      this.flushMatrix();
      await this.addMatrixHeader(row, xfTypeInfo);
      return;
    }

    // Matrix subquestion: select_one with appearance "list-nolabel" while in matrix mode
    if (
      appearance === 'list-nolabel' &&
      this.inMatrix &&
      xfTypeInfo.base === 'select_one'
    ) {
      await this.addMatrixSubquestion(row);
      return;
    }

    // Non-matrix question: flush any pending matrix first
    this.flushMatrix();

    // Warn on unsupported appearances: not in the registry allowlist, or
    // registered but not valid for this question type.
    if (appearance) {
      for (const part of appearance.split(/\s+/)) {
        const spec = APPEARANCES[part];
        const isUnsupported =
          !spec ||
          (spec.validForTypes && !spec.validForTypes.includes(xfTypeInfo.base));
        if (isUnsupported) {
          console.warn(
            `Unsupported appearance "${part}" on question "${row.name}" will be ignored`,
          );
        }
      }
    }

    const questionName =
      row.name && row.name.trim() !== ''
        ? this.sanitizeName(row.name.trim())
        : `Q${this.questionSeq}`;

    this.questionSeq++;

    const lsType = this.mapType(xfTypeInfo);

    // Appearance-based type overrides (driven by registry APPEARANCES)
    if (appearance) {
      const parts = appearance.split(/\s+/);
      for (const part of parts) {
        const spec = APPEARANCES[part];
        if (!spec?.lsTypeOverride) continue;
        if (
          !spec.validForTypes ||
          spec.validForTypes.includes(xfTypeInfo.base)
        ) {
          lsType.type = spec.lsTypeOverride;
        }
      }
    }

    const isNote = xfTypeInfo.base === 'note';
    const isCalculate = xfTypeInfo.base === 'calculate';
    const isNoteOrCalc = isNote || isCalculate;

    let calculationExpr = '';
    if (isCalculate && row.calculation) {
      calculationExpr = await this.convertCalculation(row.calculation);
    }

    const relevance = await this.convertRelevance(row.relevant);
    const emValidation = isNoteOrCalc
      ? ''
      : await convertConstraint(row.constraint || '');
    const mandatory = isNoteOrCalc
      ? ''
      : row.required === 'yes' || row.required === 'true'
        ? 'Y'
        : '';
    const otherPattern = this.configManager.getConfig().convertOtherPattern
      ? this.hasOtherQuestionPattern(row, this.surveyDataCache)
      : false;
    const other = isNoteOrCalc ? '' : lsType.other || otherPattern ? 'Y' : '';
    const defaultVal = isNoteOrCalc ? '' : row.default || '';
    // Suppress LimeSurvey's stock per-question tips ("Only numbers may be
    // entered", "Select all that apply", …) on real questions. Notes (type X)
    // carry no tip, so leave them alone.
    const hideTip =
      !isNoteOrCalc && this.configManager.getConfig().hideQuestionTips !== false
        ? '1'
        : '';

    this.emitForEachLanguage((lang) => {
      let text: string;
      if (isCalculate) {
        text = `{${calculationExpr}}`;
      } else {
        text = this.renderLabel(row.label, lang, questionName);
      }
      text = this.convertVariableReferences(text);
      const help = this.convertVariableReferences(
        this.renderLabel(row.hint, lang),
      );

      return {
        class: 'Q',
        'type/scale': isNote ? 'X' : lsType.type,
        name: questionName,
        relevance,
        text,
        help,
        em_validation_q: emValidation,
        mandatory,
        other,
        default: defaultVal,
        same_default: '',
        hidden: isCalculate ? '1' : '',
        ...(hideTip ? { hide_tip: hideTip } : {}),
        // Date/time widget format (date vs time vs both), from the registry.
        ...(lsType.dateFormat ? { date_format: lsType.dateFormat } : {}),
        // Vocabulary provenance for from_file selects. Stored in the `cssclass`
        // question attribute (namespaced `cdlvocab-<id>`) — verified to survive
        // LimeSurvey import and be queryable, unlike an unregistered attribute.
        // It's a machine hook only (no styling effect); the faithful reference
        // still lives in DDI's concept/@vocab. Empty for all other questions.
        ...(cdlVocab ? { cssclass: `cdlvocab-${cdlVocab}` } : {}),
      };
    });

    // Reset answer sequence for this question
    this.answerSeq = 0;
    this.subquestionSeq = 0;

    // Add answers/subquestions for select types (notes don't have answers)
    if (!isNote && xfTypeInfo.listName) {
      this.addAnswers(xfTypeInfo, lsType);
    }
  }

  // ── Matrix questions ─────────────────────────────────────────────────

  /**
   * Open a LimeSurvey array (F) for a `table-list` group. The array title is
   * the group label; its select_one children are added as subquestions and the
   * shared answer scale is emitted by flushMatrix (on end_group). No G row is
   * emitted — the group *is* the array.
   */
  private async addTableListHeader(
    row: SurveyRow,
    questionName: string,
  ): Promise<void> {
    this.groupSeq++;
    this.inMatrix = true;
    this.inTableListMatrix = true;
    this.matrixListName = null;
    this.subquestionSeq = 0;

    const relevance = await this.convertRelevance(row.relevant);
    const mandatory =
      row.required === 'yes' || row.required === 'true' ? 'Y' : '';

    const hideTip =
      this.configManager.getConfig().hideQuestionTips !== false ? '1' : '';
    this.emitForEachLanguage((lang) => ({
      class: 'Q',
      'type/scale': 'F',
      name: questionName,
      relevance,
      mandatory,
      text: this.renderLabel(row.label, lang, questionName),
      help: this.renderLabel(row.hint, lang),
      ...(hideTip ? { hide_tip: hideTip } : {}),
    }));
  }

  private async addMatrixHeader(
    row: SurveyRow,
    xfTypeInfo: TypeInfo,
  ): Promise<void> {
    const questionName =
      row.name && row.name.trim() !== ''
        ? this.sanitizeName(row.name.trim())
        : `Q${this.questionSeq}`;

    this.questionSeq++;
    this.inMatrix = true;
    this.matrixListName = xfTypeInfo.listName;
    this.subquestionSeq = 0;

    const relevance = await this.convertRelevance(row.relevant);
    const mandatory =
      row.required === 'yes' || row.required === 'true' ? 'Y' : '';

    const hideTip =
      this.configManager.getConfig().hideQuestionTips !== false ? '1' : '';
    this.emitForEachLanguage((lang) => ({
      class: 'Q',
      'type/scale': 'F',
      name: questionName,
      relevance,
      mandatory,
      text: this.renderLabel(row.label, lang, questionName),
      help: this.renderLabel(row.hint, lang),
      ...(hideTip ? { hide_tip: hideTip } : {}),
    }));
  }

  private async addMatrixSubquestion(row: SurveyRow): Promise<void> {
    const sqName =
      row.name && row.name.trim() !== ''
        ? this.sanitizeName(row.name.trim())
        : `SQ${this.subquestionSeq}`;

    this.subquestionSeq++;
    const relevance = await this.convertRelevance(row.relevant);
    const mandatory =
      row.required === 'yes' || row.required === 'true' ? 'Y' : '';

    this.emitForEachLanguage((lang) => ({
      class: 'SQ',
      name: sqName,
      relevance,
      mandatory,
      text: this.renderLabel(row.label, lang, sqName),
    }));
  }

  private flushMatrix(): void {
    if (!this.inMatrix || !this.matrixListName) {
      this.inMatrix = false;
      this.matrixListName = null;
      return;
    }

    const choices = this.choicesMap.get(this.matrixListName);
    if (choices) {
      let seq = 0;
      for (const choice of choices) {
        const choiceName =
          choice.name && choice.name.trim() !== ''
            ? this.sanitizeAnswerCode(choice.name.trim())
            : `A${seq++}`;

        this.emitForEachLanguage((lang) => ({
          class: 'A',
          name: choiceName,
          relevance: '',
          text: this.renderLabel(choice.label, lang, choiceName),
        }));
      }
    }

    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
  }

  // ── Answer emission ──────────────────────────────────────────────────

  private addAnswers(xfTypeInfo: TypeInfo, lsType: LSType): void {
    const choices = this.choicesMap.get(xfTypeInfo.listName!);
    if (!choices) {
      console.warn(`Choice list not found: ${xfTypeInfo.listName}`);
      return;
    }

    const answerClass =
      lsType.answerClass ||
      (xfTypeInfo.base === 'select_multiple' ? 'SQ' : 'A');

    // Pre-compute and deduplicate sanitized choice names
    const rawNames = choices.map((choice) => {
      const rawName =
        choice.name && choice.name.trim() !== '' ? choice.name.trim() : '';
      return rawName
        ? this.sanitizeAnswerCode(rawName)
        : answerClass === 'SQ'
          ? `SQ${this.subquestionSeq++}`
          : `A${this.answerSeq++}`;
    });

    const choiceNames = deduplicateNames(rawNames, 5);
    for (let i = 0; i < rawNames.length; i++) {
      if (choiceNames[i] !== rawNames[i]) {
        console.warn(
          `Duplicate answer code "${rawNames[i]}" resolved to "${choiceNames[i]}"`,
        );
      }
    }

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const choiceName = choiceNames[i];

      this.emitForEachLanguage((lang) => ({
        class: answerClass,
        name: choiceName,
        relevance: '',
        ...(choice.filter
          ? {
              relevance: `({${this.currentGroup || 'parent'}} == "${choice.filter}")`,
            }
          : {}),
        text: this.renderLabel(choice.label, lang, choiceName),
      }));
    }
  }

  // ── Expression transpilation ─────────────────────────────────────────

  private lookupAnswerCode(
    fieldName: string,
    choiceValue: string,
  ): { code: string; listName: string | undefined } {
    const stripped = fieldName.replace(/[_-]/g, '');
    const resolved = this.fieldSanitizer.resolveStrippedName(stripped);
    const listName = this.questionToListMap.get(resolved);
    if (!listName) return { code: choiceValue, listName: undefined };
    const codeMap = this.answerCodeMap.get(listName);
    if (!codeMap) return { code: choiceValue, listName };
    return { code: codeMap.get(choiceValue) ?? choiceValue, listName };
  }

  private buildTranspilerContext(): TranspilerContext {
    return {
      lookupAnswerCode: (fieldName: string, choiceValue: string) => {
        return this.lookupAnswerCode(fieldName, choiceValue).code;
      },
      getTruncatedFieldName: (fieldName: string) => {
        return this.fieldSanitizer.resolveStrippedName(fieldName);
      },
      buildSelectedExpr: (fieldName: string, choiceValue: string) => {
        const resolved = this.fieldSanitizer.resolveStrippedName(fieldName);
        const { code } = this.lookupAnswerCode(fieldName, choiceValue);
        const baseType = this.questionBaseTypeMap.get(resolved);
        if (baseType === 'select_multiple') {
          return `(${resolved}_${code}.NAOK == 'Y')`;
        }
        return `(${resolved}.NAOK=='${code}')`;
      },
    };
  }

  private async convertRelevance(relevant?: string): Promise<string> {
    if (!relevant) return '1';
    return await convertRelevance(relevant, this.buildTranspilerContext());
  }

  private async convertCalculation(calculation: string): Promise<string> {
    return await xpathToLimeSurvey(calculation, this.buildTranspilerContext());
  }

  // ── Type helpers ─────────────────────────────────────────────────────

  private parseType(typeStr: string): TypeInfo {
    return this.typeMapper.parseType(typeStr);
  }

  private mapType(xfTypeInfo: TypeInfo): LSType {
    return this.typeMapper.mapType(xfTypeInfo);
  }
}

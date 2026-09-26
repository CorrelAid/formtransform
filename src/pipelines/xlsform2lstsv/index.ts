import { ConfigManager } from '../../config/ConfigManager.js';
import { resolveConfig } from '../../config/resolveConfig.js';
import type { LstsvConfig } from '../../config/types.js';
import { SurveyRow, ChoiceRow, SettingsRow } from '../../xlsform/types.js';
import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { TSVGenerator } from '../../lstsv/serialize.js';
import { TypeMapper } from './typeMapper.js';

// Import extracted constants
import { SKIP_TYPES, TSVRowData } from './constants.js';
import { ChoiceManager } from './choiceManager.js';
import { GroupProcessor } from './groupProcessor.js';
import { LanguageHandler } from './languageHandler.js';
import { RowEmitter } from './rowEmitter.js';
import { OtherPatternDetector } from './otherPatternDetector.js';
import { OTHER_SUFFIX } from '../../conventions/other.js';
import { instrumentFromXlsform } from '../../instrument/fromXlsform.js';
import type { Item } from '../../instrument/types.js';
import { allItems, allQuestions } from '../../instrument/walk.js';

/** What closes a group in the row stream processRow reads. */
const END_GROUP_ROW: SurveyRow = { type: 'end_group' };
import { SurveySettingsEmitter } from './surveySettingsEmitter.js';
import { GroupEmitter } from './groupEmitter.js';
import { MatrixHandler, MatrixHelpers } from './matrixHandler.js';
import { Counters } from './counters.js';
import { AnswerEmitter, AnswerHelpers } from './answerEmitter.js';
import { TranspilerHelper } from './transpilerHelper.js';
import { FieldNameHandler } from './fieldNameHandler.js';
import { AppearanceHandler } from './appearanceHandler.js';
import { registeredFileChoices } from '../../vocab.js';
import { XLSValidator } from '../../xlsform/validate.js';
import type { RowCheckContext } from '../../xlsform/validate.js';
import { ConversionError, consoleWarning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';
import { parameterAttributes } from './parameters.js';
import { EXCLUSIVE_RULE, isExclusive } from '../../conventions/exclusive.js';
import {
  FROM_FILE_BASE,
  cssClassForVocab,
  vocabFromFilename,
} from '../../conventions/fromFile.js';

// Registry appearances are an allowlist: only 'handled' entries are
// registered. Anything else (or a handled appearance on the wrong type)
// warns and is ignored.

// Naming convention:
// - xfType: XLSForm type (string from row.type)
// - xfTypeInfo: Parsed XLSForm type information (TypeInfo interface)
// - lsType: LimeSurvey type information (LSType interface)

/**
 * One XLSForm → LimeSurvey TSV conversion. Every collaborator and all
 * per-conversion state (choices, field names, counters, buffered rows,
 * languages) belong to this object, which {@link XLSFormToTSVConverter.convert}
 * creates fresh for each call and drops afterwards. So nothing leaks from one
 * conversion into the next, and concurrent calls can't interfere.
 */
class Conversion {
  private configManager: ConfigManager;
  private fieldSanitizer: FieldSanitizer;
  private typeMapper: TypeMapper;
  private tsvGenerator: TSVGenerator;
  private choiceManager: ChoiceManager;
  private groupProcessor: GroupProcessor;
  private languageHandler: LanguageHandler;
  private rowEmitter: RowEmitter;
  private otherPatternDetector: OtherPatternDetector;
  private groupEmitter: GroupEmitter;
  private matrixHandler: MatrixHandler;
  private answerEmitter: AnswerEmitter;
  private transpilerHelper: TranspilerHelper;
  private fieldNameHandler: FieldNameHandler;
  private appearanceHandler: AppearanceHandler;
  private counters: Counters;
  private fileChoices: Record<string, ChoiceRow[]>;
  private surveySettingsEmitter: SurveySettingsEmitter;
  private surveyDataCache: SurveyRow[] = [];
  /** `<q>_other` rows folded into their parent's native `other=Y` (#79). */
  private collapsedCompanions = new Set<SurveyRow>();
  /** Parent select → its folded companion, whose label labels the native box. */
  private companionByParent = new Map<SurveyRow, SurveyRow>();
  private rowCheck: RowCheckContext = { listNames: new Set() };
  private readonly warn: WarningHandler;

  constructor(config: Readonly<LstsvConfig>) {
    this.configManager = new ConfigManager(config);
    this.fileChoices = {};
    this.warn = config.onWarning ?? consoleWarning;

    this.fieldSanitizer = new FieldSanitizer(this.warn);
    this.choiceManager = new ChoiceManager(this.fieldSanitizer);
    this.groupProcessor = new GroupProcessor(this.configManager);
    this.languageHandler = new LanguageHandler(this.configManager);
    this.otherPatternDetector = new OtherPatternDetector(
      this.choiceManager,
      this.languageHandler,
      this.warn,
    );

    this.typeMapper = new TypeMapper(this.warn);

    this.tsvGenerator = new TSVGenerator();
    this.rowEmitter = new RowEmitter(this.tsvGenerator, this.languageHandler);
    this.surveySettingsEmitter = new SurveySettingsEmitter(
      this.configManager,
      this.rowEmitter,
      this.languageHandler,
    );
    this.counters = new Counters();
    this.groupEmitter = new GroupEmitter(
      this.configManager,
      this.rowEmitter,
      this.languageHandler,
      this.counters,
    );
    this.matrixHandler = new MatrixHandler(
      this.configManager,
      this.rowEmitter,
      this.languageHandler,
      this.choiceManager,
      this.counters,
    );
    this.answerEmitter = new AnswerEmitter({
      rowEmitter: this.rowEmitter,
      languageHandler: this.languageHandler,
      choiceManager: this.choiceManager,
      groupEmitter: this.groupEmitter,
      counters: this.counters,
      onWarning: this.warn,
    });
    this.transpilerHelper = new TranspilerHelper(
      this.fieldSanitizer,
      this.choiceManager,
      this.warn,
    );
    this.fieldNameHandler = new FieldNameHandler(this.fieldSanitizer);
    this.appearanceHandler = new AppearanceHandler(this.warn);
  }

  // ── Row helpers ──────────────────────────────────────────────────────

  /** Helpers passed to the matrix handler so it can call back into the converter. */
  private matrixHelpers(): MatrixHelpers {
    return {
      sanitizeName: (name) => this.fieldNameHandler.sanitizeName(name),
      sanitizeAnswerCode: (code) =>
        this.fieldNameHandler.sanitizeAnswerCode(code),
      convertRelevance: (relevant) =>
        this.transpilerHelper.convertRelevance(relevant),
    };
  }

  /** Helpers passed to the answer emitter. */
  private answerHelpers(): AnswerHelpers {
    return {
      sanitizeAnswerCode: (code) =>
        this.fieldNameHandler.sanitizeAnswerCode(code),
    };
  }

  /** Run the conversion; synchronous, throws on the first problem. */
  run(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    settingsData: SettingsRow[],
    fileChoices: Record<string, ChoiceRow[]>,
  ): string {
    // The survey as a tree (#69): the group pre-scans read it, and the rows
    // are emitted by walking it.
    const instrument = instrumentFromXlsform(
      surveyData,
      choicesData,
      settingsData,
    );

    // Pre-scan for welcome/end notes (must happen before group identification)
    this.surveySettingsEmitter.captureNotes(allQuestions(instrument.body));
    // Every item's source row, in survey order: what the row-based scans read.
    const rows = allItems(instrument.body).map((item) => item.row as SurveyRow);

    this.fileChoices = { ...registeredFileChoices(rows), ...fileChoices };
    this.rowCheck = {
      listNames: XLSValidator.listNamesOf(choicesData),
      fileChoices: this.fileChoices,
    };

    // Parent-only groups (no direct questions) and message-only groups (only
    // a welcome/end note)
    this.groupProcessor.identifyGroups(instrument.body);

    // Cache survey data for pattern detection
    this.surveyDataCache = rows;

    // Set base language from settings first
    this.languageHandler.setBaseLanguage(settingsData[0] || {});

    // Detect available languages from survey data (will use baseLanguage for ordering)
    this.languageHandler.detectAvailableLanguages(
      rows,
      choicesData,
      settingsData,
    );

    // Build choices map, then overlay external-file lists (keyed by filename).
    this.choiceManager.buildChoicesMap(choicesData);
    this.choiceManager.addFileChoices(this.fileChoices);

    // Pre-scan: register all field names to detect and resolve collisions
    this.fieldNameHandler.registerFieldNames(rows);

    // Build answer code and question-to-list maps for relevance rewriting
    this.choiceManager.buildAnswerCodeMap((code) =>
      this.fieldNameHandler.sanitizeAnswerCode(code),
    );
    this.choiceManager.buildQuestionToListMap(
      allQuestions(instrument.body),
      (type) => this.typeMapper.parseType(type),
      (name) => this.fieldNameHandler.sanitizeName(name),
    );

    // Add survey row (class S)
    this.surveySettingsEmitter.emit(settingsData[0] || {});

    const hasGroups = instrument.body.some((item) => item.kind === 'group');

    // LimeSurvey needs every question in a group; add one if the form has none.
    if (!hasGroups) {
      this.groupEmitter.addDefaultGroup();
    }

    if (this.configManager.getConfig().convertOtherPattern) {
      const sanitize = (name: string) =>
        this.fieldNameHandler.sanitizeName(name);
      for (const row of rows) {
        const companion = this.otherPatternDetector.companionOf(
          row,
          rows,
          sanitize,
        );
        if (!companion) continue;
        this.collapsedCompanions.add(companion);
        this.companionByParent.set(row, companion);
        // References to the companion now mean LimeSurvey's native "other"
        // text, which expressions call `<code>_other`.
        this.fieldNameHandler.aliasName(
          companion.name ?? '',
          `${sanitize(row.name ?? '')}${OTHER_SUFFIX}`,
        );
      }
    }

    this.walk(instrument.body);

    // Flush any pending matrix at the end
    this.matrixHandler.flushMatrix(this.matrixHelpers());

    // Flush remaining buffered group content
    this.rowEmitter.flushGroupContent();

    // Generate TSV
    return this.tsvGenerator.generateTSV();
  }

  // ── Other question pattern detection ─────────────────────────────────

  // ── Language detection ────────────────────────────────────────────────

  // ── Field name handling ──────────────────────────────────────────────

  // ── Survey settings (S/SL rows) ─────────────────────────────────────

  // ── Row processing ───────────────────────────────────────────────────

  /**
   * Emit the Instrument's items in survey order: a group's own row, its
   * children, then its end (if the sheet closed it). A folded `_other`
   * companion is skipped.
   */
  private walk(items: Item[]): void {
    for (const item of items) {
      const row = item.row as SurveyRow;
      if (item.kind === 'question') {
        if (!this.collapsedCompanions.has(row)) this.processRow(row);
        continue;
      }
      this.processRow(row);
      this.walk(item.children);
      if (item.closed) this.processRow(END_GROUP_ROW);
    }
  }

  private processRow(row: SurveyRow): void {
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

    // Validate the type is registered and emittable. Two failure modes:
    //   1. registered but unsupported by LimeSurvey TSV (no native slot)
    //   2. not registered at all (convention:unregisteredRows)
    this.validateRow(row);

    if (xfType === 'begin_group' || xfType === 'begin group') {
      this.handleBeginGroup(row);
      return;
    }
    if (xfType === 'end_group' || xfType === 'end group') {
      this.handleEndGroup();
      return;
    }

    // Auto-create a group for questions outside any explicit group.
    if (this.isOutsideAnyGroup()) {
      this.rowEmitter.flushGroupContent();
      this.groupEmitter.addAutoGroupForOrphans();
    }

    this.addQuestion(row);
  }

  /**
   * Throws the validator's finding if the row is outside the subset (an
   * unregistered or unsupported type, or a select whose options don't
   * resolve). The same check {@link XLSValidator.validateSubset} reports.
   */
  private validateRow(row: SurveyRow): void {
    const problem = XLSValidator.rowDiagnostic(row, this.rowCheck);
    if (problem) throw ConversionError.from(problem);
  }

  /**
   * `exclude_all_others` for a select_multiple whose list marks choices
   * `exclusive` (convention:exclusiveChoice): their answer codes, `;`-joined.
   */
  private exclusiveAttribute(
    baseType: string,
    listName: string | null,
  ): Record<string, string> {
    if (!listName || !EXCLUSIVE_RULE.appliesTo.includes(baseType)) return {};
    const codes = (this.choiceManager.getChoices(listName) ?? [])
      .filter(isExclusive)
      .map((c) => this.fieldNameHandler.sanitizeAnswerCode(String(c.name)));
    if (codes.length === 0) return {};
    return {
      [EXCLUSIVE_RULE.limesurveyAttribute]: codes.join(
        EXCLUSIVE_RULE.limesurveySeparator,
      ),
    };
  }
  private handleBeginGroup(row: SurveyRow): void {
    this.matrixHandler.flushMatrix(this.matrixHelpers());
    const originalName = (row.name || '').trim();
    this.groupEmitter.handleBeginGroup(
      row,
      this.groupProcessor.getMessageOnlyGroups().has(originalName),
      this.groupProcessor.getParentOnlyGroups().has(originalName),
      {
        sanitizeName: (name) => this.fieldNameHandler.sanitizeName(name),
        convertRelevance: (relevant) =>
          this.transpilerHelper.convertRelevance(relevant),
      },
      (sanitizedName) =>
        this.matrixHandler.addTableListHeader(
          row,
          sanitizedName,
          this.matrixHelpers(),
        ),
    );
  }

  private handleEndGroup(): void {
    this.matrixHandler.flushMatrix(this.matrixHelpers());
    this.groupEmitter.popStack();
    this.groupEmitter.restoreCurrentGroupFromStack();
  }

  private isOutsideAnyGroup(): boolean {
    return (
      this.groupEmitter.getCurrentGroup() === null &&
      this.groupEmitter.getGroupStack().length === 0
    );
  }

  // ── Question emission ────────────────────────────────────────────────

  private addQuestion(row: SurveyRow): void {
    let xfTypeInfo = this.typeMapper.parseType(row.type || '');

    // select_*_from_file → emit as its base select with the referenced CSV's
    // options inlined. `cdl_vocab` records the source vocabulary (filename minus
    // extension), preserving the controlled-vocabulary link LimeSurvey has no
    // native slot for. listName stays the filename (choicesMap was keyed by it).
    let cdlVocab = '';
    if (xfTypeInfo.base in FROM_FILE_BASE) {
      cdlVocab = vocabFromFilename(xfTypeInfo.listName ?? '');
      xfTypeInfo = { ...xfTypeInfo, base: FROM_FILE_BASE[xfTypeInfo.base] };
    }

    const appearance =
      typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';

    // Dispatch through the matrix cases (in-table-list, label, list-nolabel).
    // The handler returns true if it consumed the row as part of a matrix,
    // false if it should be processed as a regular question (and the pending
    // matrix has been flushed).
    const handledByMatrix = this.matrixHandler.dispatchRow(
      row,
      xfTypeInfo,
      appearance,
      this.matrixHelpers(),
    );
    if (handledByMatrix) return;

    // Warn on unsupported appearances: not in the registry allowlist, or
    // registered but not valid for this question type.
    this.appearanceHandler.warnUnsupported(
      row.name,
      appearance,
      xfTypeInfo.base,
    );

    const questionName =
      row.name && row.name.trim() !== ''
        ? this.fieldNameHandler.sanitizeName(row.name.trim())
        : `Q${this.counters.getQuestionSeq()}`;

    this.counters.bumpQuestionSeq();

    const lsType = this.typeMapper.mapType(xfTypeInfo);

    // Appearance-based type overrides (driven by registry APPEARANCES)
    this.appearanceHandler.applyTypeOverrides(
      lsType,
      appearance,
      xfTypeInfo.base,
    );

    const fields = this.computeQuestionFields(row, xfTypeInfo, lsType);

    const ctx: QuestionRowContext = {
      lsType,
      fields,
      cdlVocab,
      attributes: {
        ...parameterAttributes(
          xfTypeInfo.base,
          row['parameters'],
          questionName,
        ),
        ...this.exclusiveAttribute(xfTypeInfo.base, xfTypeInfo.listName),
      },
    };

    this.rowEmitter.emitForEachLanguage((lang) =>
      this.buildQuestionRow(row, lang, questionName, ctx),
    );

    // Reset answer sequence for this question
    this.counters.setSubquestionSeq(0);
    this.counters.setAnswerSeq(0);

    // Add answers/subquestions for select types (notes don't have answers)
    if (xfTypeInfo.base !== 'note' && xfTypeInfo.listName) {
      this.answerEmitter.addAnswers(xfTypeInfo, lsType, {
        ...this.answerHelpers(),
        defaultCodes: new Set(
          typeof row.default === 'string'
            ? row.default.trim().split(/\s+/).filter(Boolean)
            : [],
        ),
      });
    }
  }

  /**
   * Compute the per-question fields that don't vary by language
   * (relevance, validation, mandatory, other, default, hidden, hide_tip).
   */
  private computeQuestionFields(
    row: SurveyRow,
    xfTypeInfo: { base: string },
    lsType: { other?: boolean; dateFormat?: string },
  ): {
    relevance: string;
    emValidation: string;
    mandatory: string;
    other: string;
    defaultVal: string;
    hidden: string;
    hideTip: string;
    isNote: boolean;
  } {
    // `calculate` is not registered, so it never gets here (validateRow).
    const isNote = xfTypeInfo.base === 'note';

    const relevance = this.transpilerHelper.convertRelevance(row.relevant);
    const emValidation = isNote
      ? ''
      : this.transpilerHelper.convertConstraint(row.constraint || '');
    const mandatory = isNote ? '' : this.mandatoryValue(row);
    const other = this.computeOtherFlag(row, lsType, isNote);
    const defaultVal = isNote ? '' : this.defaultValue(row, xfTypeInfo.base);
    // Suppress LimeSurvey's stock per-question tips ("Only numbers may be
    // entered", "Select all that apply", …) on real questions. Notes (type X)
    // carry no tip, so leave them alone.
    const hideTip = isNote
      ? ''
      : this.configManager.getConfig().hideQuestionTips !== false
        ? '1'
        : '';

    return {
      relevance,
      emValidation,
      mandatory,
      other,
      defaultVal,
      hidden: '',
      hideTip,
      isNote,
    };
  }

  /**
   * The Q row's `default`. A select_one's default is a choice code, so it
   * becomes the emitted (sanitized, deduplicated) answer code; a
   * select_multiple's defaults go on its SQ rows instead (addAnswers).
   */
  private defaultValue(row: SurveyRow, base: string): string {
    const raw = typeof row.default === 'string' ? row.default.trim() : '';
    if (!raw) return '';
    if (base === 'select_multiple') return '';
    if (base !== 'select_one') return raw;
    return this.choiceManager.lookupAnswerCode(row.name?.trim() ?? '', raw)
      .code;
  }

  /** Map the XLSForm `required` cell to LimeSurvey's `Y` (true) or empty. */
  private mandatoryValue(row: SurveyRow): string {
    return row.required === 'yes' || row.required === 'true' ? 'Y' : '';
  }

  /** `other=Y` if either the type is a select that natively carries `other`
   * (registry-driven) or the `_other` companion-question pattern is present. */
  private computeOtherFlag(
    row: SurveyRow,
    lsType: { other?: boolean },
    isNote: boolean,
  ): string {
    if (isNote) return '';
    const detected = this.configManager.getConfig().convertOtherPattern
      ? this.otherPatternDetector.hasOtherQuestionPattern(
          row,
          this.surveyDataCache,
          (type) => this.typeMapper.parseType(type),
          (name) => this.fieldNameHandler.sanitizeName(name),
        )
      : false;
    return lsType.other || detected ? 'Y' : '';
  }

  /**
   * Build the per-language Q row for a question. The body is the per-language
   * part (text, help); the rest of the fields come from the precomputed
   * `fields` argument.
   */
  private buildQuestionRow(
    row: SurveyRow,
    lang: string,
    questionName: string,
    ctx: QuestionRowContext,
  ): Partial<TSVRowData> & Pick<TSVRowData, 'class' | 'name'> {
    const { lsType, fields, cdlVocab, attributes } = ctx;
    const text = this.fieldNameHandler.convertVariableReferences(
      this.languageHandler.renderLabel(row.label, lang, questionName),
    );
    const help = this.fieldNameHandler.convertVariableReferences(
      this.languageHandler.renderLabel(row.hint, lang),
    );
    // constraint_message: LimeSurvey's per-language validation tip.
    const tip = fields.isNote
      ? ''
      : this.fieldNameHandler.convertVariableReferences(
          this.languageHandler.renderLabel(row.constraint_message, lang),
        );
    // A folded companion's label labels LimeSurvey's native "other" box.
    const companion = this.companionByParent.get(row);
    const otherText = companion
      ? this.fieldNameHandler.convertVariableReferences(
          this.languageHandler.renderLabel(companion.label, lang),
        )
      : '';

    return {
      class: 'Q',
      'type/scale': fields.isNote ? 'X' : lsType.type,
      name: questionName,
      relevance: fields.relevance,
      text,
      help,
      em_validation_q: fields.emValidation,
      mandatory: fields.mandatory,
      other: fields.other,
      default: fields.defaultVal,
      same_default: '',
      hidden: fields.hidden,
      ...(fields.hideTip ? { hide_tip: fields.hideTip } : {}),
      // Date/time widget format (date vs time vs both), from the registry.
      ...(lsType.dateFormat ? { date_format: lsType.dateFormat } : {}),
      // Vocabulary provenance for from_file selects. Stored in the `cssclass`
      // question attribute (namespaced `cdlvocab-<id>`) — verified to survive
      // LimeSurvey import and be queryable, unlike an unregistered attribute.
      // It's a machine hook only (no styling effect); the faithful reference
      // still lives in DDI's concept/@vocab. Empty for all other questions.
      ...(cdlVocab ? { cssclass: cssClassForVocab(cdlVocab) } : {}),
      ...(otherText ? { other_replace_text: otherText } : {}),
      ...(tip ? { em_validation_q_tip: tip } : {}),
      // Bounds etc. from the `parameters` column (range), per the registry.
      ...attributes,
    };
  }

  // ── Type helpers ─────────────────────────────────────────────────────
}

/** Per-question context passed to buildQuestionRow. */
interface QuestionRowContext {
  lsType: { type: string; dateFormat?: string };
  fields: {
    relevance: string;
    emValidation: string;
    mandatory: string;
    other: string;
    defaultVal: string;
    hidden: string;
    hideTip: string;
    isNote: boolean;
  };
  cdlVocab: string;
  /** LS question attributes from the `parameters` column (parameters.ts). */
  attributes: Record<string, string>;
}

/**
 * XLSForm → LimeSurvey structure TSV. The instance only holds its resolved
 * options; each {@link convert} call runs in its own {@link Conversion}, so one
 * instance can be reused, including for concurrent calls.
 */
export class XLSFormToTSVConverter {
  private config: Readonly<LstsvConfig>;

  constructor(config?: Partial<LstsvConfig>) {
    this.config = resolveConfig(config);
  }

  /** The resolved options. */
  getConfig(): Readonly<LstsvConfig> {
    return this.config;
  }

  /** Replace the options: `partialConfig` merged over the defaults. */
  updateConfig(partialConfig: Partial<LstsvConfig>): void {
    this.config = resolveConfig(partialConfig);
  }

  /**
   * Convert parsed XLSForm sheets to LimeSurvey TSV.
   *
   * @param fileChoices Choices for external-file lists
   *   (`select_*_from_file <name>.csv`), keyed by the referenced filename.
   *   Registered vocabularies (registry/vocab/) are built in; entries here add
   *   unregistered ones or override a registered one (the CLI reads CSVs beside
   *   the form via resolveFileChoices).
   */
  convert(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    settingsData: SettingsRow[],
    fileChoices: Record<string, ChoiceRow[]> = {},
  ): Promise<string> {
    try {
      return Promise.resolve(
        new Conversion(this.config).run(
          surveyData,
          choicesData,
          settingsData,
          fileChoices,
        ),
      );
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

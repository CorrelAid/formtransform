import { ConfigManager, ConversionConfig } from '../../config/ConfigManager.js';
import { SurveyRow, ChoiceRow, SettingsRow } from '../../config/types.js';
import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { TSVGenerator } from '../../lstsv/serialize.js';
import { TypeMapper, TYPE_MAPPINGS } from './typeMapper.js';

// Import extracted constants
import {
  SKIP_TYPES,
  UNIMPLEMENTED_TYPES,
  FROM_FILE_BASE,
  TSVRowData,
} from './constants.js';
import { ChoiceManager } from './choiceManager.js';
import { GroupProcessor } from './groupProcessor.js';
import { LanguageHandler } from './languageHandler.js';
import { RowEmitter } from './rowEmitter.js';
import { OtherPatternDetector } from './otherPatternDetector.js';
import { SurveySettingsEmitter } from './surveySettingsEmitter.js';
import { GroupEmitter } from './groupEmitter.js';
import { MatrixHandler, MatrixHelpers } from './matrixHandler.js';
import { Counters } from './counters.js';
import { AnswerEmitter, AnswerHelpers } from './answerEmitter.js';
import { TranspilerHelper } from './transpilerHelper.js';
import { FieldNameHandler } from './fieldNameHandler.js';
import { AppearanceHandler } from './appearanceHandler.js';
import { registeredFileChoices, registeredVocabFiles } from '../../vocab.js';
import { parameterAttributes } from './parameters.js';
import { EXCLUSIVE_RULE, isExclusive } from '../../xlsform/exclusive.js';

// Registry appearances are an allowlist: only 'handled' entries are
// registered. Anything else (or a handled appearance on the wrong type)
// warns and is ignored.

// Naming convention:
// - xfType: XLSForm type (string from row.type)
// - xfTypeInfo: Parsed XLSForm type information (TypeInfo interface)
// - lsType: LimeSurvey type information (LSType interface)

export class XLSFormToTSVConverter {
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
  private fileChoices: Record<string, ChoiceRow[]> = {};
  private surveySettingsEmitter: SurveySettingsEmitter;
  private surveyDataCache: SurveyRow[] = [];

  constructor(config?: Partial<ConversionConfig>) {
    this.configManager = new ConfigManager(config);
    this.configManager.validateConfig();

    this.fieldSanitizer = new FieldSanitizer();
    this.choiceManager = new ChoiceManager(this.fieldSanitizer);
    this.groupProcessor = new GroupProcessor(this.configManager);
    this.languageHandler = new LanguageHandler(this.configManager);
    this.otherPatternDetector = new OtherPatternDetector(
      this.choiceManager,
      this.languageHandler,
    );

    this.typeMapper = new TypeMapper();

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
    this.answerEmitter = new AnswerEmitter(
      this.rowEmitter,
      this.languageHandler,
      this.choiceManager,
      this.groupEmitter,
      this.counters,
    );
    this.transpilerHelper = new TranspilerHelper(
      this.fieldSanitizer,
      this.choiceManager,
    );
    this.fieldNameHandler = new FieldNameHandler(this.fieldSanitizer);
    this.appearanceHandler = new AppearanceHandler();
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
    // the referenced filename. Registered vocabularies (registry/vocab/) are
    // built in; entries here add unregistered ones or override a registered one
    // (the CLI reads CSVs beside the form via resolveFileChoices). A from_file
    // question is emitted as its base select with these choices inlined + a
    // `cdl_vocab` attribute naming the source vocabulary.
    fileChoices: Record<string, ChoiceRow[]> = {},
  ): Promise<string> {
    // Reset state
    this.fileChoices = { ...registeredFileChoices(surveyData), ...fileChoices };
    this.choiceManager.clear();
    this.tsvGenerator.clear();
    this.counters.clear();
    this.rowEmitter.clear();
    this.surveySettingsEmitter.clear();
    this.groupEmitter.clear();
    this.matrixHandler.clear();

    // Pre-scan for welcome/end notes (must happen before group identification)
    this.surveySettingsEmitter.captureNotes(surveyData);

    // Pre-scan to identify parent-only groups (no direct questions, only child groups)
    this.groupProcessor.identifyParentOnlyGroups(surveyData);

    // Pre-scan to identify groups whose only content is a welcome/end note
    this.groupProcessor.identifyMessageOnlyGroups(surveyData);

    // Cache survey data for pattern detection
    this.surveyDataCache = surveyData;

    // Set base language from settings first
    this.languageHandler.setBaseLanguage(settingsData[0] || {});

    // Detect available languages from survey data (will use baseLanguage for ordering)
    this.languageHandler.detectAvailableLanguages(
      surveyData,
      choicesData,
      settingsData,
    );

    // Build choices map, then overlay external-file lists (keyed by filename).
    this.choiceManager.buildChoicesMap(choicesData);
    this.choiceManager.addFileChoices(this.fileChoices);

    // Pre-scan: register all field names to detect and resolve collisions
    this.fieldNameHandler.registerFieldNames(surveyData);

    // Build answer code and question-to-list maps for relevance rewriting
    this.choiceManager.buildAnswerCodeMap((code) =>
      this.fieldNameHandler.sanitizeAnswerCode(code),
    );
    this.choiceManager.buildQuestionToListMap(
      surveyData,
      (type) => this.typeMapper.parseType(type),
      (name) => this.fieldNameHandler.sanitizeName(name),
    );

    // Add survey row (class S)
    this.surveySettingsEmitter.emit(settingsData[0] || {});

    // Check if we need a default group (if no groups are defined)
    const hasGroups = surveyData.some((row) => {
      const xfType = (row.type || '').trim();
      return xfType === 'begin_group';
    });

    // If no groups, add a default group
    const advancedOptions = this.configManager.getAdvancedOptions();
    if (!hasGroups && advancedOptions.autoCreateGroups) {
      this.groupEmitter.addDefaultGroup();
    }

    // Process survey rows
    for (const row of surveyData) {
      await this.processRow(row);
    }

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

    // Validate the type is registered and emittable. Two failure modes:
    //   1. registered but unsupported by LimeSurvey TSV (no native slot)
    //   2. not registered at all (convention:unregisteredRows)
    this.validateRowType(xfType, baseType, row.name);

    if (xfType === 'begin_group' || xfType === 'begin group') {
      await this.handleBeginGroup(row);
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

    await this.addQuestion(row);
  }

  /**
   * Throws if the row's type is not emittable: registered but unsupported,
   * not registered at all, or a select whose options don't resolve.
   */
  private validateRowType(
    xfType: string,
    baseType: string,
    name: string | undefined,
  ): void {
    const where = name ? ` (question "${name}")` : '';
    const target = xfType.split(/\s+/)[1];
    if (baseType in FROM_FILE_BASE) {
      this.assertFileChoices(xfType, baseType, target, where);
    } else if (UNIMPLEMENTED_TYPES.includes(baseType)) {
      throw new Error(
        `Unimplemented XLSForm type: '${baseType}'. This type is not currently supported.`,
      );
    } else if (TYPE_MAPPINGS[baseType]?.requiresListName) {
      this.assertChoiceList(xfType, baseType, target, where);
    }

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

  /** `select_*_from_file` is supported whenever its options resolve; say which part is missing. */
  private assertFileChoices(
    xfType: string,
    baseType: string,
    file: string | undefined,
    where: string,
  ): void {
    if (!file) {
      throw new Error(
        `'${baseType}'${where} needs a vocabulary file: '${baseType} <file>.csv'`,
      );
    }
    if ((this.fileChoices[file]?.length ?? 0) === 0) {
      throw new Error(
        `'${xfType}'${where}: '${file}' is not a registered vocabulary ` +
          `(registered: ${registeredVocabFiles().join(', ')}) and no ` +
          `fileChoices were supplied for it`,
      );
    }
  }

  /** A select without options would import as a question nobody can answer. */
  private assertChoiceList(
    xfType: string,
    baseType: string,
    list: string | undefined,
    where: string,
  ): void {
    if (!list || list === 'or_other') {
      throw new Error(
        `'${baseType}'${where} needs a choice list: '${baseType} <list_name>'`,
      );
    }
    if ((this.choiceManager.getChoices(list)?.length ?? 0) === 0) {
      throw new Error(
        `'${xfType}'${where}: list '${list}' has no rows on the choices sheet`,
      );
    }
  }

  private async handleBeginGroup(row: SurveyRow): Promise<void> {
    this.matrixHandler.flushMatrix(this.matrixHelpers());
    const originalName = (row.name || '').trim();
    await this.groupEmitter.handleBeginGroup(
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

  private async addQuestion(row: SurveyRow): Promise<void> {
    let xfTypeInfo = this.typeMapper.parseType(row.type || '');

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

    // Dispatch through the matrix cases (in-table-list, label, list-nolabel).
    // The handler returns true if it consumed the row as part of a matrix,
    // false if it should be processed as a regular question (and the pending
    // matrix has been flushed).
    const handledByMatrix = await this.matrixHandler.dispatchRow(
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

    const fields = await this.computeQuestionFields(row, xfTypeInfo, lsType);

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
      this.answerEmitter.addAnswers(xfTypeInfo, lsType, this.answerHelpers());
    }
  }

  /**
   * Compute the per-question fields that don't vary by language
   * (relevance, validation, mandatory, other, default, hidden, hide_tip).
   */
  private async computeQuestionFields(
    row: SurveyRow,
    xfTypeInfo: { base: string },
    lsType: { other?: boolean; dateFormat?: string },
  ): Promise<{
    calculationExpr: string;
    relevance: string;
    emValidation: string;
    mandatory: string;
    other: string;
    defaultVal: string;
    hidden: string;
    hideTip: string;
    isNote: boolean;
    isCalculate: boolean;
  }> {
    const isNote = xfTypeInfo.base === 'note';
    const isCalculate = xfTypeInfo.base === 'calculate';
    const isNoteOrCalc = isNote || isCalculate;

    const calculationExpr = await this.computeCalculation(row, isCalculate);
    const relevance = await this.transpilerHelper.convertRelevance(
      row.relevant,
    );
    const emValidation = isNoteOrCalc
      ? ''
      : await this.transpilerHelper.convertConstraint(row.constraint || '');
    const mandatory = isNoteOrCalc ? '' : this.mandatoryValue(row);
    const other = this.computeOtherFlag(row, lsType, isNoteOrCalc);
    const defaultVal = isNoteOrCalc ? '' : row.default || '';
    // Suppress LimeSurvey's stock per-question tips ("Only numbers may be
    // entered", "Select all that apply", …) on real questions. Notes (type X)
    // carry no tip, so leave them alone.
    const hideTip = isNoteOrCalc
      ? ''
      : this.configManager.getConfig().hideQuestionTips !== false
        ? '1'
        : '';

    return {
      calculationExpr,
      relevance,
      emValidation,
      mandatory,
      other,
      defaultVal,
      hidden: isCalculate ? '1' : '',
      hideTip,
      isNote,
      isCalculate,
    };
  }

  /** Transpile `row.calculation` to EM, only meaningful for `calculate` questions. */
  private async computeCalculation(
    row: SurveyRow,
    isCalculate: boolean,
  ): Promise<string> {
    if (!isCalculate || !row.calculation) return '';
    return this.transpilerHelper.convertCalculation(row.calculation);
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
    isNoteOrCalc: boolean,
  ): string {
    if (isNoteOrCalc) return '';
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
    let text: string;
    if (fields.isCalculate) {
      text = `{${fields.calculationExpr}}`;
    } else {
      text = this.languageHandler.renderLabel(row.label, lang, questionName);
    }
    text = this.fieldNameHandler.convertVariableReferences(text);
    const help = this.fieldNameHandler.convertVariableReferences(
      this.languageHandler.renderLabel(row.hint, lang),
    );

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
      ...(cdlVocab ? { cssclass: `cdlvocab-${cdlVocab}` } : {}),
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
    calculationExpr: string;
    relevance: string;
    emValidation: string;
    mandatory: string;
    other: string;
    defaultVal: string;
    hidden: string;
    hideTip: string;
    isNote: boolean;
    isCalculate: boolean;
  };
  cdlVocab: string;
  /** LS question attributes from the `parameters` column (parameters.ts). */
  attributes: Record<string, string>;
}

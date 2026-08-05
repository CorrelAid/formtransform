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

// Import extracted constants
import {
  SKIP_TYPES,
  UNIMPLEMENTED_TYPES,
  FROM_FILE_BASE,
  TSVRowData,
  GroupStackItem,
} from './constants.js';
import { ChoiceManager } from './choiceManager.js';
import { GroupProcessor } from './groupProcessor.js';
import { LanguageHandler } from './languageHandler.js';
import { RowEmitter } from './rowEmitter.js';
import { OtherPatternDetector } from './otherPatternDetector.js';
import { SurveySettingsEmitter } from './surveySettingsEmitter.js';

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
  private fileChoices: Record<string, ChoiceRow[]> = {};
  private currentGroup: string | null;
  private groupStack: GroupStackItem[];
  private pendingGroupNotes: SurveyRow[];
  private groupSeq: number;
  private questionSeq: number;
  private answerSeq: number;
  private subquestionSeq: number;
  private inMatrix: boolean;
  private matrixListName: string | null;
  // True while inside a `table-list` group emitted as a LimeSurvey array (F):
  // its select_one children become subquestions of one array question.
  private inTableListMatrix: boolean;
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
    this.currentGroup = null;
    this.groupStack = [];
    this.pendingGroupNotes = [];
    this.groupSeq = 0;
    this.questionSeq = 0;
    this.answerSeq = 0;
    this.subquestionSeq = 0;
    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
  }

  // ── Row helpers ──────────────────────────────────────────────────────

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
    this.choiceManager.clear();
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
    this.rowEmitter.clear();
    this.surveySettingsEmitter.clear();

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
    this.registerFieldNames(surveyData);

    // Build answer code and question-to-list maps for relevance rewriting
    this.choiceManager.buildAnswerCodeMap((code) =>
      this.sanitizeAnswerCode(code),
    );
    this.choiceManager.buildQuestionToListMap(
      surveyData,
      (type) => this.parseType(type),
      (name) => this.sanitizeName(name),
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
      this.addDefaultGroup();
    }

    // Process survey rows
    for (const row of surveyData) {
      await this.processRow(row);
    }

    // Flush any pending matrix at the end
    this.flushMatrix();

    // Flush remaining buffered group content
    this.rowEmitter.flushGroupContent();

    // Generate TSV
    return this.tsvGenerator.generateTSV();
  }

  // ── Other question pattern detection ─────────────────────────────────

  // ── Language detection ────────────────────────────────────────────────

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

  // ── Survey settings (S/SL rows) ─────────────────────────────────────

  // ── Group handling ───────────────────────────────────────────────────

  private addDefaultGroup(): void {
    const groupName = this.configManager.getDefaults().groupName;
    this.currentGroup = groupName;

    // Emit the group in every detected survey language, NOT the config default
    // ('en'). A group row whose language differs from the survey base language
    // fails LimeSurvey's activation consistency check (e.g. a German-base survey
    // with an English-only "Questions" group).
    this.rowEmitter.emitForEachLanguage(
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

    this.rowEmitter.emitForEachLanguage(
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

    this.rowEmitter.emitForEachLanguage(
      (lang) => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: this.languageHandler.renderLabel(row.label, lang, groupName),
        relevance,
        text: this.languageHandler.renderLabel(row.hint, lang),
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

      this.rowEmitter.emitForEachLanguage((lang) => ({
        class: 'Q',
        'type/scale': 'X',
        name: noteName,
        relevance,
        text: this.languageHandler.renderLabel(noteRow.label, lang, noteName),
        help: this.languageHandler.renderLabel(noteRow.hint, lang),
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
        this.rowEmitter.flushGroupContent();
        await this.addGroup(row);
        await this.emitPendingGroupNotes();
        await this.addTableListHeader(row, sanitizedName);
        return;
      }

      if (this.groupProcessor.getMessageOnlyGroups().has(originalName)) {
        this.groupStack.push({
          originalName,
          sanitizedName,
          emittedAsGroup: false,
        });
      } else if (this.groupProcessor.getParentOnlyGroups().has(originalName)) {
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
        this.rowEmitter.flushGroupContent();
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
      this.rowEmitter.flushGroupContent();
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
      ? this.otherPatternDetector.hasOtherQuestionPattern(
          row,
          this.surveyDataCache,
          (type) => this.parseType(type),
          (name) => this.sanitizeName(name),
        )
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

    this.rowEmitter.emitForEachLanguage((lang) => {
      let text: string;
      if (isCalculate) {
        text = `{${calculationExpr}}`;
      } else {
        text = this.languageHandler.renderLabel(row.label, lang, questionName);
      }
      text = this.convertVariableReferences(text);
      const help = this.convertVariableReferences(
        this.languageHandler.renderLabel(row.hint, lang),
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
    this.rowEmitter.emitForEachLanguage((lang) => ({
      class: 'Q',
      'type/scale': 'F',
      name: questionName,
      relevance,
      mandatory,
      text: this.languageHandler.renderLabel(row.label, lang, questionName),
      help: this.languageHandler.renderLabel(row.hint, lang),
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
    this.rowEmitter.emitForEachLanguage((lang) => ({
      class: 'Q',
      'type/scale': 'F',
      name: questionName,
      relevance,
      mandatory,
      text: this.languageHandler.renderLabel(row.label, lang, questionName),
      help: this.languageHandler.renderLabel(row.hint, lang),
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

    this.rowEmitter.emitForEachLanguage((lang) => ({
      class: 'SQ',
      name: sqName,
      relevance,
      mandatory,
      text: this.languageHandler.renderLabel(row.label, lang, sqName),
    }));
  }

  private flushMatrix(): void {
    if (!this.inMatrix || !this.matrixListName) {
      this.inMatrix = false;
      this.matrixListName = null;
      return;
    }

    const choices = this.choiceManager.getChoices(this.matrixListName);
    if (choices) {
      let seq = 0;
      for (const choice of choices) {
        const choiceName =
          choice.name && choice.name.trim() !== ''
            ? this.sanitizeAnswerCode(choice.name.trim())
            : `A${seq++}`;

        this.rowEmitter.emitForEachLanguage((lang) => ({
          class: 'A',
          name: choiceName,
          relevance: '',
          text: this.languageHandler.renderLabel(
            choice.label,
            lang,
            choiceName,
          ),
        }));
      }
    }

    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
  }

  // ── Answer emission ──────────────────────────────────────────────────

  private addAnswers(xfTypeInfo: TypeInfo, lsType: LSType): void {
    const choices = this.choiceManager.getChoices(xfTypeInfo.listName!);
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

      this.rowEmitter.emitForEachLanguage((lang) => ({
        class: answerClass,
        name: choiceName,
        relevance: '',
        ...(choice.filter
          ? {
              relevance: `({${this.currentGroup || 'parent'}} == "${choice.filter}")`,
            }
          : {}),
        text: this.languageHandler.renderLabel(choice.label, lang, choiceName),
      }));
    }
  }

  // ── Expression transpilation ─────────────────────────────────────────

  private buildTranspilerContext(): TranspilerContext {
    return {
      lookupAnswerCode: (fieldName: string, choiceValue: string) => {
        return this.choiceManager.lookupAnswerCode(fieldName, choiceValue).code;
      },
      getTruncatedFieldName: (fieldName: string) => {
        return this.fieldSanitizer.resolveStrippedName(fieldName);
      },
      buildSelectedExpr: (fieldName: string, choiceValue: string) => {
        const resolved = this.fieldSanitizer.resolveStrippedName(fieldName);
        const { code } = this.choiceManager.lookupAnswerCode(
          fieldName,
          choiceValue,
        );
        const baseType = this.choiceManager
          .getQuestionBaseTypeMap()
          .get(resolved);
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

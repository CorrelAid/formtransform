import { SurveyRow } from '../../config/types.js';
import { TypeInfo } from './typeMapper.js';
import { RowEmitter } from './rowEmitter.js';
import { LanguageHandler } from './languageHandler.js';
import { ChoiceManager } from './choiceManager.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { Counters } from './counters.js';

export type MatrixCounters = Counters;

export interface MatrixHelpers {
  sanitizeName(name: string): string;
  sanitizeAnswerCode(code: string): string;
  convertRelevance(relevant?: string): Promise<string>;
}

/**
 * Emits LimeSurvey array (F) questions. A "matrix" in XLSForm can be built
 * two ways: a `table-list` group (each select_one child becomes a subquestion)
 * or a `label` + `list-nolabel` pair (one header + N subquestions). Both share
 * the same answer scale, emitted by `flushMatrix` on end_group.
 */
export class MatrixHandler {
  private inMatrix = false;
  private matrixListName: string | null = null;
  // True while inside a `table-list` group emitted as a LimeSurvey array (F):
  // its select_one children become subquestions of one array question.
  private inTableListMatrix = false;

  constructor(
    private configManager: ConfigManager,
    private rowEmitter: RowEmitter,
    private languageHandler: LanguageHandler,
    private choiceManager: ChoiceManager,
    private counters: MatrixCounters,
  ) {}

  clear(): void {
    this.inMatrix = false;
    this.matrixListName = null;
    this.inTableListMatrix = false;
  }

  isInMatrix(): boolean {
    return this.inMatrix;
  }

  isInTableListMatrix(): boolean {
    return this.inTableListMatrix;
  }

  getMatrixListName(): string | null {
    return this.matrixListName;
  }

  setMatrixListName(name: string | null): void {
    this.matrixListName = name;
  }

  /**
   * Open a LimeSurvey array (F) for a `table-list` group. The array title is
   * the group label; its select_one children are added as subquestions and the
   * shared answer scale is emitted by flushMatrix (on end_group). No G row is
   * emitted — the group *is* the array.
   */
  async addTableListHeader(
    row: SurveyRow,
    questionName: string,
    helpers: MatrixHelpers,
  ): Promise<void> {
    this.counters.bumpGroupSeq();
    this.inMatrix = true;
    this.inTableListMatrix = true;
    this.matrixListName = null;
    this.counters.setSubquestionSeq(0);

    const relevance = await helpers.convertRelevance(row.relevant);
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

  async addMatrixHeader(
    row: SurveyRow,
    xfTypeInfo: TypeInfo,
    helpers: MatrixHelpers,
  ): Promise<void> {
    const questionName =
      row.name && row.name.trim() !== ''
        ? helpers.sanitizeName(row.name.trim())
        : `Q${this.counters.getQuestionSeq()}`;

    this.counters.bumpQuestionSeq();
    this.inMatrix = true;
    this.matrixListName = xfTypeInfo.listName;
    this.counters.setSubquestionSeq(0);

    const relevance = await helpers.convertRelevance(row.relevant);
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

  async addMatrixSubquestion(
    row: SurveyRow,
    helpers: MatrixHelpers,
  ): Promise<void> {
    const sqName =
      row.name && row.name.trim() !== ''
        ? helpers.sanitizeName(row.name.trim())
        : `SQ${this.counters.getSubquestionSeq()}`;

    this.counters.bumpSubquestionSeq();
    const relevance = await helpers.convertRelevance(row.relevant);
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

  flushMatrix(helpers: MatrixHelpers): void {
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
            ? helpers.sanitizeAnswerCode(choice.name.trim())
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
}

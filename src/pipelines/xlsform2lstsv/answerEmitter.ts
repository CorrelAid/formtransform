import { TypeInfo, LSType } from './typeMapper.js';
import { RowEmitter } from './rowEmitter.js';
import { LanguageHandler } from './languageHandler.js';
import { ChoiceManager } from './choiceManager.js';
import { GroupEmitter } from './groupEmitter.js';
import { Counters } from './counters.js';
import { deduplicateNames } from '../../utils/helpers.js';
import type { ChoiceRow } from '../../xlsform/types.js';
import { consoleWarning, warning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';

/**
 * The LimeSurvey code of each choice: sanitized, cut to 5 characters, and
 * made unique within the list (`code-duplicate` warning when a suffix is
 * needed). A nameless choice gets `fallback()`. Every list emitter (answers,
 * subquestions, a grid's shared scale) goes through here, so the codes match
 * what ChoiceManager.buildAnswerCodeMap resolves in expressions.
 */
export function answerCodes(
  choices: ChoiceRow[],
  sanitize: (code: string) => string,
  fallback: () => string,
  onWarning: WarningHandler,
  listName?: string,
): string[] {
  const rawNames = choices.map((choice) => {
    const raw = choice.name?.trim() ?? '';
    return raw ? sanitize(raw) : fallback();
  });
  const names = deduplicateNames(rawNames, 5);
  names.forEach((name, i) => {
    if (name !== rawNames[i]) {
      onWarning(
        warning(
          'code-duplicate',
          `Duplicate answer code "${rawNames[i]}" resolved to "${name}"`,
          listName,
        ),
      );
    }
  });
  return names;
}

export interface AnswerHelpers {
  sanitizeAnswerCode(code: string): string;
}

/**
 * Emits A (answer) and SQ (subquestion) rows for a select question.
 * Sanitizes choice names, deduplicates collisions, and honors `filter`
 * (relevance based on the current group).
 */
export class AnswerEmitter {
  private rowEmitter: RowEmitter;
  private languageHandler: LanguageHandler;
  private choiceManager: ChoiceManager;
  private groupEmitter: GroupEmitter;
  private counters: Counters;
  private onWarning: WarningHandler;

  constructor(deps: {
    rowEmitter: RowEmitter;
    languageHandler: LanguageHandler;
    choiceManager: ChoiceManager;
    groupEmitter: GroupEmitter;
    counters: Counters;
    onWarning?: WarningHandler;
  }) {
    this.rowEmitter = deps.rowEmitter;
    this.languageHandler = deps.languageHandler;
    this.choiceManager = deps.choiceManager;
    this.groupEmitter = deps.groupEmitter;
    this.counters = deps.counters;
    this.onWarning = deps.onWarning ?? consoleWarning;
  }

  addAnswers(
    xfTypeInfo: TypeInfo,
    lsType: LSType,
    helpers: AnswerHelpers,
  ): void {
    const choices = this.choiceManager.getChoices(xfTypeInfo.listName!);
    // validateRow already rejected a select whose list has no rows.
    if (!choices) return;

    const answerClass =
      lsType.answerClass ||
      (xfTypeInfo.base === 'select_multiple' ? 'SQ' : 'A');

    const choiceNames = answerCodes(
      choices,
      (code) => helpers.sanitizeAnswerCode(code),
      () =>
        answerClass === 'SQ'
          ? `SQ${this.counters.subquestionSeq++}`
          : `A${this.counters.answerSeq++}`,
      this.onWarning,
      xfTypeInfo.listName ?? undefined,
    );

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const choiceName = choiceNames[i];

      this.rowEmitter.emitForEachLanguage((lang) => ({
        class: answerClass,
        name: choiceName,
        relevance: '',
        ...(choice.filter
          ? {
              relevance: `({${this.groupEmitter.getCurrentGroup() || 'parent'}} == "${choice.filter}")`,
            }
          : {}),
        text: this.languageHandler.renderLabel(choice.label, lang, choiceName),
      }));
    }
  }
}

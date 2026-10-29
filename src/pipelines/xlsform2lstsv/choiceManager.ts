import type { QuestionItem } from '../../instrument/types.js';
import { ChoiceRow } from '../../xlsform/types.js';
import { normalizeName } from '../../xlsform/identifiers.js';
import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { TypeInfo } from './typeMapper.js';
import { deduplicateNames } from '../../utils/helpers.js';

/**
 * Manages choice lists and answer codes for the XLSForm to TSV conversion
 */
export class ChoiceManager {
  private choicesMap = new Map<string, ChoiceRow[]>();
  private answerCodeMap = new Map<string, Map<string, string>>();
  private questionToListMap = new Map<string, string>();
  private questionBaseTypeMap = new Map<string, string>();
  /** Selects with the `or_other` shorthand (LimeSurvey's native other). */
  private orOtherQuestions = new Set<string>();
  /**
   * A question whose LimeSurvey answer codes differ from its list's
   * (convention:choiceFilter `recode`): choice name → code.
   */
  private questionCodes = new Map<string, Map<string, string>>();

  constructor(private fieldSanitizer: FieldSanitizer) {}

  getChoicesMap(): Map<string, ChoiceRow[]> {
    return this.choicesMap;
  }

  getQuestionToListMap(): Map<string, string> {
    return this.questionToListMap;
  }

  getQuestionBaseTypeMap(): Map<string, string> {
    return this.questionBaseTypeMap;
  }

  buildChoicesMap(choices: ChoiceRow[]): void {
    for (const choice of choices) {
      const listName = choice.list_name;
      if (!listName) continue;

      if (!this.choicesMap.has(listName)) {
        this.choicesMap.set(listName, []);
      }
      this.choicesMap.get(listName)!.push(choice);
    }
  }

  addFileChoices(fileChoices: Record<string, ChoiceRow[]>): void {
    for (const [filename, choices] of Object.entries(fileChoices)) {
      this.choicesMap.set(filename, choices);
    }
  }

  buildAnswerCodeMap(sanitizeAnswerCode: (code: string) => string): void {
    this.answerCodeMap = new Map();
    for (const [listName, choices] of this.choicesMap) {
      const codeMap = new Map<string, string>();
      const sanitized = choices.map((c) => {
        const raw = c.name?.trim() || '';
        return raw ? sanitizeAnswerCode(raw) : '';
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

  buildQuestionToListMap(
    questions: QuestionItem[],
    parseType: (type: string) => TypeInfo,
    sanitizeName: (name: string) => string,
  ): void {
    this.questionToListMap = new Map();
    this.questionBaseTypeMap = new Map();
    this.orOtherQuestions = new Set();
    for (const q of questions) {
      const typeInfo = parseType(q.rawType);
      if (typeInfo.listName && q.name) {
        const sanitizedName = sanitizeName(q.name);
        this.questionToListMap.set(sanitizedName, typeInfo.listName);
        this.questionBaseTypeMap.set(sanitizedName, typeInfo.base);
        if (typeInfo.orOther) this.orOtherQuestions.add(sanitizedName);
      }
    }
  }

  /**
   * The answer codes LimeSurvey gets for a select (sanitized, deduplicated,
   * in list order), by its emitted name; `[]` when it is no select.
   */
  answerCodesOf(resolvedName: string): string[] {
    const codeMap = this.codeMapOf(resolvedName);
    return codeMap ? [...codeMap.values()] : [];
  }

  /** Whether the select uses the `or_other` shorthand. */
  hasOrOther(resolvedName: string): boolean {
    return this.orOtherQuestions.has(resolvedName);
  }

  lookupAnswerCode(
    fieldName: string,
    choiceValue: string,
  ): { code: string; listName: string | undefined } {
    const stripped = normalizeName(fieldName);
    const resolved = this.fieldSanitizer.resolveStrippedName(stripped);
    const listName = this.questionToListMap.get(resolved);
    if (!listName) return { code: choiceValue, listName: undefined };
    const codeMap = this.codeMapOf(resolved);
    if (!codeMap) return { code: choiceValue, listName };
    return { code: codeMap.get(choiceValue) ?? choiceValue, listName };
  }

  /**
   * A select's choice name → LimeSurvey answer code, by its emitted name;
   * `undefined` when it is no select.
   */
  codeMapOf(resolvedName: string): ReadonlyMap<string, string> | undefined {
    const own = this.questionCodes.get(resolvedName);
    if (own) return own;
    const listName = this.questionToListMap.get(resolvedName);
    return listName ? this.answerCodeMap.get(listName) : undefined;
  }

  /** Give one question its own answer codes (choice name → code). */
  setQuestionCodes(resolvedName: string, codes: Map<string, string>): void {
    this.questionCodes.set(resolvedName, codes);
  }

  /** The question's own answer codes, if it has any (see setQuestionCodes). */
  questionCodesOf(
    resolvedName: string,
  ): ReadonlyMap<string, string> | undefined {
    return this.questionCodes.get(resolvedName);
  }

  getChoices(listName: string): ChoiceRow[] | undefined {
    return this.choicesMap.get(listName);
  }

  setChoices(listName: string, choices: ChoiceRow[]): void {
    this.choicesMap.set(listName, choices);
  }
}

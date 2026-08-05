import { ChoiceRow, SurveyRow } from '../../config/types.js';
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

  constructor(private fieldSanitizer: FieldSanitizer) {}

  clear(): void {
    this.choicesMap.clear();
    this.answerCodeMap.clear();
    this.questionToListMap.clear();
    this.questionBaseTypeMap.clear();
  }

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
    surveyData: SurveyRow[],
    parseType: (type: string) => TypeInfo,
    sanitizeName: (name: string) => string,
  ): void {
    this.questionToListMap = new Map();
    this.questionBaseTypeMap = new Map();
    for (const row of surveyData) {
      const typeInfo = parseType(row.type || '');
      if (typeInfo.listName && row.name) {
        const sanitizedName = sanitizeName(row.name.trim());
        this.questionToListMap.set(sanitizedName, typeInfo.listName);
        this.questionBaseTypeMap.set(sanitizedName, typeInfo.base);
      }
    }
  }

  lookupAnswerCode(
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

  getChoices(listName: string): ChoiceRow[] | undefined {
    return this.choicesMap.get(listName);
  }

  setChoices(listName: string, choices: ChoiceRow[]): void {
    this.choicesMap.set(listName, choices);
  }
}

import { SurveyRow, ChoiceRow } from '../../xlsform/types.js';
import { TypeInfo } from './typeMapper.js';
import { ChoiceManager } from './choiceManager.js';
import { LanguageHandler } from './languageHandler.js';
import { OTHER_LABELS } from './constants.js';

/**
 * Detects the "X_other" pattern: a follow-up question with relevance
 * `${X} = 'other'` / `selected(${X}, 'other')`. When found, the matching
 * "other" entry is removed from the parent question's choice list to avoid
 * LimeSurvey seeing two "other" options.
 */
export class OtherPatternDetector {
  private readonly otherNames = new Set([
    'other',
    '_other',
    'other_option',
    'other_choice',
  ]);

  constructor(
    private choiceManager: ChoiceManager,
    private languageHandler: LanguageHandler,
  ) {}

  /**
   * Returns true if `currentRow` has a matching "_other" question in `surveyData`.
   * Side effect: removes the "other" choice from the parent's list.
   */
  hasOtherQuestionPattern(
    currentRow: SurveyRow,
    surveyData: SurveyRow[],
    parseType: (type: string) => TypeInfo,
    sanitizeName: (name: string) => string,
  ): boolean {
    const currentName = currentRow.name?.trim();
    if (!currentName) return false;

    const otherQuestionName = `${currentName}_other`;
    const sanitizedCurrentName = sanitizeName(currentName);

    for (const row of surveyData) {
      if (row.name?.trim() !== otherQuestionName || !row.relevant) continue;

      const relevance = row.relevant.trim();
      // Pattern: ${name} = 'other', ${name} == 'other', or selected(${name}, 'other')
      const patterns = [currentName, sanitizedCurrentName].flatMap((n) => [
        new RegExp(`\\$\\{${n}\\}\\s*={1,2}\\s*['"]other['"]`),
        new RegExp(`selected\\(\\s*\\$\\{${n}\\}\\s*,\\s*['"]other['"]\\s*\\)`),
      ]);

      if (patterns.some((p) => p.test(relevance))) {
        const xfTypeInfo = parseType(currentRow.type || '');
        this.removeOtherChoiceFromList(currentRow, xfTypeInfo);
        return true;
      }
    }

    return false;
  }

  private removeOtherChoiceFromList(row: SurveyRow, typeInfo: TypeInfo): void {
    if (!typeInfo.listName) return;

    const choices = this.choiceManager.getChoices(typeInfo.listName);
    if (!choices) return;

    const removed = choices.filter((choice) =>
      this.otherNames.has(choice.name?.trim().toLowerCase() || ''),
    );
    const filteredChoices = choices.filter(
      (choice) => !this.otherNames.has(choice.name?.trim().toLowerCase() || ''),
    );

    if (filteredChoices.length < choices.length) {
      console.log(
        `Removed "other" choice(s) from list "${typeInfo.listName}" for question "${row.name}" when using _other question pattern`,
      );
      this.verifyOtherLabel(removed, row);
      this.choiceManager.setChoices(typeInfo.listName, filteredChoices);
    }
  }

  /**
   * Warn if the collapsed `other` choice's label doesn't match the canonical
   * `convention:other` label for the survey's base language. The DDI round-trip
   * rebuilds this label from the convention, so a mismatch is silently lost.
   */
  private verifyOtherLabel(removed: ChoiceRow[], row: SurveyRow): void {
    const expected = OTHER_LABELS[this.languageHandler.getBaseLanguage()];
    if (!expected) return;
    for (const choice of removed) {
      const label = this.languageHandler.getLanguageSpecificValue(
        choice.label,
        this.languageHandler.getBaseLanguage(),
      );
      if (label && label.trim() && label.trim() !== expected) {
        console.warn(
          `"other" choice label "${label}" on "${row.name}" is not the canonical ${this.languageHandler.getBaseLanguage()} label "${expected}"; the DDI round-trip will use "${expected}".`,
        );
      }
    }
  }
}

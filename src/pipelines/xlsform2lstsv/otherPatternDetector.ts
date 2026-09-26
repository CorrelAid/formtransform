import { SurveyRow, ChoiceRow } from '../../xlsform/types.js';
import { TypeInfo } from './typeMapper.js';
import { ChoiceManager } from './choiceManager.js';
import { LanguageHandler } from './languageHandler.js';
import {
  OTHER_CODE,
  canonicalOtherLabel,
  OTHER_SUFFIX,
} from '../../conventions/other.js';
import { consoleWarning, warning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';

/**
 * Detects the "X_other" pattern: a follow-up question with relevance
 * `${X} = 'other'` / `selected(${X}, 'other')`. When found, the matching
 * "other" entry is removed from the parent question's choice list to avoid
 * LimeSurvey seeing two "other" options, and the companion is not emitted:
 * LimeSurvey's native "other" text box takes its place (#79).
 */
export class OtherPatternDetector {
  constructor(
    private choiceManager: ChoiceManager,
    private languageHandler: LanguageHandler,
    private onWarning: WarningHandler = consoleWarning,
  ) {}

  /**
   * The `<name>_other` companion whose relevance keys on `currentRow`'s
   * "other" choice, or `null`. No side effects.
   */
  companionOf(
    currentRow: SurveyRow,
    surveyData: SurveyRow[],
    sanitizeName: (name: string) => string,
  ): SurveyRow | null {
    const currentName = currentRow.name?.trim();
    if (!currentName) return null;

    const otherQuestionName = `${currentName}${OTHER_SUFFIX}`;
    const sanitizedCurrentName = sanitizeName(currentName);
    // Pattern: ${name} = 'other', ${name} == 'other', or selected(${name}, 'other')
    const code = escapeRegExp(OTHER_CODE);
    const patterns = [currentName, sanitizedCurrentName].flatMap((n) => [
      new RegExp(`\\$\\{${n}\\}\\s*={1,2}\\s*['"]${code}['"]`),
      new RegExp(`selected\\(\\s*\\$\\{${n}\\}\\s*,\\s*['"]${code}['"]\\s*\\)`),
    ]);

    return (
      surveyData.find(
        (row) =>
          row.name?.trim() === otherQuestionName &&
          typeof row.relevant === 'string' &&
          patterns.some((p) => p.test((row.relevant as string).trim())),
      ) ?? null
    );
  }

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
    if (!this.companionOf(currentRow, surveyData, sanitizeName)) return false;
    this.removeOtherChoiceFromList(
      currentRow,
      parseType(currentRow.type || ''),
    );
    return true;
  }

  private removeOtherChoiceFromList(row: SurveyRow, typeInfo: TypeInfo): void {
    if (!typeInfo.listName) return;

    const choices = this.choiceManager.getChoices(typeInfo.listName);
    if (!choices) return;

    const isOther = (choice: ChoiceRow) =>
      (choice.name?.trim().toLowerCase() || '') === OTHER_CODE;
    const removed = choices.filter(isOther);
    const filteredChoices = choices.filter((choice) => !isOther(choice));

    if (filteredChoices.length < choices.length) {
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
    const expected = canonicalOtherLabel(
      this.languageHandler.getBaseLanguage(),
    );
    if (!expected) return;
    for (const choice of removed) {
      const label = this.languageHandler.getLanguageSpecificValue(
        choice.label,
        this.languageHandler.getBaseLanguage(),
      );
      if (label && label.trim() && label.trim() !== expected) {
        this.onWarning(
          warning(
            'other-label-noncanonical',
            `"other" choice label "${label}" on "${row.name}" is not the canonical ${this.languageHandler.getBaseLanguage()} label "${expected}"; the DDI round-trip will use "${expected}".`,
            row.name,
          ),
        );
      }
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

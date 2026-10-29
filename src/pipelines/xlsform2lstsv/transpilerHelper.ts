import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { ChoiceManager } from './choiceManager.js';
import {
  convertRelevanceSync,
  convertConstraintSync,
  convertSelectionConstraintSync,
  TranspilerContext,
} from './xpathTranspiler.js';
import type { SelectionConstraint } from './xpathTranspiler.js';
import { consoleWarning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';
import { OTHER_CODE } from '../../conventions/other.js';
import { countsSelections } from '../../conventions/selectionCount.js';

/**
 * Wraps expression transpilation. The XLSForm XPath/LimeSurvey EM bridge
 * needs a context object that knows how to look up choice codes and
 * truncated field names — those live elsewhere (ChoiceManager and
 * FieldSanitizer) so this class just composes them.
 */
export class TranspilerHelper {
  constructor(
    private fieldSanitizer: FieldSanitizer,
    private choiceManager: ChoiceManager,
    private onWarning: WarningHandler = consoleWarning,
  ) {}

  /**
   * The fields `count-selected()` counts for a select_multiple
   * (convention:logicMapping `selectionCount`): `<q>_<code>` per answer code,
   * plus `<q>_other` for a native other. `null` for any other question.
   */
  private selectionFields(fieldName: string): string[] | null {
    const resolved = this.fieldSanitizer.resolveStrippedName(fieldName);
    const base = this.choiceManager.getQuestionBaseTypeMap().get(resolved);
    if (!base || !countsSelections(base)) return null;
    const codes = this.choiceManager.answerCodesOf(resolved);
    if (this.choiceManager.hasOrOther(resolved) && !codes.includes(OTHER_CODE))
      codes.push(OTHER_CODE);
    return codes.map((code) => `${resolved}_${code}`);
  }

  /** Only what `count-selected()` needs: constraints take no other context. */
  private countContext(selfName?: string): TranspilerContext {
    return {
      selectionFields: (name) => this.selectionFields(name),
      ...(selfName ? { selfName } : {}),
    };
  }

  buildTranspilerContext(): TranspilerContext {
    return {
      selectionFields: (name) => this.selectionFields(name),
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

  convertRelevance(relevant?: string): string {
    if (!relevant) return '1';
    return convertRelevanceSync(relevant, this.buildTranspilerContext());
  }

  /** @param selfName the question's normalized name, what `.` refers to. */
  convertConstraint(constraint: string, selfName?: string): string {
    return convertConstraintSync(
      constraint,
      this.onWarning,
      this.countContext(selfName),
    );
  }

  /**
   * A select_multiple's constraint: count bounds for `min_answers` /
   * `max_answers`, the rest as the validation equation.
   */
  convertSelectionConstraint(
    constraint: string,
    selfName: string,
  ): SelectionConstraint {
    return convertSelectionConstraintSync(
      constraint,
      this.onWarning,
      this.countContext(selfName),
    );
  }
}

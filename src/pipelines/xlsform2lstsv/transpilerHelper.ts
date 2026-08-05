import { FieldSanitizer } from '../../xlsform/sanitize.js';
import { ChoiceManager } from './choiceManager.js';
import {
  convertRelevance,
  convertConstraint,
  xpathToLimeSurvey,
  TranspilerContext,
} from './xpathTranspiler.js';

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
  ) {}

  buildTranspilerContext(): TranspilerContext {
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

  async convertRelevance(relevant?: string): Promise<string> {
    if (!relevant) return '1';
    return await convertRelevance(relevant, this.buildTranspilerContext());
  }

  async convertCalculation(calculation: string): Promise<string> {
    return await xpathToLimeSurvey(calculation, this.buildTranspilerContext());
  }

  async convertConstraint(constraint: string): Promise<string> {
    return await convertConstraint(constraint);
  }
}

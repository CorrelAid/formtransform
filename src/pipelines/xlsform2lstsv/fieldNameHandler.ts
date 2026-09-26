import { SurveyRow } from '../../xlsform/types.js';
import { normalizeName } from '../../xlsform/identifiers.js';
import { FieldSanitizer } from '../../xlsform/sanitize.js';

/**
 * Wraps the fieldSanitizer with the survey-specific naming conventions:
 * - auto-generated names (G0, Q0, …) are resolved against the same
 *   sanitizer so collisions are caught up front
 * - ${var} references in text are rewritten to {sanitizedname} per
 *   LimeSurvey's EM syntax
 */
export class FieldNameHandler {
  constructor(private fieldSanitizer: FieldSanitizer) {}

  /**
   * Pre-scan all survey rows and register every field name with the sanitizer,
   * so that collisions after sanitization + truncation are detected early.
   */
  registerFieldNames(surveyData: SurveyRow[]): void {
    this.fieldSanitizer.resetNames();
    for (const row of surveyData) {
      const type = (row.type || '').trim();
      if (type === 'end_group' || type === 'end_repeat') continue;
      const name = row.name?.trim();
      if (!name) continue;
      this.fieldSanitizer.sanitizeNameUnique(name);
    }
  }

  sanitizeName(name: string): string {
    const stripped = normalizeName(name);
    return this.fieldSanitizer.resolveStrippedName(stripped);
  }

  /** Resolve references to `name` as `target` from now on. */
  aliasName(name: string, target: string): void {
    this.fieldSanitizer.aliasStrippedName(normalizeName(name), target);
  }

  sanitizeAnswerCode(code: string): string {
    return this.fieldSanitizer.sanitizeAnswerCode(code);
  }

  /**
   * Convert ${varname} references in text to LimeSurvey EM syntax {sanitizedname}.
   */
  convertVariableReferences(text: string): string {
    return text.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
      const sanitized = this.sanitizeName(name);
      return `{${sanitized}}`;
    });
  }
}

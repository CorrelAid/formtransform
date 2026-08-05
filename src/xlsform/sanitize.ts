import conventions from '../generated/conventions.json' with { type: 'json' };
import { sanitizeFieldName } from '../utils/helpers.js';

const NAME_RULES = conventions.conventions.sanitization.name;
const CHOICE_RULES = conventions.conventions.sanitization.choiceCode;
const MAX_FIELD_LENGTH = NAME_RULES.maxLength;
const NAME_STRIP_REGEX = new RegExp(NAME_RULES.stripCharsRegex, 'g');
const CHOICE_STRIP_REGEX = new RegExp(CHOICE_RULES.stripCharsRegex, 'g');
const MAX_CHOICE_LENGTH = CHOICE_RULES.maxLength;

export class FieldSanitizer {
  /** Set of unique sanitized names already assigned */
  private usedNames: Set<string> = new Set();
  /**
   * Map from stripped name (underscores/hyphens removed, NOT truncated)
   * to the unique sanitized name (truncated + deduplicated).
   * Used by the transpiler to resolve variable references.
   */
  private strippedToUnique: Map<string, string> = new Map();

  constructor() {}

  /**
   * Basic sanitization: remove underscores/hyphens and truncate to 20 chars.
   * Does NOT check for duplicates. Use sanitizeNameUnique for that.
   */
  sanitizeName(name: string): string {
    return sanitizeFieldName(name);
  }

  /**
   * Sanitize a field name and ensure it is unique among all previously
   * registered names. If a collision is detected after sanitization,
   * a numeric suffix is appended (e.g. "fieldname1").
   */
  sanitizeNameUnique(name: string): string {
    const stripped = name.replace(NAME_STRIP_REGEX, '');
    const truncated =
      stripped.length > MAX_FIELD_LENGTH
        ? stripped.substring(0, MAX_FIELD_LENGTH)
        : stripped;

    if (!this.usedNames.has(truncated)) {
      this.usedNames.add(truncated);
      this.strippedToUnique.set(stripped, truncated);
      return truncated;
    }

    // Collision detected — append a numeric suffix
    let counter = 1;
    let candidate: string;
    do {
      const suffix = String(counter);
      candidate =
        truncated.substring(0, MAX_FIELD_LENGTH - suffix.length) + suffix;
      counter++;
    } while (this.usedNames.has(candidate));

    this.usedNames.add(candidate);
    this.strippedToUnique.set(stripped, candidate);
    console.warn(
      `Field name "${name}" collides with an existing name after sanitization; renamed to "${candidate}"`,
    );
    return candidate;
  }

  /**
   * Resolve a stripped field name (underscores already removed, not truncated)
   * to its unique sanitized name. Falls back to simple truncation if the name
   * was never registered.
   */
  resolveStrippedName(strippedName: string): string {
    const mapped = this.strippedToUnique.get(strippedName);
    if (mapped) return mapped;
    // Fallback: truncate like normal (name was never registered)
    return strippedName.length > MAX_FIELD_LENGTH
      ? strippedName.substring(0, MAX_FIELD_LENGTH)
      : strippedName;
  }

  /**
   * Clear all registered names. Must be called at the start of each conversion.
   */
  resetNames(): void {
    this.usedNames.clear();
    this.strippedToUnique.clear();
  }

  sanitizeAnswerCode(code: string): string {
    const result = code.replace(CHOICE_STRIP_REGEX, '');

    const maxLength = MAX_CHOICE_LENGTH;
    if (result.length > maxLength) {
      const truncated = result.substring(0, maxLength);
      console.warn(
        `Answer code "${code}" exceeds maximum length of ${maxLength} characters and will be truncated to "${truncated}"`,
      );
      return truncated;
    }

    return result;
  }
}

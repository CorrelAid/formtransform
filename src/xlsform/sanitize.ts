import conventions from '../generated/conventions.js';

import { normalizeCode, normalizeName } from './identifiers.js';
import { ConversionError, consoleWarning, warning } from '../diagnostics.js';
import type { DiagnosticCode, WarningHandler } from '../diagnostics.js';

const NAME_RULES = conventions.conventions.sanitization.name;
const CHOICE_RULES = conventions.conventions.sanitization.choiceCode;
const MAX_FIELD_LENGTH = NAME_RULES.maxLength;
const MAX_CHOICE_LENGTH = CHOICE_RULES.maxLength;

/** Normalize, refusing input that leaves nothing LimeSurvey can use. */
function normalizeOrThrow(
  value: string,
  normalize: (s: string) => string,
  what: string,
  code: DiagnosticCode,
): string {
  const out = normalize(value);
  if (out === '') {
    throw new ConversionError(
      code,
      `${what} "${value}" has no letters or digits left after sanitization (${NAME_RULES.pattern})`,
      { subject: value },
    );
  }
  return out;
}

export class FieldSanitizer {
  /** Set of unique sanitized names already assigned */
  private usedNames: Set<string> = new Set();
  /**
   * Map from stripped name (normalized per convention:sanitization, NOT truncated)
   * to the unique sanitized name (truncated + deduplicated).
   * Used by the transpiler to resolve variable references.
   */
  private strippedToUnique: Map<string, string> = new Map();

  /** @param onWarning receives truncation and collision notices (default: console). */
  constructor(private readonly onWarning: WarningHandler = consoleWarning) {}

  /**
   * Basic sanitization: transliterate, strip everything outside
   * `[a-zA-Z0-9]`, truncate to 20 chars. Does NOT check for duplicates; use
   * sanitizeNameUnique for that. Throws when nothing usable is left.
   */
  sanitizeName(name: string): string {
    const result = normalizeOrThrow(
      name,
      normalizeName,
      'Field name',
      'name-empty-after-sanitize',
    );
    if (result.length > MAX_FIELD_LENGTH) {
      const truncated = result.substring(0, MAX_FIELD_LENGTH);
      this.onWarning(
        warning(
          'name-truncated',
          `Field name "${name}" exceeds maximum length of ${MAX_FIELD_LENGTH} characters and will be truncated to "${truncated}"`,
          name,
        ),
      );
      return truncated;
    }
    return result;
  }

  /**
   * Sanitize a field name and ensure it is unique among all previously
   * registered names. If a collision is detected after sanitization,
   * a numeric suffix is appended (e.g. "fieldname1").
   */
  sanitizeNameUnique(name: string): string {
    const stripped = normalizeOrThrow(
      name,
      normalizeName,
      'Field name',
      'name-empty-after-sanitize',
    );
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
    this.onWarning(
      warning(
        'name-collision',
        `Field name "${name}" collides with an existing name after sanitization; renamed to "${candidate}"`,
        name,
      ),
    );
    return candidate;
  }

  /**
   * Resolve a stripped field name (already normalized, not truncated)
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
    const result = normalizeOrThrow(
      code,
      normalizeCode,
      'Answer code',
      'code-empty-after-sanitize',
    );

    const maxLength = MAX_CHOICE_LENGTH;
    if (result.length > maxLength) {
      const truncated = result.substring(0, maxLength);
      this.onWarning(
        warning(
          'code-truncated',
          `Answer code "${code}" exceeds maximum length of ${maxLength} characters and will be truncated to "${truncated}"`,
        ),
      );
      return truncated;
    }

    return result;
  }
}

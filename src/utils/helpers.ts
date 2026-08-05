import conventions from '../generated/conventions.json' with { type: 'json' };

const NAME_RULES = conventions.conventions.sanitization.name;
const NAME_STRIP_REGEX = new RegExp(NAME_RULES.stripCharsRegex, 'g');

/**
 * Deep merge objects - merges properties from source into target recursively
 */
export function deepMerge<T extends object>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;

  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          target[key] = {} as T[Extract<keyof T, string>];
        }
        deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        target[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }

  return deepMerge(target, ...sources);
}

function isObject(item: unknown): item is object {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Deduplicate a list of names by appending numeric suffixes on collision.
 * Returns a new array with unique names, preserving order.
 */
export function deduplicateNames(names: string[], maxLength: number): string[] {
  const result = [...names];
  const used = new Set<string>();
  for (let i = 0; i < result.length; i++) {
    if (!result[i]) continue;
    const name = result[i];
    if (used.has(name)) {
      let counter = 1;
      let candidate: string;
      do {
        const suffix = String(counter);
        candidate = name.substring(0, maxLength - suffix.length) + suffix;
        counter++;
      } while (used.has(candidate));
      result[i] = candidate;
    }
    used.add(result[i]);
  }
  return result;
}

/**
 * Sanitize field names for LimeSurvey compatibility per registry conventions.
 */
export function sanitizeFieldName(name: string): string {
  const result = name.replace(NAME_STRIP_REGEX, '');

  const maxLength = NAME_RULES.maxLength;
  if (result.length > maxLength) {
    const truncated = result.substring(0, maxLength);
    console.warn(
      `Field name "${name}" exceeds maximum length of ${maxLength} characters and will be truncated to "${truncated}"`,
    );
    return truncated;
  }

  return result;
}

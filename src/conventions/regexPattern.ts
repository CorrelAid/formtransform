/**
 * Regex pattern conversion between ODK `regex()` and LimeSurvey's
 * `regexMatch(pattern, input)` (convention:logicMapping syntaxMappings).
 *
 * ODK matches the whole string; LimeSurvey's PHP `preg_match` and JS
 * `RegExp.test` search anywhere in it, and need a delimited pattern
 * (`/pat/`). Forward therefore anchors (`^(?:pat)$`, skipped when `pat`
 * already is) and escapes `/`; reverse undoes exactly that.
 */

/** Does `p` start with `^` and end with an unescaped `$`, with no `|`? */
function isAnchored(p: string): boolean {
  if (!p.startsWith('^') || !p.endsWith('$') || p.includes('|')) return false;
  const slashes = /\\*\$$/.exec(p)?.[0].length ?? 1;
  return (slashes - 1) % 2 === 0;
}

/** Escape every `/` not already escaped. */
function escapeSlashes(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '\\' && i + 1 < p.length) out += p[i] + p[++i];
    else out += p[i] === '/' ? '\\/' : p[i];
  }
  return out;
}

/** The body of an ODK regex as the text LimeSurvey gets (delimiters included). */
export function odkPatternToLs(pattern: string): string {
  const body = isAnchored(pattern) ? pattern : `^(?:${pattern})$`;
  return `/${escapeSlashes(body)}/`;
}

/** Already `/…/flags`? (EM-flavoured source written by the author.) */
export function isDelimited(pattern: string): boolean {
  return /^\/.*\/[a-z]*$/s.test(pattern);
}

/** Delimit a pattern without changing its meaning (no anchoring). */
export function delimitPattern(pattern: string): string {
  return isDelimited(pattern) ? pattern : `/${escapeSlashes(pattern)}/`;
}

/**
 * LimeSurvey `/pat/` → the ODK pattern. Flags other than none cannot be
 * expressed in ODK and are kept in the delimiter form (returns null).
 */
export function lsPatternToOdk(pattern: string): string | null {
  const m = /^\/(.*)\/$/s.exec(pattern);
  if (!m) return null;
  const body = m[1].replace(/\\\//g, '/');
  const inner = /^\^\(\?:(.*)\)\$$/s.exec(body)?.[1];
  return inner !== undefined && groupsBalance(inner) ? inner : body;
}

/** Do the parentheses in `p` never close a group they did not open? */
function groupsBalance(p: string): boolean {
  let depth = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '\\') i++;
    else if (p[i] === '(') depth++;
    else if (p[i] === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

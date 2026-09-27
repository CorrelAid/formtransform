/** The XLSForm `parameters` cell. */

/** Parse `key=value` pairs separated by spaces, commas or semicolons. */
export function parseParameters(cell: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof cell !== 'string' && typeof cell !== 'number') return out;
  for (const token of String(cell).split(/[\s,;]+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    out[token.slice(0, eq).trim().toLowerCase()] = token.slice(eq + 1).trim();
  }
  return out;
}

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

/**
 * `parameters` without a `guidance_hint=<text>` pyxform rejects: one whose
 * text has whitespace, which qwacback's old DDI → XLSForm export wrote
 * (`guidance_hint=Only once`). pyxform reads the cell as space-separated
 * `key=value` pairs, so the hint belongs in the `guidance_hint` column.
 * `moved` says whether one was taken out.
 */
export function withoutSpacedGuidance(parameters: string): {
  parameters: string;
  moved: boolean;
} {
  const parts = parameters.split(';');
  const kept = parts.filter((part) => {
    const m = /^\s*guidance_hint\s*=(.*)$/.exec(part);
    return !m || !/\s/.test(m[1].trim());
  });
  return kept.length === parts.length
    ? { parameters, moved: false }
    : { parameters: kept.join(';').trim(), moved: true };
}

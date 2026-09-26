/**
 * LimeSurvey question codes → XLSForm types, from the registry (the reverse of
 * TYPE_MAPPINGS). Shared by the LimeSurvey parsers: the Instrument's and
 * lstsv2xlsform's.
 */
import { APPEARANCES } from '../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';

type Row = Record<string, string>;

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

// ── Registry-derived reverse type maps ──────────────────────────────────

/** LS `D` question → XLSForm type, keyed by its `dateFormat` hint (`''` = none). */
const DATE_TYPE_BY_FORMAT: Record<string, string> = {};
for (const [xfType, m] of Object.entries(TYPE_MAPPINGS)) {
  if (m.limeSurveyType === 'D')
    DATE_TYPE_BY_FORMAT[m.dateFormat ?? ''] = xfType;
}

/** Canonical XLSForm type for a LimeSurvey code with more than one alias. */
function canonicalTypeFor(lsCode: string): string {
  const candidates = Object.entries(TYPE_MAPPINGS)
    .filter(([, m]) => m.limeSurveyType === lsCode)
    .map(([k]) => k);
  // Prefer the modern/canonical spelling over legacy aliases (string→text,
  // int→integer); N (integer vs decimal) has no signal at all — decimal wins.
  return (
    candidates.find((c) => c === 'text' || c === 'decimal') ??
    candidates[0] ??
    'text'
  );
}
export const CANONICAL_TEXT_TYPE = canonicalTypeFor('S');

/** Types that write their XLSForm `parameters` into LS attributes (`range`). */
const PARAMETERIZED_TYPES = Object.entries(TYPE_MAPPINGS).filter(
  ([, m]) => m.parameterAttributes,
);

/**
 * The parameterized type whose LS attributes this row carries, with its
 * `parameters` cell rebuilt. `step` isn't stored: the integer-only flag means
 * a whole step (written as 1), otherwise it's left to the default.
 */
function resolveParameterized(
  lsCode: string,
  row: Row,
): ResolvedType | undefined {
  for (const [xfType, m] of PARAMETERIZED_TYPES) {
    if (m.limeSurveyType !== lsCode) continue;
    const attrs = Object.entries(m.parameterAttributes ?? {});
    if (!attrs.every(([, attr]) => cell(row, attr) !== '')) continue;
    const params = attrs.map(([key, attr]) => `${key}=${cell(row, attr)}`);
    const intOnly = m.integerOnly;
    if (intOnly && cell(row, intOnly.attribute) === '1') {
      for (const key of intOnly.whenWhole) {
        if (!m.parameterAttributes?.[key]) params.push(`${key}=1`);
      }
    }
    return { base: xfType, parameters: params.join(' ') };
  }
  return undefined;
}
const CANONICAL_NUMERIC_TYPE = canonicalTypeFor('N');

/** Appearance name → LS type-override code it produces (e.g. `minimal` → `!`). */
const APPEARANCE_BY_OVERRIDE: Record<string, string> = {};
for (const [name, spec] of Object.entries(APPEARANCES)) {
  if (spec.lsTypeOverride) APPEARANCE_BY_OVERRIDE[spec.lsTypeOverride] = name;
}

export interface ResolvedType {
  base: string;
  appearance?: string;
  parameters?: string;
}

/** Resolve a Q-row's `type/scale` (+ attribute hints) to an XLSForm type. */
export function resolveType(lsCode: string, row: Row): ResolvedType {
  const dateFormat = cell(row, 'date_format');
  const overrideAppearance = APPEARANCE_BY_OVERRIDE[lsCode];
  if (overrideAppearance) {
    const spec = APPEARANCES[overrideAppearance];
    return {
      base: spec.validForTypes?.[0] ?? CANONICAL_TEXT_TYPE,
      appearance: overrideAppearance,
    };
  }
  switch (lsCode) {
    case 'L':
      return { base: 'select_one' };
    case 'M':
      return { base: 'select_multiple' };
    case 'N':
      return (
        resolveParameterized(lsCode, row) ?? { base: CANONICAL_NUMERIC_TYPE }
      );
    case 'D':
      return {
        base:
          DATE_TYPE_BY_FORMAT[dateFormat] ?? DATE_TYPE_BY_FORMAT[''] ?? 'date',
      };
    case 'X':
      return { base: 'note' };
    default:
      return { base: CANONICAL_TEXT_TYPE };
  }
}

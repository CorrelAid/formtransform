/**
 * XLSForm `parameters` column → LimeSurvey question attributes, driven by the
 * registry (`xlsform.parameters`, `limesurvey.parameterAttributes`,
 * `limesurvey.integerOnly`). Used by `range`: `start=0 end=100 step=5` becomes
 * `min_num_value_n=0`, `max_num_value_n=100`, `num_value_int_only=1`.
 */
import { TYPE_MAPPINGS } from '../../generated/TypeMappings.js';
import { ConversionError } from '../../diagnostics.js';

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

const isNumber = (v: string) => v !== '' && Number.isFinite(Number(v));

/**
 * The LimeSurvey attributes a row's `parameters` produce for its type, or `{}`
 * when the type declares none. Throws when a declared parameter isn't a number:
 * LimeSurvey would otherwise import a question without its bounds.
 */
export function parameterAttributes(
  baseType: string,
  cell: unknown,
  questionName: string,
): Record<string, string> {
  const mapping = TYPE_MAPPINGS[baseType];
  if (!mapping?.parameters) return {};

  const values = { ...mapping.parameters, ...parseParameters(cell) };
  for (const key of Object.keys(mapping.parameters)) {
    if (!isNumber(values[key])) {
      throw new ConversionError(
        'parameter-invalid',
        `${baseType} '${questionName}': parameter ${key}=${values[key]} is not a number`,
      );
    }
  }

  const attrs: Record<string, string> = {};
  for (const [key, attr] of Object.entries(mapping.parameterAttributes ?? {})) {
    attrs[attr] = String(Number(values[key]));
  }
  const intOnly = mapping.integerOnly;
  if (intOnly?.whenWhole.every((k) => Number.isInteger(Number(values[k])))) {
    attrs[intOnly.attribute] = '1';
  }
  return attrs;
}

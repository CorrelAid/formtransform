/**
 * XLSForm `parameters` column → LimeSurvey question attributes, driven by the
 * registry (`xlsform.parameters`, `limesurvey.parameterAttributes`,
 * `limesurvey.integerOnly`). Used by `range`: `start=0 end=100 step=5` becomes
 * `min_num_value_n=0`, `max_num_value_n=100`, `num_value_int_only=1`.
 */
import { TYPE_MAPPINGS } from '../../generated/TypeMappings.js';
import { ConversionError } from '../../diagnostics.js';
import { parseParameters } from '../../utils/parameters.js';

export { parseParameters };

/** ODK allows a descending range (start > end); LimeSurvey only has bounds. */
function ascending(values: Record<string, string>): void {
  if (!('start' in values && 'end' in values)) return;
  const [lo, hi] = [Number(values.start), Number(values.end)].sort(
    (a, b) => a - b,
  );
  values.start = String(lo);
  values.end = String(hi);
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
  // An integer is LimeSurvey's numeric question accepting whole numbers only.
  if (mapping?.integerOnly && !mapping.parameters) {
    return { [mapping.integerOnly.attribute]: '1' };
  }
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

  // ODK requires a non-zero step; LimeSurvey has no step to carry it.
  if ('step' in values && Number(values.step) === 0) {
    throw new ConversionError(
      'parameter-invalid',
      `${baseType} '${questionName}': step must not be 0`,
    );
  }
  ascending(values);

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

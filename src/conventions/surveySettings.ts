/**
 * `convention:surveySettings` (`limesurveySettings`, #228): LimeSurvey survey
 * settings set from optional settings-sheet columns `limesurvey_<setting>`.
 * Each becomes an `S <setting>` row of the TSV; LimeSurvey's TSV import
 * writes it into the survey. ODK and Kobo ignore the columns.
 */
import conventions from '../generated/conventions.js';
import { warning, type WarningHandler } from '../diagnostics.js';

const RULE = conventions.conventions.surveySettings.limesurveySettings;

interface SettingSpec {
  values?: readonly string[];
  pattern?: string;
  label: string;
}

/** The settings-sheet column prefix (`limesurvey_`). */
export const LIMESURVEY_SETTING_PREFIX: string = RULE.prefix;

const SETTINGS: Readonly<Record<string, SettingSpec>> = RULE.settings;
const DERIVED: Readonly<Record<string, string>> = RULE.derived;
/** What formtransform writes when the form sets nothing (`shownoanswer=N`, `allowprev=Y`, `showxquestions=N`). */
export const LIMESURVEY_SETTING_DEFAULTS: Readonly<Record<string, string>> =
  RULE.defaults;
const TRUE_VALUES = new Set<string>(RULE.trueValues);
const FALSE_VALUES = new Set<string>(RULE.falseValues);

/** A value as LimeSurvey stores it, or undefined when it isn't allowed. */
function normalize(spec: SettingSpec, raw: string): string | undefined {
  if (spec.pattern) {
    return new RegExp(spec.pattern).test(raw) ? raw : undefined;
  }
  const values = spec.values ?? [];
  const lower = raw.toLowerCase();
  const yesNo = values.includes('Y') && values.includes('N');
  if (yesNo && TRUE_VALUES.has(lower)) return 'Y';
  if (yesNo && FALSE_VALUES.has(lower)) return 'N';
  return values.find((v) => v.toLowerCase() === lower);
}

/**
 * The form's `limesurvey_<setting>` columns as LimeSurvey settings, in column
 * order. An unknown or derived setting, or a value outside its list, is
 * dropped with a `setting-invalid` warning. An empty cell is no setting.
 */
export function limesurveySettingsOf(
  settings: Record<string, unknown>,
  onWarning: WarningHandler,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [column, cell] of Object.entries(settings)) {
    if (!column.startsWith(LIMESURVEY_SETTING_PREFIX)) continue;
    if (cell === undefined || cell === null || cell === '') continue;
    const name = column.slice(LIMESURVEY_SETTING_PREFIX.length);
    const drop = (why: string) =>
      onWarning(
        warning('setting-invalid', `settings column "${column}": ${why}`),
      );
    if (DERIVED[name] !== undefined) {
      drop(`"${name}" is set from the form (${DERIVED[name]}); dropped`);
      continue;
    }
    const spec = SETTINGS[name];
    if (!spec) {
      drop(
        `"${name}" is not a supported LimeSurvey survey setting (supported: ${Object.keys(SETTINGS).join(', ')}); dropped`,
      );
      continue;
    }
    const raw =
      typeof cell === 'string' || typeof cell === 'number'
        ? String(cell).trim()
        : '';
    const value = raw ? normalize(spec, raw) : undefined;
    if (value === undefined) {
      const allowed = spec.values
        ? spec.values.join(', ')
        : `matching ${spec.pattern}`;
      drop(
        `${JSON.stringify(typeof cell === 'object' ? cell : raw)} is not a valid value (allowed: ${allowed}); dropped`,
      );
      continue;
    }
    out.set(name, value);
  }
  return out;
}

/**
 * The way back: a TSV's `S` rows as `limesurvey_<setting>` columns. Only the
 * supported settings with a valid value, and not a value formtransform writes
 * by default (`LIMESURVEY_SETTING_DEFAULTS`), so a converted form comes back as authored.
 */
export function limesurveySettingColumns(
  sRows: readonly { name: string; text: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, text } of sRows) {
    const spec = SETTINGS[name];
    if (!spec || DERIVED[name] !== undefined) continue;
    const value = normalize(spec, text.trim());
    if (value === undefined) continue;
    if (LIMESURVEY_SETTING_DEFAULTS[name] === value) continue;
    out[`${LIMESURVEY_SETTING_PREFIX}${name}`] = value;
  }
  return out;
}

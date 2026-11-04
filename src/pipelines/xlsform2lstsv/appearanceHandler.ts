import { APPEARANCES } from '../../generated/Appearances.js';
import type { AppearanceSpec } from '../../generated/Appearances.js';
import { QUESTION_THEME_COLUMN } from '../../conventions/questionTheme.js';
import { LSType } from './typeMapper.js';
import { consoleWarning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';
import { XLSValidator } from '../../xlsform/validate.js';

/**
 * Surfaces appearance-attribute handling: validates against the registry
 * allowlist and applies any type overrides the registry declares.
 */
export class AppearanceHandler {
  /** @param onWarning receives ignored-appearance notices (default: console). */
  constructor(private readonly onWarning: WarningHandler = consoleWarning) {}

  /**
   * Warn on appearances that aren't in the registry allowlist, or are
   * registered but not valid for this question type.
   */
  warnUnsupported(
    rowName: string | undefined,
    appearance: string,
    base: string,
  ): void {
    if (!appearance) return;
    // The validator's check; `base` is the emitted type (a from_file select
    // is already its base select here).
    for (const found of XLSValidator.appearanceDiagnostics({
      type: base,
      name: rowName,
      appearance,
    })) {
      this.onWarning(found);
    }
  }

  /**
   * Apply appearance-based type overrides (driven by registry APPEARANCES).
   * Mutates `lsType.type` in place.
   */
  applyTypeOverrides(lsType: LSType, appearance: string, base: string): void {
    for (const spec of applicable(appearance, base)) {
      if (spec.lsTypeOverride) lsType.type = spec.lsTypeOverride;
    }
  }

  /**
   * The Q-row columns of the LimeSurvey question theme an appearance selects
   * (registry `lsQuestionTheme`): `question_theme_name` plus the theme's
   * attributes, e.g. `autocomplete` → `bootstrap_dropdown` + `show_search`.
   * The last appearance with a theme wins, as with type overrides.
   */
  themeAttributes(appearance: string, base: string): Record<string, string> {
    let columns: Record<string, string> = {};
    for (const spec of applicable(appearance, base)) {
      const theme = spec.lsQuestionTheme;
      if (!theme) continue;
      columns = {
        [QUESTION_THEME_COLUMN]: theme.name,
        ...(theme.attributes ?? {}),
      };
    }
    return columns;
  }
}

/** The registered appearances in `appearance` that are valid on `base`. */
function applicable(appearance: string, base: string): AppearanceSpec[] {
  if (!appearance) return [];
  return appearance
    .split(/\s+/)
    .map((part) => APPEARANCES[part])
    .filter(
      (spec): spec is AppearanceSpec =>
        !!spec && (!spec.validForTypes || spec.validForTypes.includes(base)),
    );
}

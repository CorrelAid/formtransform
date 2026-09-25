import { APPEARANCES } from '../../generated/Appearances.js';
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
    if (!appearance) return;
    for (const part of appearance.split(/\s+/)) {
      const spec = APPEARANCES[part];
      if (!spec?.lsTypeOverride) continue;
      if (!spec.validForTypes || spec.validForTypes.includes(base)) {
        lsType.type = spec.lsTypeOverride;
      }
    }
  }
}

import { APPEARANCES } from '../../generated/Appearances.js';
import { LSType, TypeInfo } from './typeMapper.js';

/**
 * Surfaces appearance-attribute handling: validates against the registry
 * allowlist and applies any type overrides the registry declares.
 */
export class AppearanceHandler {
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
    for (const part of appearance.split(/\s+/)) {
      const spec = APPEARANCES[part];
      const isUnsupported =
        !spec || (spec.validForTypes && !spec.validForTypes.includes(base));
      if (isUnsupported) {
        console.warn(
          `Unsupported appearance "${part}" on question "${rowName}" will be ignored`,
        );
      }
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

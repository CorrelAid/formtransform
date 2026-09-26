import { isValidLanguageCode } from '../utils/languageUtils.js';
import { deepMerge } from '../utils/helpers.js';

import { defaultConfig, LstsvConfig } from './types.js';
import { ConversionError } from '../diagnostics.js';

const REPEAT_MODES = ['warn', 'error', 'ignore'];

/**
 * Merge a partial config over the defaults and validate it, in one step. The
 * result is frozen: a conversion reads its options, it never changes them.
 */
export function resolveConfig(
  partial: Partial<LstsvConfig> = {},
): Readonly<LstsvConfig> {
  const config = deepMerge(structuredClone(defaultConfig), partial);

  if (config.handleRepeats && !REPEAT_MODES.includes(config.handleRepeats)) {
    throw new ConversionError(
      'config-invalid',
      `Invalid handleRepeats option: ${config.handleRepeats}`,
    );
  }
  if (!isValidLanguageCode(config.defaults.language)) {
    throw new ConversionError(
      'config-invalid',
      `defaults.language must be a BCP 47 language tag (e.g. "de", "fr-BE"), got "${config.defaults.language}"`,
    );
  }

  return Object.freeze(config);
}

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
  // The whole xlsform2lstsv pipeline handles 2-letter codes only
  // (isValidLanguageCode), although convention:languageTagging allows BCP 47
  // tags such as fr-BE; tracked separately.
  if (!config.defaults.language || config.defaults.language.length !== 2) {
    throw new ConversionError(
      'config-invalid',
      'defaults.language must be a 2-character language code',
    );
  }

  return Object.freeze(config);
}

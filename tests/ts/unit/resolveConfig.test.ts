/** resolveConfig merges over the defaults, validates, and freezes (#64). */
import { describe, test, expect } from 'vitest';

import { resolveConfig, defaultConfig } from '../../../src/index.js';

describe('resolveConfig', () => {
  test('merges nested options over the defaults', () => {
    const c = resolveConfig({
      hideNoAnswer: false,
      defaults: { language: 'de' } as never,
    });
    expect(c.hideNoAnswer).toBe(false);
    expect(c.defaults.language).toBe('de');
    expect(c.defaults.groupName).toBe(defaultConfig.defaults.groupName);
  });

  test('returns a frozen object and leaves the defaults untouched', () => {
    const c = resolveConfig();
    expect(Object.isFrozen(c)).toBe(true);
    expect(c).not.toBe(defaultConfig);
  });

  test('rejects invalid options', () => {
    expect(() => resolveConfig({ handleRepeats: 'skip' as never })).toThrow(
      /handleRepeats/,
    );
    expect(() =>
      resolveConfig({ defaults: { language: 'deu' } as never }),
    ).toThrow(/BCP 47/);
    expect(
      resolveConfig({ defaults: { language: 'fr-BE' } as never }).defaults
        .language,
    ).toBe('fr-BE');
  });
});

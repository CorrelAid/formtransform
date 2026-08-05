import { deepMerge } from '../utils/helpers.js';

import { ConversionConfig, defaultConfig } from './types.js';

export { ConversionConfig } from './types.js';

export class ConfigManager {
  private config: ConversionConfig;

  constructor(config?: Partial<ConversionConfig>) {
    this.config = this.mergeConfig(config || {});
  }

  private mergeConfig(
    partialConfig: Partial<ConversionConfig>,
  ): ConversionConfig {
    return deepMerge(structuredClone(defaultConfig), partialConfig);
  }

  getConfig(): ConversionConfig {
    return this.config;
  }

  getDefaults(): ConversionConfig['defaults'] {
    return this.config.defaults;
  }

  getAdvancedOptions() {
    return {
      autoCreateGroups: true, // Always auto-create groups (hardcoded)
      handleRepeats: this.config.handleRepeats ?? 'warn',
      debugLogging: this.config.debugLogging ?? false,
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(partialConfig: Partial<ConversionConfig>): void {
    this.config = this.mergeConfig(partialConfig);
  }

  /**
   * Validate configuration
   */
  validateConfig(): void {
    const { defaults } = this.config;

    // Validate handleRepeats if provided
    if (
      this.config.handleRepeats &&
      !['warn', 'error', 'ignore'].includes(this.config.handleRepeats)
    ) {
      throw new Error(
        `Invalid handleRepeats option: ${this.config.handleRepeats}`,
      );
    }

    // Validate defaults
    if (!defaults.language || defaults.language.length !== 2) {
      throw new Error('defaults.language must be a 2-character language code');
    }
  }
}

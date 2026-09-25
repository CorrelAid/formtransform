import { resolveConfig } from './resolveConfig.js';
import { LstsvConfig } from './types.js';

export { ConversionConfig } from './types.js';

/**
 * @deprecated Use {@link resolveConfig}. Kept as a thin wrapper so existing
 * consumers keep working; it will go with the public-API cleanup.
 */
export class ConfigManager {
  private config: Readonly<LstsvConfig>;

  constructor(config?: Partial<LstsvConfig>) {
    this.config = resolveConfig(config);
  }

  getConfig(): Readonly<LstsvConfig> {
    return this.config;
  }

  getDefaults(): LstsvConfig['defaults'] {
    return this.config.defaults;
  }

  /** Replaces the options: `partialConfig` merged over the defaults (as before). */
  updateConfig(partialConfig: Partial<LstsvConfig>): void {
    this.config = resolveConfig(partialConfig);
  }

  /** Validation now happens in {@link resolveConfig}; kept for compatibility. */
  validateConfig(): void {
    resolveConfig(this.config);
  }
}

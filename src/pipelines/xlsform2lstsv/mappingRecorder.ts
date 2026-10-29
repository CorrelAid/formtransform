import type { ChoiceRow } from '../../xlsform/types.js';
import { emptyMapping } from '../../conventions/lstsvMapping.js';
import type { LstsvMapping } from '../../conventions/lstsvMapping.js';

/**
 * Collects how one conversion renamed the form for LimeSurvey
 * (convention:lstsvMapping): each name and answer code it emitted differently
 * from the XLSForm.
 */
export class MappingRecorder {
  private readonly mapping = emptyMapping();

  /** A question, grid row or grid emitted as `lsName`. */
  name(lsName: string, original: string): void {
    if (lsName && original && lsName !== original) {
      this.mapping.names[lsName] = original;
    }
  }

  /** The answer codes `owner` (a question or grid) got for `choices`. */
  codes(owner: string, choices: readonly ChoiceRow[], codes: string[]): void {
    const changed: Record<string, string> = {};
    choices.forEach((choice, i) => {
      const original = String(choice.name ?? '').trim();
      if (original && codes[i] && codes[i] !== original) {
        changed[codes[i]] = original;
      }
    });
    if (Object.keys(changed).length > 0) this.mapping.codes[owner] = changed;
  }

  result(): LstsvMapping {
    return {
      ...this.mapping,
      names: { ...this.mapping.names },
      codes: { ...this.mapping.codes },
    };
  }
}

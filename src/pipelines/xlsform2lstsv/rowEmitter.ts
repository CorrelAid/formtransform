import { TSVGenerator } from '../../lstsv/serialize.js';
import { TSVRowData } from './constants.js';
import { LanguageHandler } from './languageHandler.js';

/**
 * Builds, buffers, and flushes TSV rows. Handles the language-grouped row
 * emission pattern needed by LimeSurvey's TSV importer (qseq reset).
 */
export class RowEmitter {
  private buffer: TSVRowData[] = [];

  constructor(
    private tsvGenerator: TSVGenerator,
    private languageHandler: LanguageHandler,
  ) {}

  /**
   * Build a TSVRowData with sensible defaults. Only `class` and `name` are required;
   * all other fields default to empty strings (relevance defaults to '1').
   */
  row(
    fields: Partial<TSVRowData> & Pick<TSVRowData, 'class' | 'name'>,
  ): TSVRowData {
    const row: TSVRowData = {
      'type/scale': '',
      relevance: '1',
      text: '',
      help: '',
      language: this.languageHandler.getBaseLanguage(),
      validation: '',
      em_validation_q: '',
      mandatory: '',
      other: '',
      default: '',
      same_default: '',
      ...fields,
    };
    // Rows are built with XLSForm tags; the TSV carries LimeSurvey codes.
    return { ...row, language: this.languageHandler.toLs(row.language) };
  }

  /**
   * Emit a buffered row for each available language. The callback receives the
   * language code and returns the language-varying fields; common fields like
   * `class` and `name` should be included in the callback return.
   */
  emitForEachLanguage(
    buildRow: (
      lang: string,
    ) => Partial<TSVRowData> & Pick<TSVRowData, 'class' | 'name'>,
    target?: 'buffer' | 'direct',
  ): void {
    if (!target) target = 'buffer';
    for (const lang of this.languageHandler.getAvailableLanguages()) {
      const row = this.row({ language: lang, ...buildRow(lang) });
      if (target === 'direct') {
        this.tsvGenerator.addRow(row);
      } else {
        this.bufferRow(row);
      }
    }
  }

  /**
   * Add a pre-built row directly to the TSV output, bypassing the buffer.
   * Used for S/SL rows that are emitted once per language without buffering.
   */
  addRow(row: TSVRowData): void {
    this.tsvGenerator.addRow(row);
  }

  /**
   * Buffer a Q/SQ/A row for later language-grouped output.
   * LimeSurvey's TSV importer uses a question_order counter ($qseq) that gets
   * reset when it encounters a translation of a previously-seen question.
   * By outputting all base-language rows first, the counter increments correctly.
   */
  bufferRow(row: TSVRowData): void {
    this.buffer.push(row);
  }

  /**
   * Flush buffered group content, outputting base language rows first,
   * then each additional language.
   */
  flushGroupContent(): void {
    if (this.buffer.length === 0) return;

    const ls = (lang: string) => this.languageHandler.toLs(lang);
    const baseLanguage = this.languageHandler.getBaseLanguage();
    for (const row of this.buffer) {
      if (row.language === ls(baseLanguage)) {
        this.tsvGenerator.addRow(row);
      }
    }

    for (const lang of this.languageHandler.getAvailableLanguages()) {
      if (lang === baseLanguage) continue;
      for (const row of this.buffer) {
        if (row.language === ls(lang)) {
          this.tsvGenerator.addRow(row);
        }
      }
    }

    this.buffer = [];
  }

  getBuffer(): TSVRowData[] {
    return this.buffer;
  }
}

/**
 * Convenience wrapper: load an XLSForm workbook and convert it to LimeSurvey
 * TSV in one call. Pipeline code, so it lives in the pipeline (a format module
 * must not import one).
 */

import type { LstsvConfig } from '../../config/types.js';
import type { ChoiceRow } from '../../xlsform/types.js';
import { XLSLoader } from '../../xlsform/loader.js';
import type { LoadOptions } from '../../xlsform/loader.js';

import { XLSFormToTSVConverter } from './index.js';

/** The loader shares the caller's warning sink (#108). */
function loadOptions(config?: Partial<LstsvConfig>): LoadOptions {
  return config?.onWarning ? { onWarning: config.onWarning } : {};
}

export class XLSFormParser {
  /**
   * Convert XLS/XLSX file to TSV using the main converter
   * @param filePath Path to XLS or XLSX file
   * @param config Optional configuration
   * @param fileChoices Choices for unregistered `select_*_from_file` CSVs,
   *   keyed by filename (see `parseVocabCsv`). Registered ones are built in.
   * @returns TSV string
   */
  static async convertXLSFileToTSV(
    filePath: string,
    config?: Partial<LstsvConfig>,
    fileChoices?: Record<string, ChoiceRow[]>,
  ): Promise<string> {
    // Load data (validation is included by default)
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSFile(
      filePath,
      loadOptions(config),
    );

    const converter = new XLSFormToTSVConverter(config);
    return await converter.convert(
      surveyData,
      choicesData,
      settingsData,
      fileChoices,
    );
  }

  /**
   * Convert XLS/XLSX data to TSV using the main converter
   * @param data XLS or XLSX file data
   * @param config Optional configuration
   * @param fileChoices Choices for unregistered `select_*_from_file` CSVs,
   *   keyed by filename (see `parseVocabCsv`). Registered ones are built in.
   * @returns TSV string
   */
  static async convertXLSDataToTSV(
    data: Buffer | ArrayBuffer,
    config?: Partial<LstsvConfig>,
    fileChoices?: Record<string, ChoiceRow[]>,
  ): Promise<string> {
    // Load data (validation is included by default)
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      data,
      loadOptions(config),
    );

    const converter = new XLSFormToTSVConverter(config);
    return await converter.convert(
      surveyData,
      choicesData,
      settingsData,
      fileChoices,
    );
  }
}

/**
 * @file Main entrypoint of this library.
 */

import { ConversionConfig } from '../config/ConfigManager.js';
import type { ChoiceRow } from './types.js';

import { XLSLoader } from './loader.js';

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
    config?: Partial<ConversionConfig>,
    fileChoices?: Record<string, ChoiceRow[]>,
  ): Promise<string> {
    const { XLSFormToTSVConverter } =
      await import('../pipelines/xlsform2lstsv/index.js');

    // Load data (validation is included by default)
    const { surveyData, choicesData, settingsData } =
      XLSLoader.parseXLSFile(filePath);

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
    config?: Partial<ConversionConfig>,
    fileChoices?: Record<string, ChoiceRow[]>,
  ): Promise<string> {
    const { XLSFormToTSVConverter } =
      await import('../pipelines/xlsform2lstsv/index.js');

    // Load data (validation is included by default)
    const { surveyData, choicesData, settingsData } =
      XLSLoader.parseXLSData(data);

    const converter = new XLSFormToTSVConverter(config);
    return await converter.convert(
      surveyData,
      choicesData,
      settingsData,
      fileChoices,
    );
  }
}

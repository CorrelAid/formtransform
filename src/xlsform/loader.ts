import * as XLSX from 'xlsx';

import { SurveyRow, ChoiceRow, SettingsRow, XLSFormData } from './types.js';
import {
  extractBaseColumnName,
  extractLanguageCode,
  getLanguageCodesFromHeaders,
  validateLanguageCodes,
  isValidLanguageCode,
} from '../utils/languageUtils.js';

import { XLSValidator } from './validate.js';

type RowData = Record<string, unknown>;

export class XLSLoader {
  /**
   * Parse XLS/XLSX file and extract survey data with validation
   * @param filePath Path to XLS or XLSX file
   * @param options Validation options
   * @returns Object containing validated survey, choices, and settings data
   * @throws Error if required sheets or columns are missing
   */
  static parseXLSFile(
    filePath: string,
    options: { skipValidation?: boolean } = {},
  ): XLSFormData {
    const workbook = XLSX.readFile(filePath);
    return this.parseWorkbook(workbook, options);
  }

  /**
   * Parse XLS/XLSX data (Buffer or ArrayBuffer) with validation
   * @param data XLS or XLSX file data
   * @param options Validation options
   * @returns Object containing validated survey, choices, and settings data
   * @throws Error if required sheets or columns are missing
   */
  static parseXLSData(
    data: Buffer | ArrayBuffer,
    options: { skipValidation?: boolean } = {},
  ): XLSFormData {
    const workbook = XLSX.read(data);
    return this.parseWorkbook(workbook, options);
  }

  /**
   * Parse XLSX workbook with validation
   * @param workbook XLSX workbook object
   * @param options Validation options
   * @returns Object containing validated survey, choices, and settings data
   * @throws Error if required sheets or columns are missing
   */
  static parseWorkbook(
    workbook: XLSX.WorkBook,
    options: { skipValidation?: boolean } = {},
  ): XLSFormData {
    const surveyData: SurveyRow[] = [];
    const choicesData: ChoiceRow[] = [];
    const settingsData: SettingsRow[] = [];

    // Track which sheets we've found
    let hasSurveySheet = false;
    let hasChoicesSheet = false;
    let hasSettingsSheet = false;

    // Process each sheet in the workbook
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (!jsonData || jsonData.length === 0) {
        return;
      }

      // Convert to objects with proper headers
      const headers = jsonData[0] as string[];
      const rows = jsonData.slice(1) as unknown[][];

      // Detect language codes from headers
      const languageCodes = getLanguageCodesFromHeaders(headers);

      // Validate language codes
      const invalidLanguageCodes = validateLanguageCodes(languageCodes);
      if (invalidLanguageCodes.length > 0) {
        console.warn(
          `Warning: Invalid language codes detected in sheet "${sheetName}": ${invalidLanguageCodes.join(', ')}. These will be ignored. Valid language codes should be 2-letter IANA subtags (e.g., 'en', 'es', 'fr').`,
        );
      }

      const sheetData = rows.map((row) => {
        const obj: RowData = {};
        headers.forEach((header, index) => {
          if (header && row[index] !== undefined) {
            const baseColumn = extractBaseColumnName(header);
            const langCode = extractLanguageCode(header);

            // Store language-specific values in a structured way
            if (langCode) {
              // Only store valid language codes
              if (isValidLanguageCode(langCode)) {
                if (!obj[baseColumn]) {
                  obj[baseColumn] = {};
                }
                (obj[baseColumn] as Record<string, unknown>)[langCode] =
                  row[index];
              }
            } else {
              // Regular column
              obj[header] = row[index];
            }
          }
        });

        // Store detected languages for this sheet (only valid ones)
        const validLanguages = languageCodes.filter(isValidLanguageCode);
        if (validLanguages.length > 0) {
          obj._languages = validLanguages;
        }

        return obj;
      });

      // Match standard XLSForm sheet names (exact match, case-insensitive)
      const lowerCaseSheetName = sheetName.toLowerCase().trim();
      if (lowerCaseSheetName === 'survey') {
        hasSurveySheet = true;
        sheetData.forEach((row) => surveyData.push(row));
      } else if (
        lowerCaseSheetName === 'choices' ||
        lowerCaseSheetName === 'choice'
      ) {
        hasChoicesSheet = true;
        sheetData.forEach((row) => choicesData.push(row));
      } else if (
        lowerCaseSheetName === 'settings' ||
        lowerCaseSheetName === 'setting'
      ) {
        hasSettingsSheet = true;
        sheetData.forEach((row) => settingsData.push(row));
      }
    });

    // Validate by default, unless explicitly skipped
    if (!options.skipValidation) {
      XLSValidator.validateAll({
        surveyData,
        choicesData,
        hasSurveySheet,
        hasChoicesSheet,
      });
    }

    return {
      surveyData,
      choicesData,
      settingsData,
      hasSurveySheet,
      hasChoicesSheet,
      hasSettingsSheet,
    };
  }
}

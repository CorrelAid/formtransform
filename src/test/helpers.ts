import { XLSFormToTSVConverter } from '../pipelines/xlsform2lstsv/index';

interface SurveyRow {
  type?: string;
  name?: string;
  label?: string;
  hint?: string;
  required?: string;
  relevant?: string;
  constraint?: string;
  constraint_message?: string;
  calculation?: string;
  default?: string;
  [key: string]: any;
}

interface ChoiceRow {
  list_name?: string;
  name?: string;
  label?: string;
  filter?: string;
  [key: string]: any;
}

interface SettingsRow {
  form_title?: string;
  form_id?: string;
  default_language?: string;
  [key: string]: any;
}

export interface TSVRow {
  class: string;
  'type/scale': string;
  name: string;
  relevance: string;
  text: string;
  help: string;
  language: string;
  validation: string;
  mandatory: string;
  other: string;
  default: string;
  same_default: string;
}

/**
 * Helper to convert XLSForm data and parse TSV output into structured rows
 */
export async function convertAndParse(
  surveyData: SurveyRow[],
  choicesData: ChoiceRow[] = [],
  settingsData: SettingsRow[] = [
    { form_title: 'Test Survey', default_language: 'en' },
  ],
  config: any = null,
): TSVRow[] {
  const converter = new XLSFormToTSVConverter(config || {});
  const tsv = await converter.convert(surveyData, choicesData, settingsData);
  return parseTSV(tsv);
}

/**
 * Parse TSV string into array of row objects
 */
export function parseTSV(tsv: string): TSVRow[] {
  const lines = tsv.split('\n').filter((line) => line.trim());
  const headers = lines[0].split('\t');

  return lines.slice(1).map((line) => {
    const values = parseTSVLine(line);
    const row: any = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    return row as TSVRow;
  });
}

/**
 * Parse a single TSV line, handling quoted values
 */
function parseTSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (next === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = false;
      }
    } else if (char === '\t' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

/**
 * Find rows by class type
 */
export function findRowsByClass(rows: TSVRow[], classType: string): TSVRow[] {
  return rows.filter((row) => row.class === classType);
}

/**
 * Find a single row by name
 */
export function findRowByName(
  rows: TSVRow[],
  name: string,
): TSVRow | undefined {
  return rows.find((row) => row.name === name);
}

/**
 * Create minimal settings data
 */
export function createSettings(
  overrides: Partial<SettingsRow> = {},
): SettingsRow[] {
  return [
    {
      form_title: 'Test Survey',
      form_id: 'test',
      default_language: 'en',
      ...overrides,
    },
  ];
}

/**
 * Create a simple choice list
 */
export function createChoices(
  listName: string,
  choices: Array<{ name: string; label: string }>,
): ChoiceRow[] {
  return choices.map((choice) => ({
    list_name: listName,
    name: choice.name,
    label: choice.label,
  }));
}

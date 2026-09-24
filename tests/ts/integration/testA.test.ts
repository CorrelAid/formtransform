import { describe, it, expect } from 'vitest';
import { XLSLoader, XLSFormToTSVConverter } from '../../../src/index';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFilePath = path.join(
  __dirname,
  '../../../tests/fixtures/surveys/testA/xlsform.xlsx',
);
const testFileData = fs.readFileSync(testFilePath);

describe('Integration: testA.xlsx', () => {
  it('should load and validate the xlsx file', () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    expect(surveyData.length).toBeGreaterThan(0);
    expect(choicesData.length).toBeGreaterThan(0);
    expect(settingsData.length).toBeGreaterThan(0);
  });

  it('converts its range question with bounds from parameters (#33)', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const tsv = await new XLSFormToTSVConverter().convert(
      surveyData,
      choicesData,
      settingsData,
    );
    const header = tsv.split('\n')[0].split('\t');
    const row = tsv
      .split('\n')
      .map((l) => l.split('\t'))
      .find((cells) => cells[2] === 'attributionberuf');
    expect(row).toBeDefined();
    const cell = (col: string) => row![header.indexOf(col)];
    expect(cell('type/scale')).toBe('N');
    expect(cell('min_num_value_n')).toBe('0');
    expect(cell('max_num_value_n')).toBe('100');
    expect(cell('num_value_int_only')).toBe('1');
  });
});

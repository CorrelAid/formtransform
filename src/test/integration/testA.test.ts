import { describe, it, expect } from 'vitest';
import { XLSLoader, XLSFormToTSVConverter } from '../../index';
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

  it('should throw on unimplemented range type during conversion', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    await expect(
      converter.convert(surveyData, choicesData, settingsData),
    ).rejects.toThrow(/Unimplemented XLSForm type: 'range'/);
  });
});

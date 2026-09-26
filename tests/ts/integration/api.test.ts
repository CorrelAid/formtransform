/** The uniform conversion functions and the deprecated names they replace (#66). */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import * as api from '../../../src/index';
import * as internals from '../../../src/internals';

const dir = path.join(__dirname, '../../../tests/fixtures/surveys/testA');
const bytes = fs.readFileSync(path.join(dir, 'xlsform.xlsx'));
const tsv = fs.readFileSync(path.join(dir, 'tsv.tsv'), 'utf-8');
const prodDate = '2000-01-01';

describe('conversion functions', () => {
  const form = api.XLSLoader.parseXLSData(bytes, { skipValidation: true });

  it('xlsformToLstsv: bytes and loaded sheets give the converter output', async () => {
    const expected = await new internals.XLSFormToTSVConverter().convert(
      form.surveyData,
      form.choicesData,
      form.settingsData,
    );
    const opts = { skipValidation: true };
    expect(await api.xlsformToLstsv(bytes, opts)).toBe(expected);
    expect(await api.xlsformToLstsv(form, opts)).toBe(expected);
  });

  it('xlsformToDdi: takes settings from the form', () => {
    const expected = internals.buildDdiXml(form.surveyData, form.choicesData, {
      settings: form.settingsData[0],
      prodDate,
    });
    expect(api.xlsformToDdi(bytes, { prodDate })).toBe(expected);
    expect(
      api.xlsformToDdi(
        { surveyData: form.surveyData, choicesData: form.choicesData },
        { prodDate, settings: form.settingsData[0] },
      ),
    ).toBe(expected);
  });

  it('xlsformToLstsv rejects names LimeSurvey cannot hold unless skipValidation', async () => {
    await expect(api.xlsformToLstsv(bytes)).rejects.toMatchObject({
      code: 'name-invalid',
    });
  });

  it('xlsformToDdi rejects a form outside the DDI subset', () => {
    const bad = {
      surveyData: [{ type: 'geopoint', name: 'g' }],
      choicesData: [],
    };
    expect(() => api.xlsformToDdi(bad)).toThrow(
      expect.objectContaining({ code: 'xlsform-outside-subset' }),
    );
    expect(() => api.xlsformToDdi(bad, { skipValidation: true })).not.toThrow();
  });

  it('lstsvToDdi matches lstsvToDdiXml', () => {
    expect(api.lstsvToDdi(tsv, { prodDate })).toBe(
      internals.lstsvToDdiXml(tsv, { prodDate }),
    );
  });
});

describe('deprecated main-entry names', () => {
  it('are the internals, unchanged', () => {
    const moved = [
      'XLSFormToTSVConverter',
      'XLSFormParser',
      'buildDdiXml',
      'lstsvToDdiXml',
      'convertRelevance',
      'convertConstraint',
      'xpathToLimeSurvey',
      'TypeMapper',
      'TSVGenerator',
      'buildDdiCodebook',
      'normalizeChoices',
      'lstsvRowsToXlsform',
      'ConfigManager',
      'resolveConfig',
    ] as const;
    for (const name of moved) {
      expect(api[name], name).toBe(internals[name]);
    }
  });
});

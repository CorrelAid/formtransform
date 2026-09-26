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
    const err = await api.xlsformToLstsv(bytes).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'xlsform-outside-subset' });
    expect((err as api.ConversionError).details).toContainEqual(
      expect.objectContaining({ code: 'name-invalid' }),
    );
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

describe('subset check in the converters (#109, #110)', () => {
  const text = (name: string, extra: Record<string, string> = {}) => ({
    type: 'text',
    name,
    label: name,
    ...extra,
  });

  it('xlsformToLstsv rejects a reference to a missing question', async () => {
    const form = {
      surveyData: [text('nm', { relevant: '${nope} = 1' })],
      choicesData: [],
    };
    const err = await api.xlsformToLstsv(form).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'xlsform-outside-subset' });
    expect((err as api.ConversionError).details).toContainEqual(
      expect.objectContaining({ code: 'reference-unknown' }),
    );
  });

  it('xlsformToLstsv reports every problem, not only the first', async () => {
    const form = {
      surveyData: [
        { type: 'geopoint', name: 'where', label: 'where' },
        text('nm', { relevant: '${nope} = 1' }),
      ],
      choicesData: [],
    };
    const err = await api.xlsformToLstsv(form).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'xlsform-outside-subset' });
    const codes = (err as api.ConversionError).details.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining(['type-unregistered', 'reference-unknown']),
    );
  });

  describe('subset warnings reach onWarning', () => {
    const form = {
      surveyData: [
        { type: 'select_one yn', name: 'ok', label: 'ok' },
        text('why', { relevant: "${ok} = 'maybe'" }),
      ],
      choicesData: [
        { list_name: 'yn', name: 'yes', label: 'Yes' },
        { list_name: 'yn', name: 'no', label: 'No' },
      ],
    };
    const literal = expect.objectContaining({ code: 'literal-invalid' });

    it('xlsformToLstsv', async () => {
      const w: api.Diagnostic[] = [];
      await api.xlsformToLstsv(form, { onWarning: (d) => w.push(d) });
      expect(w).toContainEqual(literal);
    });

    it('xlsformToDdi', () => {
      const w: api.Diagnostic[] = [];
      api.xlsformToDdi(form, { prodDate, onWarning: (d) => w.push(d) });
      expect(w).toContainEqual(literal);
    });

    it('also when the form is rejected', async () => {
      const bad = {
        ...form,
        surveyData: [...form.surveyData, { type: 'geopoint', name: 'g' }],
      };
      const w: api.Diagnostic[] = [];
      await expect(
        api.xlsformToLstsv(bad, { onWarning: (d) => w.push(d) }),
      ).rejects.toMatchObject({ code: 'xlsform-outside-subset' });
      expect(w).toContainEqual(literal);
    });
  });

  it('a warning both the check and the converter find arrives once', async () => {
    const form = {
      surveyData: [text('nm', { appearance: 'nosuchappearance' })],
      choicesData: [],
    };
    const w: api.Diagnostic[] = [];
    await api.xlsformToLstsv(form, { onWarning: (d) => w.push(d) });
    const found = w.filter((d) => d.code === 'appearance-unregistered');
    expect(found).toHaveLength(1);
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

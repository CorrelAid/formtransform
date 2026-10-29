/**
 * `hidden` is a question whose value comes from the survey link or its
 * default (convention:linkPrefill, #207): a hidden LimeSurvey question, a DDI
 * variable known by `otherResponseDomainType`, and back.
 */
import { describe, expect, test } from 'vitest';

import {
  ddiToXlsform,
  lstsvToDataCsv,
  lstsvToXlsform,
  xlsformToDdi,
  xlsformToLstsv,
} from '../../../src/index.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { parseTSV } from './helpers';

const FORM = {
  surveyData: [
    { type: 'hidden', name: 'partner', label: 'Partner' },
    { type: 'hidden', name: 'modul', default: 'O' },
    { type: 'text', name: 'q', label: 'Q?' },
  ] as never,
  choicesData: [],
};

const typesOf = (survey: Record<string, unknown>[]) =>
  survey.map((r) => [r.name, r.type, r.default ?? '']);

describe('hidden (#207)', () => {
  test('LimeSurvey: a short text with hidden=1 and its default', async () => {
    const rows = parseTSV(await xlsformToLstsv(FORM));
    const q = (name: string) => rows.find((r) => r.name === name);
    expect(q('partner')).toMatchObject({ 'type/scale': 'S', hidden: '1' });
    expect(q('modul')).toMatchObject({ hidden: '1', default: 'O' });
    expect(q('q')?.hidden ?? '').toBe('');
  });

  test('LimeSurvey → XLSForm: a hidden short text is hidden again', async () => {
    const { survey } = lstsvToXlsform(await xlsformToLstsv(FORM));
    expect(typesOf(survey)).toEqual([
      ['partner', 'hidden', ''],
      ['modul', 'hidden', 'O'],
      ['q', 'text', ''],
    ]);
  });

  test('DDI: a variable with a qstn even without a label, and back', () => {
    const xml = xlsformToDdi(FORM);
    expect(xml).toContain(
      '<var ID="V_modul" name="modul" intrvl="discrete" files="F1">\n      <qstn responseDomainType="other" otherResponseDomainType="hidden" seqNo="2"/>',
    );
    expect(xml).not.toContain('cdl:row');
    const { survey } = ddiToXlsform(xml);
    expect(typesOf(survey)).toEqual([
      ['partner', 'hidden', ''],
      ['modul', 'hidden', 'O'],
      ['q', 'text', ''],
    ]);
  });

  test('an `other` domain formtransform does not write is read as text', () => {
    const xml = xlsformToDdi(FORM).replaceAll(
      'otherResponseDomainType="hidden"',
      'otherResponseDomainType="geo"',
    );
    const warnings: Diagnostic[] = [];
    const { survey } = ddiToXlsform(xml, {
      onWarning: (w) => warnings.push(w),
    });
    expect(survey.find((r) => r.name === 'partner')?.type).toBe('text');
    expect(warnings.map((w) => w.code)).toContain('ddi-type-unknown');
  });

  test('the prefilled value is a column of the data', async () => {
    const csv = lstsvToDataCsv(await xlsformToLstsv(FORM), [
      { partner: 'TEST', modul: 'O', q: 'x' },
    ]);
    expect(csv.trim().split(/\r?\n/)).toEqual(['partner,modul,q', 'TEST,O,x']);
  });
});

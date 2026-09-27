/** hint → <postQTxt> (#153), guidance_hint → <ivuInstr> (#76). */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../../src/pipelines/xlsform2ddi/index.js';
import { XLSValidator } from '../../../../../src/xlsform/validate.js';

type Row = Record<string, unknown>;

const choices = [
  { list_name: 'yn', name: 'y', label: 'Ja' },
  { list_name: 'yn', name: 'n', label: 'Nein' },
];

/** The <var> element for `name`. */
function varXml(xml: string, name: string): string {
  const m = new RegExp(`<var[^>]*name="${name}"[\\s\\S]*?</var>`).exec(xml);
  if (!m) throw new Error(`no <var name="${name}">`);
  return m[0];
}

const build = (survey: Row[], options = {}) =>
  buildDdiXml(survey, choices, options);

describe('xlsform → DDI hints', () => {
  test('hint becomes postQTxt, guidance_hint becomes ivuInstr', () => {
    const v = varXml(
      build([
        {
          type: 'text',
          name: 'job',
          label: 'Beruf?',
          hint: 'Aktueller Beruf',
          guidance_hint: 'Nicht vorlesen',
        },
      ]),
      'job',
    );
    expect(v).toContain('<postQTxt>Aktueller Beruf</postQTxt>');
    expect(v).toContain('<ivuInstr>Nicht vorlesen</ivuInstr>');
    expect(v).not.toContain('<preQTxt>');
    // XSD order: qstnLit, postQTxt, ivuInstr.
    expect(v.indexOf('<qstnLit>')).toBeLessThan(v.indexOf('<postQTxt>'));
    expect(v.indexOf('<postQTxt>')).toBeLessThan(v.indexOf('<ivuInstr>'));
  });

  test('no hint, no postQTxt or ivuInstr', () => {
    const v = varXml(
      build([{ type: 'text', name: 'job', label: 'Beruf?' }]),
      'job',
    );
    expect(v).not.toContain('<postQTxt>');
    expect(v).not.toContain('<ivuInstr>');
  });

  test('a preceding note is preQTxt, the hint stays apart as postQTxt', () => {
    const v = varXml(
      build([
        { type: 'note', name: 'intro', label: 'Zu Ihrem Haushalt' },
        { type: 'integer', name: 'n', label: 'Personen?', hint: 'Mit Kindern' },
      ]),
      'n',
    );
    expect(v).toContain('<preQTxt>Zu Ihrem Haushalt</preQTxt>');
    expect(v).toContain('<postQTxt>Mit Kindern</postQTxt>');
  });

  test('guidance_hint from parameters when there is no column', () => {
    const v = varXml(
      build([
        {
          type: 'select_one yn',
          name: 'q',
          label: 'Ehrenamt?',
          parameters: 'randomize=true; guidance_hint=Auch gelegentlich',
        },
      ]),
      'q',
    );
    expect(v).toContain('<ivuInstr>Auch gelegentlich</ivuInstr>');
  });

  test('the hint in the same language as the label', () => {
    const v = varXml(
      build([
        {
          type: 'text',
          name: 'job',
          'label::Deutsch (de)': 'Beruf?',
          'label::English (en)': 'Job?',
          'hint::English (en)': 'Current job',
          'hint::Deutsch (de)': 'Aktueller Beruf',
        },
      ]),
      'job',
    );
    expect(v).toContain('<qstnLit>Beruf?</qstnLit>');
    expect(v).toContain('<postQTxt>Aktueller Beruf</postQTxt>');
  });
});

describe("validateSubset — 'hint-dropped'", () => {
  const dropped = (survey: Row[], target: 'ddi' | 'lstsv') =>
    XLSValidator.validateSubset(survey, choices, { target })
      .filter((d) => d.code === 'hint-dropped')
      .map((d) => d.name);

  test('ddi: none, every hint has a place (#153)', () => {
    const survey = [
      { type: 'select_multiple yn', name: 'm', label: 'M?', hint: 'H' },
      { type: 'select_one yn', name: 'o', label: 'O?', hint: 'H' },
      {
        type: 'select_multiple yn',
        name: 'p',
        label: 'P?',
        parameters: 'guidance_hint=G',
      },
    ];
    expect(dropped(survey, 'ddi')).toEqual([]);
  });

  test('lstsv: any guidance_hint, not a plain hint', () => {
    const survey = [
      { type: 'text', name: 'a', label: 'A?', hint: 'H' },
      { type: 'text', name: 'b', label: 'B?', 'guidance_hint::de': 'G' },
      { type: 'text', name: 'c', label: 'C?', parameters: 'guidance_hint=G' },
    ];
    expect(dropped(survey, 'lstsv')).toEqual(['b', 'c']);
  });
});

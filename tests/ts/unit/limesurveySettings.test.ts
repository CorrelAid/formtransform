/**
 * convention:surveySettings, limesurveySettings (#228): optional
 * `limesurvey_<setting>` columns on the settings sheet become LimeSurvey
 * `S` rows, and come back from them.
 */
import { describe, expect, test } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../src/pipelines/ddi2xlsform/index.js';
import {
  limesurveySettingColumns,
  limesurveySettingsOf,
} from '../../../src/conventions/surveySettings.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { findRowsByClass, parseTSV } from './helpers';

const survey = [{ type: 'text', name: 'q1', label: 'Q' }];

async function convert(
  settings: Record<string, unknown>,
  config: { hideNoAnswer?: boolean; surveySettingDefaults?: boolean } = {},
) {
  const warnings: Diagnostic[] = [];
  const tsv = await new XLSFormToTSVConverter({
    ...config,
    onWarning: (w) => warnings.push(w),
  }).convert(
    survey,
    [],
    [{ form_title: 'T', default_language: 'de', ...settings }],
  );
  const sRows = findRowsByClass(parseTSV(tsv), 'S').map((r) => [
    r.name,
    r.text,
  ]);
  return { tsv, sRows, warnings };
}

describe('limesurveySettingsOf', () => {
  const collect = (settings: Record<string, unknown>) => {
    const warnings: Diagnostic[] = [];
    const out = limesurveySettingsOf(settings, (w) => warnings.push(w));
    return { out: Object.fromEntries(out), warnings };
  };

  test('reads only prefixed columns, in column order', () => {
    const { out, warnings } = collect({
      form_title: 'T',
      limesurvey_showqnumcode: 'X',
      limesurvey_allowprev: 'Y',
      style: 'pages',
    });
    expect(Object.keys(out)).toEqual(['showqnumcode', 'allowprev']);
    expect(warnings).toEqual([]);
  });

  test('Y/N settings take yes/no and true/false in any case', () => {
    const { out } = collect({
      limesurvey_allowprev: 'yes',
      limesurvey_allowsave: 'TRUE',
      limesurvey_showxquestions: 'no',
      limesurvey_showprogress: 'y',
    });
    expect(out).toEqual({
      allowprev: 'Y',
      allowsave: 'Y',
      showxquestions: 'N',
      showprogress: 'Y',
    });
  });

  test('a coded setting matches case-insensitively; a number cell counts', () => {
    const { out } = collect({
      limesurvey_showgroupinfo: 'b',
      limesurvey_questionindex: 2,
      limesurvey_navigationdelay: '5',
      limesurvey_template: 'fruity_twentythree',
    });
    expect(out).toEqual({
      showgroupinfo: 'B',
      questionindex: '2',
      navigationdelay: '5',
      template: 'fruity_twentythree',
    });
  });

  test('an empty cell is no setting and no warning', () => {
    expect(collect({ limesurvey_allowprev: '' })).toEqual({
      out: {},
      warnings: [],
    });
  });

  test.each([
    ['limesurvey_allowprev', 'maybe', 'not a valid value'],
    ['limesurvey_showqnumcode', 'Y', 'not a valid value'],
    ['limesurvey_navigationdelay', 'soon', 'not a valid value'],
    ['limesurvey_template', 'a theme', 'not a valid value'],
    ['limesurvey_allowprev', { de: 'Y' }, 'not a valid value'],
    [
      'limesurvey_adminemail',
      'x@y.de',
      'not a supported LimeSurvey survey setting',
    ],
    ['limesurvey_format', 'S', 'set from the form'],
    ['limesurvey_language', 'en', 'set from the form'],
    ['limesurvey_additional_languages', 'en', 'set from the form'],
  ])('%s = %j is dropped with setting-invalid', (column, value, why) => {
    const { out, warnings } = collect({ [column]: value });
    expect(out).toEqual({});
    expect(warnings.map((w) => w.code)).toEqual(['setting-invalid']);
    expect(warnings[0].message).toContain(column);
    expect(warnings[0].message).toContain(why);
  });
});

describe('xlsform → LimeSurvey S rows', () => {
  test('the issue #228 settings become S rows after the default ones', async () => {
    const { sRows, warnings } = await convert({
      limesurvey_allowprev: 'Y',
      limesurvey_allowsave: 'Y',
      limesurvey_showxquestions: 'N',
      limesurvey_showgroupinfo: 'B',
      limesurvey_showqnumcode: 'X',
      limesurvey_showprogress: 'Y',
    });
    expect(sRows).toEqual([
      ['language', 'de'],
      ['format', 'A'],
      ['shownoanswer', 'N'],
      ['allowprev', 'Y'],
      ['showxquestions', 'N'],
      ['allowsave', 'Y'],
      ['showgroupinfo', 'B'],
      ['showqnumcode', 'X'],
      ['showprogress', 'Y'],
    ]);
    expect(warnings).toEqual([]);
  });

  test('without columns the S rows carry the defaults (#240)', async () => {
    const { sRows } = await convert({});
    expect(sRows).toEqual([
      ['language', 'de'],
      ['format', 'A'],
      ['shownoanswer', 'N'],
      ['allowprev', 'Y'],
      ['showxquestions', 'N'],
    ]);
  });

  test('a column overrides allowprev / showxquestions: one row each (#240)', async () => {
    const { sRows } = await convert({
      limesurvey_allowprev: 'N',
      limesurvey_showxquestions: 'Y',
    });
    expect(sRows.filter(([n]) => n === 'allowprev')).toEqual([
      ['allowprev', 'N'],
    ]);
    expect(sRows.filter(([n]) => n === 'showxquestions')).toEqual([
      ['showxquestions', 'Y'],
    ]);
  });

  test('surveySettingDefaults=false leaves both out; columns still count (#240)', async () => {
    expect((await convert({}, { surveySettingDefaults: false })).sRows).toEqual(
      [
        ['language', 'de'],
        ['format', 'A'],
        ['shownoanswer', 'N'],
      ],
    );
    const { sRows } = await convert(
      { limesurvey_allowprev: 'Y' },
      { surveySettingDefaults: false },
    );
    expect(sRows).toContainEqual(['allowprev', 'Y']);
    expect(sRows.map(([n]) => n)).not.toContain('showxquestions');
  });

  test('limesurvey_shownoanswer overrides the default: one row', async () => {
    const { sRows } = await convert({ limesurvey_shownoanswer: 'Y' });
    expect(sRows.filter(([name]) => name === 'shownoanswer')).toEqual([
      ['shownoanswer', 'Y'],
    ]);
  });

  test('limesurvey_shownoanswer is written with hideNoAnswer=false too', async () => {
    expect((await convert({}, { hideNoAnswer: false })).sRows).toEqual([
      ['language', 'de'],
      ['format', 'A'],
      ['allowprev', 'Y'],
      ['showxquestions', 'N'],
    ]);
    const { sRows } = await convert(
      { limesurvey_shownoanswer: 'N' },
      { hideNoAnswer: false },
    );
    expect(sRows).toContainEqual(['shownoanswer', 'N']);
  });

  test('limesurvey_format cannot contradict style: one format row, a warning', async () => {
    const { sRows, warnings } = await convert({
      style: 'pages',
      limesurvey_format: 'A',
    });
    expect(sRows.filter(([name]) => name === 'format')).toEqual([
      ['format', 'G'],
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['setting-invalid']);
  });

  test('an unknown setting is not written', async () => {
    const { tsv, warnings } = await convert({ limesurvey_foo: 'Y' });
    expect(tsv).not.toContain('foo');
    expect(warnings.map((w) => w.code)).toEqual(['setting-invalid']);
  });
});

describe('LimeSurvey S rows → xlsform', () => {
  test('limesurveySettingColumns skips derived, default, unknown and invalid rows', () => {
    expect(
      limesurveySettingColumns([
        { name: 'language', text: 'de' },
        { name: 'format', text: 'G' },
        { name: 'shownoanswer', text: 'N' },
        { name: 'allowprev', text: 'Y' },
        { name: 'showxquestions', text: 'N' },
        { name: 'allowsave', text: 'Y' },
        { name: 'admin', text: 'Jane' },
        { name: 'showqnumcode', text: 'Q' },
        { name: 'questionindex', text: '1' },
      ]),
    ).toEqual({
      limesurvey_allowsave: 'Y',
      limesurvey_questionindex: '1',
    });
  });

  test('round trip: xlsform → TSV → xlsform keeps the columns', async () => {
    const settings = {
      limesurvey_allowprev: 'N',
      limesurvey_showxquestions: 'Y',
      limesurvey_showqnumcode: 'X',
      limesurvey_shownoanswer: 'Y',
    };
    const { tsv } = await convert(settings);
    const back = lstsvToXlsform(tsv).settings[0];
    expect(back).toMatchObject(settings);
    // ...and converts to the same TSV again.
    const again = await new XLSFormToTSVConverter({}).convert(
      lstsvToXlsform(tsv).survey,
      lstsvToXlsform(tsv).choices,
      [back],
    );
    expect(again).toBe(tsv);
  });

  test('a form without columns gets none back, defaults included (#240)', async () => {
    const { tsv, sRows } = await convert({});
    expect(sRows).toContainEqual(['allowprev', 'Y']);
    const back = lstsvToXlsform(tsv).settings[0] ?? {};
    expect(
      Object.keys(back).filter((k) => k.startsWith('limesurvey_')),
    ).toEqual([]);
  });
});

describe('DDI', () => {
  test('the survey-setting defaults are not in the DDI (#240)', () => {
    const xml = buildDdiXml(survey, [], {
      settings: { form_title: 'T', form_id: 't' },
    });
    expect(xml).not.toContain('allowprev');
    expect(xml).not.toContain('showxquestions');
  });

  test('each column is a cdl:setting note and comes back from it', () => {
    const settings = {
      form_title: 'T',
      form_id: 't',
      limesurvey_allowprev: 'Y',
      limesurvey_showqnumcode: 'X',
    };
    const xml = buildDdiXml(survey, [], { settings });
    expect(xml).toContain(
      '<notes type="cdl:setting" subject="limesurvey_allowprev">Y</notes>',
    );
    expect(ddiToXlsform(xml).settings[0]).toMatchObject({
      limesurvey_allowprev: 'Y',
      limesurvey_showqnumcode: 'X',
    });
  });
});

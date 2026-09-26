/** Group structure lstsv2xlsform used to drop (#99). */
import { describe, expect, test } from 'vitest';

import { xlsformToLstsv } from '../../../../../src/api.js';
import { validateLstsvSubset } from '../../../../../src/lstsv/validate.js';
import { parseLstsv } from '../../../../../src/lstsv/parser.js';
import { lstsvToXlsform } from '../../../../../src/pipelines/lstsv2xlsform/index.js';

type Row = Record<string, unknown>;

const roundTrip = async (survey: Row[], settings: Row[] = []) =>
  lstsvToXlsform(
    await xlsformToLstsv({
      surveyData: survey as never,
      choicesData: [],
      settingsData: settings as never,
    }),
  ).survey;

const HEADER =
  'class\ttype/scale\tname\trelevance\ttext\thelp\tlanguage\tvalidation\tem_validation_q\tmandatory\tother\tdefault\tsame_default';

describe('lstsv2xlsform groups', () => {
  test('a group keeps its relevance', async () => {
    const survey = await roundTrip([
      { type: 'integer', name: 'age', label: 'Age?' },
      {
        type: 'begin_group',
        name: 'prefs',
        label: 'Preferences',
        relevant: '${age} >= 18',
      },
      { type: 'text', name: 'q', label: 'Q?' },
      { type: 'end_group' },
    ]);
    expect(survey.find((r) => r.label === 'Preferences')).toMatchObject({
      type: 'begin_group',
      relevant: '${age} >= 18',
    });
  });

  test('style: pages gives each group field-list', async () => {
    const survey = await roundTrip(
      [
        {
          type: 'begin_group',
          name: 'p1',
          label: 'Page 1',
          appearance: 'field-list',
        },
        { type: 'text', name: 'a', label: 'A?' },
        { type: 'end_group' },
        {
          type: 'begin_group',
          name: 'p2',
          label: 'Page 2',
          appearance: 'field-list',
        },
        { type: 'text', name: 'b', label: 'B?' },
        { type: 'end_group' },
      ],
      [{ style: 'pages' }],
    );
    expect(
      survey.filter((r) => r.type === 'begin_group').map((r) => r.appearance),
    ).toEqual(['field-list', 'field-list']);
  });

  test('without pages, a group has no appearance', async () => {
    const survey = await roundTrip([
      { type: 'begin_group', name: 'g', label: 'G' },
      { type: 'text', name: 'a', label: 'A?' },
      { type: 'end_group' },
      { type: 'text', name: 'b', label: 'B?' },
    ]);
    expect(
      survey.find((r) => r.type === 'begin_group')?.appearance,
    ).toBeUndefined();
  });

  test('questions before the first G row are kept, outside any group', () => {
    const tsv = [
      HEADER,
      'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t',
      'Q\tS\tfirst\t1\tFirst?\t\ten\t\t\t\t\t\t',
      'G\t1\tLater\t1\t\t\ten\t\t\t\t\t\t',
      'Q\tS\tsecond\t1\tSecond?\t\ten\t\t\t\t\t\t',
      '',
    ].join('\n');
    const survey = lstsvToXlsform(tsv).survey;
    expect(survey.map((r) => r.name ?? r.type)).toEqual([
      'first',
      'later',
      'second',
      'end_group',
    ]);
  });

  test('a code repeated within one question warns code-duplicate', () => {
    const rows = parseLstsv(
      [
        HEADER,
        'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t',
        'G\t1\tG\t1\t\t\ten\t\t\t\t\t\t',
        'Q\tL\tq\t1\tQ?\t\ten\t\t\t\t\t\t',
        'A\t\ta\t\tOne\t\ten\t\t\t\t\t\t',
        'A\t\ta\t\tTwo\t\ten\t\t\t\t\t\t',
        '',
      ].join('\n'),
    );
    expect(validateLstsvSubset(rows)).toContainEqual(
      expect.objectContaining({ code: 'code-duplicate', name: 'q' }),
    );
  });
});

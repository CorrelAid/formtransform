/**
 * Registry-driven "allowed XLSForm subset" validator: reports (not throws)
 * every name/code/type/appearance outside the supported subset.
 */
import { describe, test, expect } from 'vitest';

import { XLSValidator } from '../../../src/xlsform/validate.js';

describe('validateSubset', () => {
  test('a legal form has no violations', () => {
    expect(
      XLSValidator.validateSubset(
        [
          { type: 'text', name: 'firstname' },
          { type: 'select_one colors', name: 'fav' },
        ],
        [{ list_name: 'colors', name: 'red', label: 'Red' }],
      ),
    ).toEqual([]);
  });

  test('flags an unregistered type as an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'geopoint', name: 'r' }],
      [],
    );
    expect(v).toContainEqual(expect.objectContaining({ severity: 'error' }));
    expect(v[0].message).toMatch(/geopoint.*not in the registry/);
  });

  test('flags an illegal name/code as an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'select_one c', name: 'q' }],
      [{ list_name: 'c', name: 'toolong' }],
    );
    expect(
      v.some((x) => x.severity === 'error' && /toolong/.test(x.message)),
    ).toBe(true);
  });

  test('flags an unknown appearance as a warning, not an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'text', name: 'q', appearance: 'bogus' }],
      [],
    );
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('warning');
    expect(v[0].message).toMatch(/bogus/);
  });

  test('accepts select_*_from_file (registered, inlined at convert time)', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'select_one_from_file iso_3166_1.csv', name: 'country' }],
      [],
    );
    expect(v).toEqual([]);
  });

  test('ignores structural and metadata rows', () => {
    expect(
      XLSValidator.validateSubset(
        [
          { type: 'begin_group', name: 'grp' },
          { type: 'today', name: 'today' },
          { type: 'end_group' },
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe('validateSubset — unresolvable answer options (#41)', () => {
  const errors = (
    type: string,
    choices: Record<string, unknown>[] = [],
    fileChoices?: Record<
      string,
      { list_name: string; name: string; label: string }[]
    >,
  ) =>
    XLSValidator.validateSubset([{ type, name: 'q', label: 'Q' }], choices, {
      fileChoices,
    })
      .filter((v) => v.severity === 'error')
      .map((v) => v.message);

  const skala = [{ list_name: 'skala', name: 'a', label: 'A' }];

  test.each(['select_one', 'select_multiple'])(
    '%s without a list name',
    (t) => {
      expect(errors(t)).toEqual([
        `"${t}" (question "q") needs a choice list: "${t} <list_name>"`,
      ]);
      expect(errors(`${t} or_other`)).toHaveLength(1);
    },
  );

  test.each(['select_one', 'select_multiple'])(
    '%s with a list that has no rows',
    (t) => {
      expect(errors(`${t} skala`)).toEqual([
        `"${t} skala" (question "q"): list "skala" has no rows on the choices sheet`,
      ]);
      expect(errors(`${t} skala`, skala)).toEqual([]);
    },
  );

  test.each(['select_one_from_file', 'select_multiple_from_file'])(
    '%s without a file',
    (t) => {
      expect(errors(t)).toEqual([
        `"${t}" (question "q") needs a vocabulary file: "${t} <file>.csv"`,
      ]);
    },
  );

  test.each(['select_one_from_file', 'select_multiple_from_file'])(
    '%s with an unregistered file, unless supplied',
    (t) => {
      expect(errors(`${t} foo.csv`)).toEqual([
        `"${t} foo.csv" (question "q"): "foo.csv" is not a registered vocabulary (registered: iso_3166_1.csv)`,
      ]);
      expect(
        errors(`${t} foo.csv`, [], {
          'foo.csv': [{ list_name: 'foo.csv', name: 'x', label: 'X' }],
        }),
      ).toEqual([]);
    },
  );

  test('a registered vocabulary resolves', () => {
    expect(errors('select_one_from_file iso_3166_1.csv')).toEqual([]);
  });
});

describe('validateSubset — choice lists (#48)', () => {
  const survey = [{ type: 'select_one c', name: 'q', label: 'Q' }];
  const run = (choices: Record<string, unknown>[]) =>
    XLSValidator.validateSubset(survey, choices).map(
      (v) => `${v.severity}: ${v.message}`,
    );

  test('a duplicate code within one list is an error', () => {
    expect(
      run([
        { list_name: 'c', name: 'a', label: 'A' },
        { list_name: 'c', name: 'a', label: 'A again' },
      ]),
    ).toEqual(['error: answer code "a" is used more than once in list "c"']);
  });

  test('the same code in different lists is fine', () => {
    expect(
      run([
        { list_name: 'c', name: 'a', label: 'A' },
        { list_name: 'd', name: 'a', label: 'A' },
      ]),
    ).toEqual([]);
  });

  test('a choice row with a list but no code is an error', () => {
    expect(
      run([
        { list_name: 'c', name: 'a', label: 'A' },
        { list_name: 'c', name: '', label: 'Orphan' },
      ]),
    ).toEqual(['error: a choice in list "c" has no code (name)']);
  });

  test('an empty label is a warning', () => {
    expect(run([{ list_name: 'c', name: 'a', label: ' ' }])).toEqual([
      'warning: choice "a" (list "c") has no label',
    ]);
    expect(run([{ list_name: 'c', name: 'a' }])).toEqual([
      'warning: choice "a" (list "c") has no label',
    ]);
  });

  test('a multilingual label names the languages it is missing in', () => {
    expect(
      run([
        {
          list_name: 'c',
          name: 'a',
          label: { de: 'Ja', en: '' },
          _languages: ['de', 'en'],
        },
      ]),
    ).toEqual(['warning: choice "a" (list "c") has no label in: en']);
    expect(
      run([
        {
          list_name: 'c',
          name: 'a',
          label: { de: '', en: '' },
          _languages: ['de', 'en'],
        },
      ]),
    ).toEqual(['warning: choice "a" (list "c") has no label']);
  });

  test('the strict loader gate rejects duplicate codes too', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(survey, [
        { list_name: 'c', name: 'a', label: 'A' },
        { list_name: 'c', name: 'a', label: 'B' },
      ]),
    ).toThrow(/used more than once in list "c"/);
  });
});

describe("validateSubset — target 'ddi' (#52)", () => {
  const ddi = (
    survey: Record<string, unknown>[],
    choices: Record<string, unknown>[] = [],
  ) =>
    XLSValidator.validateSubset(survey, choices, { target: 'ddi' }).map(
      (v) => `${v.severity}: ${v.message}`,
    );

  test("ignores LimeSurvey's name and code limits", () => {
    expect(
      ddi(
        [
          {
            type: 'select_one freq',
            name: 'how_often_do_you_visit_us',
            label: 'Q',
          },
        ],
        [{ list_name: 'freq', name: 'sometimes', label: 'Sometimes' }],
      ),
    ).toEqual([]);
  });

  test('still rejects unregistered types', () => {
    expect(ddi([{ type: 'geopoint', name: 'loc', label: 'Where' }])).toEqual([
      'error: type "geopoint" (question "loc") is not in the registry — not part of the supported XLSForm subset',
    ]);
  });

  test('still requires unique names and codes, and resolvable lists', () => {
    expect(
      ddi(
        [
          { type: 'select_one freq', name: 'full_name', label: 'A' },
          { type: 'text', name: 'full_name', label: 'B' },
          { type: 'select_one nolist', name: 'x', label: 'C' },
        ],
        [
          { list_name: 'freq', name: 'often', label: 'Often' },
          { list_name: 'freq', name: 'often', label: 'Often again' },
        ],
      ),
    ).toEqual([
      'error: field name "full_name" is used more than once',
      'error: answer code "often" is used more than once in list "freq"',
      'error: "select_one nolist" (question "x"): list "nolist" has no rows on the choices sheet',
    ]);
  });

  test("the default target is still 'lstsv'", () => {
    expect(
      XLSValidator.validateSubset(
        [{ type: 'text', name: 'full_name', label: 'N' }],
        [],
      ),
    ).toContainEqual(expect.objectContaining({ severity: 'error' }));
  });
});

describe('validateSubset — label::<lang> choice columns (#75)', () => {
  const warn = (choices: Record<string, unknown>[]) =>
    XLSValidator.validateSubset(
      [{ type: 'select_one g', name: 'q', 'label::English': 'Q' }],
      choices,
      { target: 'ddi' },
    ).map((v) => v.message);

  test('a label::<lang> column counts as a label', () => {
    expect(
      warn([{ list_name: 'g', name: 'm', 'label::English': 'Male' }]),
    ).toEqual([]);
  });

  test('names the language columns that are empty', () => {
    expect(
      warn([
        {
          list_name: 'g',
          name: 'm',
          'label::English': 'Male',
          'label::Deutsch': '',
        },
      ]),
    ).toEqual(['choice "m" (list "g") has no label in: Deutsch']);
  });

  test('still warns when every label column is empty', () => {
    expect(
      warn([{ list_name: 'g', name: 'm', 'label::English': ' ' }]),
    ).toEqual(['choice "m" (list "g") has no label']);
  });
});

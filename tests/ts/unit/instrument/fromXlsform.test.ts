/** XLSForm sheets → Instrument (#69, phase 1). */
import { describe, expect, test } from 'vitest';

import { instrumentFromXlsform } from '../../../../src/instrument/fromXlsform.js';
import type {
  GroupItem,
  QuestionItem,
} from '../../../../src/instrument/types.js';

describe('instrumentFromXlsform', () => {
  test('groups become a tree; questions keep their XLSForm vocabulary', () => {
    const ins = instrumentFromXlsform([
      { type: 'text', name: 'top', label: 'Top?' },
      {
        type: 'begin_group',
        name: 'g',
        label: 'G',
        appearance: 'Field-List ',
        relevant: " ${top} != '' ",
      },
      {
        type: 'select_one yn or_other',
        name: 'q',
        label: 'Q?',
        required: 'yes',
      },
      { type: 'begin group', name: 'inner', label: 'Inner' },
      {
        type: 'select_multiple_from_file iso_3166_1.csv',
        name: 'c',
        label: 'C?',
      },
      { type: 'end group' },
      { type: 'end_group' },
    ]);
    expect(ins.body.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'question:top',
      'group:g',
    ]);
    const g = ins.body[1] as GroupItem;
    expect(g).toMatchObject({
      appearance: 'field-list',
      relevant: "${top} != ''",
    });
    const q = g.children[0] as QuestionItem;
    expect(q).toMatchObject({
      type: 'select_one',
      list: 'yn',
      orOther: true,
      required: true,
    });
    const c = (g.children[1] as GroupItem).children[0] as QuestionItem;
    expect(c).toMatchObject({
      type: 'select_multiple_from_file',
      list: '',
      file: 'iso_3166_1.csv',
    });
  });

  test('text from label::<lang> columns and from the loader’s maps', () => {
    const cols = instrumentFromXlsform(
      [
        {
          type: 'text',
          name: 'q',
          'label::Deutsch (de)': 'Frage',
          'label::English (en)': 'Question',
          'hint::Deutsch (de)': 'Hinweis',
        },
      ],
      [],
      [{ default_language: 'Deutsch (de)' }],
    );
    expect(cols.languages).toEqual(['de', 'en']);
    expect(cols.defaultLanguage).toBe('de');
    expect(cols.body[0]).toMatchObject({
      label: { de: 'Frage', en: 'Question' },
      hint: { de: 'Hinweis' },
    });

    const maps = instrumentFromXlsform([
      { type: 'text', name: 'q', label: { en: 'Question', es: 'Pregunta' } },
    ]);
    expect(maps.languages).toEqual(['en', 'es']);
    expect(maps.body[0].label).toEqual({ en: 'Question', es: 'Pregunta' });

    expect(
      instrumentFromXlsform([{ type: 'text', name: 'q', label: 'Q?' }])
        .languages,
    ).toEqual(['']);
  });

  test('guidance_hint: the column, else parameters', () => {
    const ins = instrumentFromXlsform([
      { type: 'text', name: 'a', guidance_hint: 'Col' },
      { type: 'text', name: 'b', parameters: 'x=1; guidance_hint=From params' },
    ]);
    expect(ins.body.map((q) => (q as QuestionItem).guidanceHint)).toEqual([
      { '': 'Col' },
      { '': 'From params' },
    ]);
  });

  test('choice lists by name, in sheet order', () => {
    const ins = instrumentFromXlsform(
      [],
      [
        { list_name: 'yn', name: 'y', label: 'Ja' },
        { list_name: 'c', name: 'r', 'label::en': 'Red' },
        { list_name: 'yn', name: 'n', label: 'Nein' },
      ],
    );
    expect(Object.keys(ins.lists)).toEqual(['yn', 'c']);
    expect(ins.lists.yn.map((c) => c.name)).toEqual(['y', 'n']);
    expect(ins.lists.c[0].label).toEqual({ en: 'Red' });
  });
});

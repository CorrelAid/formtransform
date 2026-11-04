/**
 * #226: an appearance can select a LimeSurvey question theme (registry
 * `lsQuestionTheme`). `autocomplete` → `!` + `question_theme_name =
 * bootstrap_dropdown` + `show_search = true`, LimeSurvey's searchable
 * dropdown; `minimal` stays a plain `!`. The way back reads the theme.
 */
import { describe, expect, test } from 'vitest';

import {
  APPEARANCES,
  lstsvToDdi,
  lstsvToXlsform,
  parseLstsv,
  validateLstsvSubset,
  xlsformToLstsv,
} from '../../../src/index.js';
import { ATTRIBUTE_COLUMNS } from '../../../src/lstsv/columns.js';

const choices = [
  { list_name: 'land', name: 'de', label: 'Deutschland' },
  { list_name: 'land', name: 'fr', label: 'Frankreich' },
];

const form = (type: string, appearance: string) => ({
  surveyData: [{ type, name: 'land', label: 'Land?', appearance }],
  choicesData: choices,
});

const kommunen = [
  { list_name: 'kommunen.csv', name: '059700040040', label: 'Gemeinde A' },
  { list_name: 'kommunen.csv', name: '059700040041', label: 'Gemeinde B' },
];

async function toTsv(type: string, appearance: string): Promise<string> {
  return xlsformToLstsv(form(type, appearance), {
    fileChoices: { 'kommunen.csv': kommunen },
    onWarning: () => {},
  });
}

function questionRow(tsv: string): Record<string, string> {
  return parseLstsv(tsv).find((r) => r.class === 'Q')!;
}

/** Rewrite one Q-row cell of a TSV (as a LimeSurvey export might differ). */
function withCell(tsv: string, column: string, value: string): string {
  const lines = tsv.split('\n');
  const header = lines[0].split('\t');
  const col = header.indexOf(column);
  return lines
    .map((line) => {
      const cells = line.split('\t');
      if (cells[0] !== 'Q') return line;
      cells[col] = value;
      return cells.join('\t');
    })
    .join('\n');
}

describe('appearance → LimeSurvey question theme (#226)', () => {
  test.each(['select_one land', 'select_one_from_file kommunen.csv'])(
    '%s with autocomplete: ! + bootstrap_dropdown + show_search=true',
    async (type) => {
      const q = questionRow(await toTsv(type, 'autocomplete'));
      expect(q['type/scale']).toBe('!');
      expect(q.question_theme_name).toBe('bootstrap_dropdown');
      expect(q.show_search).toBe('true');
      expect(q.width_entry).toBe('true');
    },
  );

  test('minimal stays a plain dropdown: no theme columns at all', async () => {
    const tsv = await toTsv('select_one land', 'minimal');
    expect(questionRow(tsv)['type/scale']).toBe('!');
    const header = tsv.split('\n')[0].split('\t');
    expect(header).not.toContain('question_theme_name');
    expect(header).not.toContain('show_search');
  });

  test('minimal autocomplete: the searchable dropdown', async () => {
    const q = questionRow(
      await toTsv('select_one land', 'minimal autocomplete'),
    );
    expect(q['type/scale']).toBe('!');
    expect(q.question_theme_name).toBe('bootstrap_dropdown');
  });

  test('autocomplete on a type it is not valid for writes no theme', async () => {
    const tsv = await toTsv('text', 'autocomplete');
    expect(questionRow(tsv)['type/scale']).toBe('S');
    expect(tsv.split('\n')[0]).not.toContain('question_theme_name');
  });

  test('every theme column the registry names is a TSV column', () => {
    const columns = new Set<string>(ATTRIBUTE_COLUMNS);
    for (const spec of Object.values(APPEARANCES)) {
      const theme = spec.lsQuestionTheme;
      if (!theme) continue;
      expect(columns).toContain('question_theme_name');
      for (const attr of Object.keys(theme.attributes ?? {})) {
        expect(columns).toContain(attr);
      }
    }
  });

  test('the lstsv subset validation accepts the theme columns', async () => {
    const rows = parseLstsv(await toTsv('select_one land', 'autocomplete'));
    expect(validateLstsvSubset(rows)).toEqual([]);
  });
});

describe('LimeSurvey question theme → appearance (#226)', () => {
  test.each([
    ['select_one land', 'select_one land'],
    ['select_one_from_file kommunen.csv', 'select_one_from_file kommunen.csv'],
  ])('%s autocomplete round-trips as autocomplete', async (type, back) => {
    const out = lstsvToXlsform(await toTsv(type, 'autocomplete'), {
      skipValidation: true,
    });
    expect(out.survey[0]).toMatchObject({
      type: back,
      appearance: 'autocomplete',
    });
  });

  test('minimal round-trips as minimal', async () => {
    const out = lstsvToXlsform(await toTsv('select_one land', 'minimal'), {
      skipValidation: true,
    });
    expect(out.survey[0]).toMatchObject({ appearance: 'minimal' });
  });

  test('bootstrap_dropdown without show_search reads back as minimal', async () => {
    const tsv = withCell(
      await toTsv('select_one land', 'autocomplete'),
      'show_search',
      '',
    );
    const out = lstsvToXlsform(tsv, { skipValidation: true });
    expect(out.survey[0]).toMatchObject({ appearance: 'minimal' });
  });

  test('a 0.11.0 TSV without width_entry still reads back as autocomplete', async () => {
    const tsv = withCell(
      await toTsv('select_one land', 'autocomplete'),
      'width_entry',
      '',
    );
    const out = lstsvToXlsform(tsv, { skipValidation: true });
    expect(out.survey[0]).toMatchObject({ appearance: 'autocomplete' });
  });

  test('show_search stored as 1 still reads back as autocomplete', async () => {
    const tsv = withCell(
      await toTsv('select_one land', 'autocomplete'),
      'show_search',
      '1',
    );
    const out = lstsvToXlsform(tsv, { skipValidation: true });
    expect(out.survey[0]).toMatchObject({ appearance: 'autocomplete' });
  });

  test('another theme on a dropdown reads back as minimal', async () => {
    const tsv = withCell(
      await toTsv('select_one land', 'autocomplete'),
      'question_theme_name',
      'some_custom_theme',
    );
    const out = lstsvToXlsform(tsv, { skipValidation: true });
    expect(out.survey[0]).toMatchObject({ appearance: 'minimal' });
  });

  test('DDI from the TSV carries the appearance as autocomplete', async () => {
    const ddi = lstsvToDdi(await toTsv('select_one land', 'autocomplete'));
    expect(ddi).toMatch(/autocomplete/);
    expect(ddi).not.toMatch(/bootstrap_dropdown/);
  });
});

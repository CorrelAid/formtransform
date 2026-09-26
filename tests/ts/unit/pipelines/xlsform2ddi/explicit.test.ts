/** DDI output that only snapshots covered, asserted explicitly (#107). */
import { describe, expect, test } from 'vitest';

import { buildDdiCodebook } from '../../../../../src/ddi/index.js';
import type { Variable } from '../../../../../src/ddi/types.js';
import { buildDataCsv } from '../../../../../src/ddi/data.js';
import {
  DDI_TYPE_MAP,
  RESPONSE_DOMAIN_MAP,
} from '../../../../../src/generated/DdiMappings.js';
import { buildDdiXml } from '../../../../../src/pipelines/xlsform2ddi/index.js';
import {
  choicesByListFromRows,
  extractVariables,
} from '../../../../../src/pipelines/xlsform2ddi/variables.js';

type Row = Record<string, unknown>;

const yn = [
  { list_name: 'l', name: 'y', label: 'Ja' },
  { list_name: 'l', name: 'n', label: 'Nein' },
];

/** `{intrvl, format, domain}` of the <var name="…"> in `xml`. */
function varShape(xml: string, name: string) {
  const el = new RegExp(`<var [^>]*name="${name}"[\\s\\S]*?</var>`).exec(
    xml,
  )?.[0];
  if (!el) throw new Error(`no var ${name}`);
  return {
    intrvl: /intrvl="([^"]+)"/.exec(el)?.[1],
    format: /<varFormat type="([^"]+)"/.exec(el)?.[1],
    domain: /responseDomainType="([^"]+)"/.exec(el)?.[1],
  };
}

const varNames = (xml: string) =>
  [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);

function v(
  partial: Partial<Variable> & { name: string; type: string },
): Variable {
  return {
    label: 'L',
    group: '',
    groupLabel: '',
    groupAppearance: '',
    listName: '',
    vocab: '',
    choices: [],
    ...partial,
  };
}

// Numeric codes, so a categorical type keeps its registry format.
const nums = [
  { list_name: 'l', name: '1', label: 'Eins' },
  { list_name: 'l', name: '2', label: 'Zwei' },
];

describe('intrvl / varFormat / responseDomainType per type', () => {
  const rowFor = (type: string): Row => {
    if (type.endsWith('_from_file'))
      return { type: `${type} iso_3166_1.csv`, name: 'q', label: 'Q?' };
    if (type.startsWith('select_'))
      return { type: `${type} l`, name: 'q', label: 'Q?' };
    return { type, name: 'q', label: 'Q?' };
  };

  test.each(
    Object.entries(DDI_TYPE_MAP).filter(
      ([t]) => t !== 'select_multiple' && !t.endsWith('_from_file'),
    ),
  )('%s', (type, [intrvl, format]) => {
    const xml = buildDdiXml([rowFor(type)], nums);
    expect(varShape(xml, 'q')).toEqual({
      intrvl,
      format,
      domain: RESPONSE_DOMAIN_MAP[type],
    });
  });

  test('select_multiple: one discrete numeric binary per option', () => {
    const xml = buildDdiXml([rowFor('select_multiple')], yn);
    expect(varShape(xml, 'q_y')).toEqual({
      intrvl: 'discrete',
      format: 'numeric',
      domain: 'multiple',
    });
  });

  test('a categorical variable with non-numeric codes is character (#119)', () => {
    expect(varShape(buildDdiXml([rowFor('select_one')], yn), 'q').format).toBe(
      'character',
    );
    expect(
      varShape(buildDdiXml([rowFor('select_one')], nums), 'q').format,
    ).toBe('numeric');
    // ISO 3166 codes (DE, FR, …): the registered vocabulary decides.
    expect(
      varShape(buildDdiXml([rowFor('select_one_from_file')], []), 'q').format,
    ).toBe('character');
    // select_multiple binaries stay 0/1 numeric whatever the codes.
    expect(
      varShape(buildDdiXml([rowFor('select_multiple')], yn), 'q_y').format,
    ).toBe('numeric');
  });

  test('a type outside the map falls back to discrete / character / text', () => {
    const xml = buildDdiCodebook([
      v({ name: 'q', type: 'unknown' }),
    ]).toDocument();
    expect(varShape(xml, 'q')).toEqual({
      intrvl: 'discrete',
      format: 'character',
      domain: 'text',
    });
  });
});

describe('variables', () => {
  test('or_other with an authored q_other gives exactly one companion', () => {
    const xml = buildDdiXml(
      [
        { type: 'select_one l or_other', name: 'q', label: 'Q?' },
        {
          type: 'text',
          name: 'q_other',
          label: 'Welche?',
          relevant: "${q} = 'other'",
        },
      ],
      yn,
    );
    expect(varNames(xml).filter((n) => n === 'q_other')).toHaveLength(1);
    expect(xml).toContain('<qstnLit>Welche?</qstnLit>');
  });

  test('an appearance=label header row is no variable and no CSV column', () => {
    const survey = [
      { type: 'begin_group', name: 'g', label: 'G', appearance: 'field-list' },
      {
        type: 'select_one l',
        name: 'header',
        label: 'Header',
        appearance: 'label',
      },
      {
        type: 'select_one l',
        name: 'a',
        label: 'A',
        appearance: 'list-nolabel',
      },
      { type: 'end_group' },
    ];
    const xml = buildDdiXml(survey, yn);
    expect(varNames(xml)).not.toContain('header');
    const vars = extractVariables(survey, choicesByListFromRows(yn));
    const header = buildDataCsv(vars, [{ a: 'y' }]).split('\r\n')[0];
    expect(header.split(',')).toEqual(['a']);
  });
});

describe('notes', () => {
  test('a note before a grid or multiple choice goes to the group, not a member', () => {
    const xml = buildDdiXml(
      [
        { type: 'note', name: 'lead', label: 'Zu Medien' },
        { type: 'select_multiple l', name: 'm', label: 'Welche?' },
      ],
      yn,
    );
    expect(xml).toMatch(
      /<varGrp [^>]*name="m"[\s\S]*?<notes>Zu Medien<\/notes>[\s\S]*?<\/varGrp>/,
    );
    expect(xml).not.toContain('<preQTxt>Zu Medien');
  });

  test('a grid member hint is dropped (its preQTxt is the grid text)', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'begin_group',
          name: 'g',
          label: 'Vertrauen',
          appearance: 'table-list',
        },
        { type: 'select_one l', name: 'a', label: 'A', hint: 'Hinweis' },
        { type: 'select_one l', name: 'b', label: 'B' },
        { type: 'end_group' },
      ],
      yn,
    );
    expect(xml).not.toContain('Hinweis');
    expect(
      [...xml.matchAll(/<preQTxt>([^<]*)<\/preQTxt>/g)].map((m) => m[1]),
    ).toEqual(['Vertrauen', 'Vertrauen']);
  });

  // XLSForm requires a name: a nameless note is dropped; an empty one emits nothing.
  test('orphan notes with an empty label or name', () => {
    const xml = buildDdiXml(
      [
        { type: 'text', name: 'q', label: 'Q?' },
        { type: 'note', name: 'n1', label: '' },
        { type: 'note', name: '', label: 'Ohne Namen' },
      ],
      [],
    );
    expect(xml).not.toContain('Ohne Namen');
    expect(xml).not.toMatch(/<notes[^>]*><\/notes>/);
  });
});

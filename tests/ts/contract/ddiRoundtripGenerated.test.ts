/**
 * The DDI round trips on generated forms (#154, #160): random valid
 * XLSForms from the registry's types, with groups, grids, matrices,
 * languages, logic, fields, named and shared lists, `or_other` and explicit
 * other pairs, runs of notes (with blank lines, in only some languages),
 * groups of notes only or without a label, metadata rows, `required`
 * spellings, messages without a constraint and settings. Compared as `ddiRoundtrip.test.ts` and
 * `lstsvDdiRoundtrip.test.ts` do.
 */
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../src/pipelines/ddi2xlsform/index.js';
import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { lstsvToDdiXml } from '../../../src/pipelines/lstsv2ddi/index.js';
import { instrumentFromDdi } from '../../../src/instrument/fromDdi.js';
import { instrumentFromLstsv } from '../../../src/instrument/fromLstsv.js';
import { instrumentFromXlsform } from '../../../src/instrument/fromXlsform.js';
import { parseLstsv } from '../../../src/lstsv/parser.js';
import type {
  ChoiceRow,
  SettingsRow,
  SurveyRow,
} from '../../../src/xlsform/types.js';
import { canonical } from './canonicalInstrument.js';

type Row = Record<string, unknown>;

const LANGS = ['Deutsch (de)', 'English (en)'];
/** Runs per property; `FT_ROUNDTRIP_RUNS=5000` for a longer search. */
const RUNS = Number(process.env['FT_ROUNDTRIP_RUNS'] ?? 200);
/** The LimeSurvey paths convert twice more. */
const LS_RUNS = Math.ceil(RUNS / 2);
const quiet = () => {};

/** A text that survives XML and isn't read as HTML. */
const word = fc
  .stringMatching(/^[A-Za-z0-9äöüß&"' ?.,-]{1,24}$/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

interface Texts {
  one: string;
  de: string;
  en: string;
}
const texts: fc.Arbitrary<Texts> = fc.record({ one: word, de: word, en: word });

const SIMPLE = ['text', 'integer', 'decimal', 'date', 'time', 'range'];
const METADATA = ['start', 'end', 'today', 'deviceid'];
const RANGE_PARAMETERS = ['start=0 end=20 step=2', 'start=1 end=10', 'step=1'];

type Question =
  | {
      kind: 'simple';
      type: string;
      t: Texts;
      hint?: Texts;
      required?: string;
      ref: boolean;
      constraint: boolean;
      /** A constraint_message without a constraint. */
      message: boolean;
      appearance: boolean;
      params?: string;
    }
  | {
      kind: 'select';
      multiple: boolean;
      t: Texts;
      choices: Texts[];
      /** Name the list apart from the question, or share the last one. */
      list: 'own' | 'named' | 'shared';
      other: 'none' | 'shorthand' | 'pair';
      exclusive: boolean;
      ref: boolean;
    }
  | {
      kind: 'note';
      t: Texts;
      hint?: Texts;
      ref: boolean;
      /** Its text has a blank line. */
      paragraphs: boolean;
      /** Only the first language has it. */
      partial: boolean;
    }
  | { kind: 'metadata'; type: string };

const question: fc.Arbitrary<Question> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('simple' as const),
      type: fc.constantFrom(...SIMPLE),
      t: texts,
      hint: fc.option(texts, { nil: undefined }),
      required: fc.option(fc.constantFrom('yes', 'TRUE', 'true'), {
        nil: undefined,
      }),
      ref: fc.boolean(),
      constraint: fc.boolean(),
      message: fc.boolean(),
      appearance: fc.boolean(),
      params: fc.option(fc.constantFrom(...RANGE_PARAMETERS), {
        nil: undefined,
      }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('select' as const),
      multiple: fc.boolean(),
      t: texts,
      choices: fc.array(texts, { minLength: 1, maxLength: 4 }),
      list: fc.constantFrom(
        'own' as const,
        'named' as const,
        'shared' as const,
      ),
      other: fc.constantFrom(
        'none' as const,
        'shorthand' as const,
        'pair' as const,
      ),
      exclusive: fc.boolean(),
      ref: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('note' as const),
      t: texts,
      hint: fc.option(texts, { nil: undefined }),
      ref: fc.boolean(),
      paragraphs: fc.boolean(),
      partial: fc.boolean(),
    }),
  },
  fc.record({
    kind: fc.constant('metadata' as const),
    type: fc.constantFrom(...METADATA),
  }),
);

type Block =
  | { kind: 'question'; q: Question }
  | {
      kind: 'group';
      t: Texts;
      unlabelled: boolean;
      relevant: boolean;
      inner: Question[];
      nested: Question[];
    }
  | { kind: 'grid'; t: Texts; choices: Texts[]; rows: Texts[] }
  | { kind: 'matrix'; t: Texts; choices: Texts[]; rows: Texts[] };

const block: fc.Arbitrary<Block> = fc.oneof(
  {
    weight: 4,
    arbitrary: question.map((q) => ({ kind: 'question' as const, q })),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('group' as const),
      t: texts,
      unlabelled: fc.boolean(),
      relevant: fc.boolean(),
      inner: fc.array(question, { minLength: 1, maxLength: 3 }),
      nested: fc.array(question, { maxLength: 2 }),
    }),
  },
  fc.record({
    kind: fc.constant('grid' as const),
    t: texts,
    choices: fc.array(texts, { minLength: 1, maxLength: 3 }),
    rows: fc.array(texts, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('matrix' as const),
    t: texts,
    choices: fc.array(texts, { minLength: 1, maxLength: 3 }),
    rows: fc.array(texts, { minLength: 1, maxLength: 3 }),
  }),
);

const form = fc.record({
  multilingual: fc.boolean(),
  settings: fc.record({
    form_title: fc.option(word, { nil: undefined }),
    form_id: fc.option(fc.constantFrom('f1', 'survey_2'), { nil: undefined }),
    version: fc.option(fc.constantFrom('1', '2024-01'), { nil: undefined }),
    style: fc.option(fc.constant('pages'), { nil: undefined }),
  }),
  blocks: fc.array(block, { minLength: 1, maxLength: 6 }),
});

type Form = typeof form extends fc.Arbitrary<infer F> ? F : never;

/** Serialize a generated form to XLSForm rows. */
function sheets(f: Form) {
  const survey: Row[] = [];
  const choices: Row[] = [];
  let n = 0;
  let lastList = '';
  const numbers: string[] = [];
  const answered: string[] = [];
  const put = (row: Row, column: string, t: Texts) => {
    if (f.multilingual) {
      row[`${column}::${LANGS[0]}`] = t.de;
      row[`${column}::${LANGS[1]}`] = t.en;
    } else row[column] = t.one;
  };
  const list = (name: string, items: Texts[], exclusive: boolean) =>
    items.forEach((t, i) => {
      const row: Row = { list_name: name, name: `c${i + 1}` };
      put(row, 'label', t);
      if (exclusive && i === items.length - 1 && items.length > 1) {
        row['exclusive'] = 'yes';
      }
      choices.push(row);
    });
  const condition = () =>
    numbers.length ? `\${${numbers[0]}} > 3` : undefined;
  const addSelect = (
    q: Extract<Question, { kind: 'select' }>,
    name: string,
  ) => {
    const row: Row = { name };
    put(row, 'label', q.t);
    let listName = q.list === 'named' ? `l_${name}` : name;
    if (q.list === 'shared' && lastList) listName = lastList;
    else {
      list(listName, q.choices, q.multiple && q.exclusive);
      if (q.other === 'pair') {
        const other: Row = { list_name: listName, name: 'other' };
        put(other, 'label', q.t);
        choices.push(other);
      }
      lastList = listName;
    }
    const base = q.multiple ? 'select_multiple' : 'select_one';
    const shorthand = q.other === 'shorthand' ? ' or_other' : '';
    row.type = `${base} ${listName}${shorthand}`;
    if (q.ref && answered.length) row.relevant = `\${${answered[0]}} != ''`;
    survey.push(row);
    if (q.other === 'pair' && !(q.list === 'shared' && lastList !== listName)) {
      const companion: Row = {
        type: 'text',
        name: `${name}_other`,
        relevant: q.multiple
          ? `selected(\${${name}}, 'other')`
          : `\${${name}} = 'other'`,
      };
      put(companion, 'label', q.t);
      survey.push(companion);
    }
  };
  const addQuestion = (q: Question) => {
    const name = `q${++n}`;
    if (q.kind === 'metadata') {
      survey.push({ type: q.type, name });
      return;
    }
    if (q.kind === 'select') {
      addSelect(q, name);
      answered.push(name);
      return;
    }
    const row: Row = { name };
    if (q.kind === 'note') {
      const t = q.paragraphs
        ? {
            one: `${q.t.one}\n\n${q.t.en}`,
            de: `${q.t.de}\n\n${q.t.en}`,
            en: q.t.en,
          }
        : q.t;
      if (q.partial && f.multilingual) row[`label::${LANGS[0]}`] = t.de;
      else put(row, 'label', t);
      row.type = 'note';
      if (q.hint) put(row, 'hint', q.hint);
      const c = q.ref ? condition() : undefined;
      if (c) row.relevant = c;
      survey.push(row);
      return;
    }
    put(row, 'label', q.t);
    row.type = q.type;
    if (q.hint) put(row, 'hint', q.hint);
    if (q.required) row.required = q.required;
    const c = q.ref ? condition() : undefined;
    if (c) row.relevant = c;
    if (q.constraint && q.type === 'integer') {
      row.constraint = '. >= 1 and . <= 10';
      put(row, 'constraint_message', q.t);
    } else if (q.message) {
      put(row, 'constraint_message', q.t);
    }
    if (q.appearance && q.type === 'text') row.appearance = 'multiline';
    if (q.params && q.type === 'range') row.parameters = q.params;
    if (q.type === 'integer' || q.type === 'decimal') numbers.push(name);
    survey.push(row);
    answered.push(name);
  };
  const addRows = (
    b: Extract<Block, { kind: 'grid' | 'matrix' }>,
    name: string,
  ) => {
    list(name, b.choices, false);
    if (b.kind === 'matrix') {
      const header: Row = {
        type: `select_one ${name}`,
        name: `h${++n}`,
        appearance: 'label',
      };
      put(header, 'label', b.t);
      survey.push(header);
    }
    for (const r of b.rows) {
      const member: Row = { type: `select_one ${name}`, name: `q${++n}` };
      put(member, 'label', r);
      if (b.kind === 'matrix') member.appearance = 'list-nolabel';
      survey.push(member);
    }
  };
  for (const b of f.blocks) {
    if (b.kind === 'question') addQuestion(b.q);
    else if (b.kind === 'group') {
      const row: Row = { type: 'begin_group', name: `g${++n}` };
      if (!b.unlabelled) put(row, 'label', b.t);
      if (b.relevant && answered.length)
        row.relevant = `\${${answered[0]}} != ''`;
      survey.push(row);
      b.inner.forEach(addQuestion);
      if (b.nested.length) {
        const inner: Row = { type: 'begin_group', name: `g${++n}` };
        put(inner, 'label', b.t);
        survey.push(inner);
        b.nested.forEach(addQuestion);
        survey.push({ type: 'end_group' });
      }
      survey.push({ type: 'end_group' });
    } else {
      const name = `grid${++n}`;
      const row: Row = {
        type: 'begin_group',
        name,
        appearance: b.kind === 'grid' ? 'table-list' : 'field-list',
      };
      put(row, 'label', b.t);
      survey.push(row);
      addRows(b, name);
      survey.push({ type: 'end_group' });
    }
  }
  const settings: Row = Object.fromEntries(
    Object.entries(f.settings).filter(([, v]) => v !== undefined),
  );
  if (f.multilingual) settings.default_language = LANGS[0];
  return {
    survey,
    choices,
    settings: Object.keys(settings).length ? [settings] : [],
  };
}

type Sheets = ReturnType<typeof sheets>;

function codebook(s: Pick<Sheets, 'survey' | 'choices' | 'settings'>) {
  return buildDdiXml(s.survey, s.choices, {
    prodDate: '2020-01-01',
    settings: s.settings[0] ?? {},
  });
}

const model = (s: {
  survey: unknown[];
  choices: unknown[];
  settings: unknown[];
}) =>
  canonical(
    instrumentFromXlsform(
      s.survey as Row[],
      s.choices as Row[],
      s.settings as Row[],
    ),
  );

/** The form's LimeSurvey TSV, or `null` for one LimeSurvey can't hold. */
async function toTsv(s: {
  survey: unknown[];
  choices: unknown[];
  settings: unknown[];
}): Promise<string | null> {
  try {
    return await new XLSFormToTSVConverter().convert(
      s.survey as SurveyRow[],
      s.choices as ChoiceRow[],
      s.settings as SettingsRow[],
    );
  } catch {
    return null;
  }
}

describe('generated forms', () => {
  test('XLSForm → DDI → Instrument gives the form back', () => {
    fc.assert(
      fc.property(form, (f) => {
        const s = sheets(f);
        expect(canonical(instrumentFromDdi(codebook(s)))).toEqual(model(s));
      }),
      { numRuns: RUNS },
    );
  });

  test('XLSForm → DDI → XLSForm gives the form back', () => {
    fc.assert(
      fc.property(form, (f) => {
        const s = sheets(f);
        expect(model(ddiToXlsform(codebook(s)))).toEqual(model(s));
      }),
      { numRuns: RUNS },
    );
  });

  test('DDI → XLSForm → DDI gives the same codebook', () => {
    fc.assert(
      fc.property(form, (f) => {
        const xml = codebook(sheets(f));
        expect(codebook(ddiToXlsform(xml))).toBe(xml);
      }),
      { numRuns: RUNS },
    );
  });

  test('XLSForm → DDI → XLSForm → LimeSurvey is XLSForm → LimeSurvey', async () => {
    let converted = 0;
    await fc.assert(
      fc.asyncProperty(form, async (f) => {
        const s = sheets(f);
        const tsv = await toTsv(s);
        if (tsv === null) return;
        converted++;
        expect(await toTsv(ddiToXlsform(codebook(s)))).toBe(tsv);
      }),
      { numRuns: LS_RUNS },
    );
    expect(converted).toBeGreaterThan(LS_RUNS / 2);
  });

  test('XLSForm → LimeSurvey → DDI → XLSForm is XLSForm → LimeSurvey → XLSForm', async () => {
    await fc.assert(
      fc.asyncProperty(form, async (f) => {
        const tsv = await toTsv(sheets(f));
        if (tsv === null) return;
        const xml = lstsvToDdiXml(tsv, {
          prodDate: '2020-01-01',
          onWarning: quiet,
        });
        expect(model(ddiToXlsform(xml))).toEqual(model(lstsvToXlsform(tsv)));
        // And the TSV's own model, straight from the codebook.
        expect(canonical(instrumentFromDdi(xml))).toEqual(
          canonical(
            instrumentFromLstsv(parseLstsv(tsv), {
              expressions: true,
              onWarning: quiet,
            }),
          ),
        );
      }),
      { numRuns: LS_RUNS },
    );
  });
});

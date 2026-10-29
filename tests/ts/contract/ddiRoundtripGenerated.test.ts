/**
 * The DDI round trips on generated forms (#154, #160): random valid
 * XLSForms from the registry's types, with groups, grids, tables of
 * numbers (#174) and table-list groups that are no grid, matrices,
 * languages, logic, fields, named and shared lists, `or_other` and explicit
 * other pairs, runs of notes (with blank lines, in only some languages),
 * groups of notes only or without a label, a group's hint and
 * guidance_hint (#179) and question-only cells on a group, short labels
 * (`label_short`, #181) on rows of every kind, metadata rows,
 * `required` spellings, messages without a constraint, `concept` columns (#173) and
 * settings. Compared as `ddiRoundtrip.test.ts` and
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
import {
  instrumentFromXlsform,
  languageNamesOf,
} from '../../../src/instrument/fromXlsform.js';
import { parseLstsv } from '../../../src/lstsv/parser.js';
import { allColumns } from '../../../src/conventions/columns.js';
import conventions from '../../../src/generated/conventions.js';
import { languageTagOf } from '../../../src/utils/languageUtils.js';
import type {
  ChoiceRow,
  SettingsRow,
  SurveyRow,
} from '../../../src/xlsform/types.js';
import { canonical } from './canonicalInstrument.js';

type Row = Record<string, unknown>;

/** The language columns' suffixes: named as most forms do, or bare tags. */
const NAMED = ['Deutsch (de)', 'English (en)'];
const BARE = ['de', 'en'];
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
      hint?: Texts;
      guidance?: Texts;
      /** `required` and `parameters` on the begin_group row: its columns (#179). */
      questionCells: boolean;
      inner: Question[];
      nested: Question[];
    }
  | {
      kind: 'grid';
      t: Texts;
      choices: Texts[];
      rows: Texts[];
      /** A note row before the last row, not only the first (#174). */
      note?: Texts;
    }
  | {
      kind: 'table';
      t: Texts;
      /** Integer rows, a decimal one where `true`. */
      rows: Array<{ t: Texts; decimal: boolean }>;
      /** A text row too: rows no grid has, so a section (#174). */
      text: boolean;
      /** A note row before the last row ("davon: …"), not only the first. */
      note?: Texts;
    }
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
      hint: fc.option(texts, { nil: undefined }),
      guidance: fc.option(texts, { nil: undefined }),
      questionCells: fc.boolean(),
      inner: fc.array(question, { maxLength: 3 }),
      nested: fc.array(question, { maxLength: 2 }),
    }),
  },
  fc.record({
    kind: fc.constant('grid' as const),
    t: texts,
    choices: fc.array(texts, { minLength: 1, maxLength: 3 }),
    rows: fc.array(texts, { minLength: 1, maxLength: 3 }),
    note: fc.option(texts, { nil: undefined }),
  }),
  fc.record({
    kind: fc.constant('table' as const),
    t: texts,
    rows: fc.array(fc.record({ t: texts, decimal: fc.boolean() }), {
      minLength: 1,
      maxLength: 3,
    }),
    text: fc.boolean(),
    note: fc.option(texts, { nil: undefined }),
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
  /** `label::Deutsch (de)` or `label::de` (#183). */
  named: fc.boolean(),
  /** Columns the model doesn't lift, on some rows of both sheets. */
  columns: fc.boolean(),
  /** `label_short` on some rows of every kind (#181). */
  short: fc.boolean(),
  settings: fc.record({
    form_title: fc.option(word, { nil: undefined }),
    form_id: fc.option(fc.constantFrom('f1', 'survey_2'), { nil: undefined }),
    version: fc.option(fc.constantFrom('1', '2024-01'), { nil: undefined }),
    style: fc.option(fc.constant('pages'), { nil: undefined }),
  }),
  /** `form_subtitle` / `form_title_short` (#181), per language or plain. */
  titles: fc.option(
    fc.record({ subtitle: texts, short: texts, localized: fc.boolean() }),
    { nil: undefined },
  ),
  blocks: fc.array(block, { minLength: 1, maxLength: 6 }),
});

type Form = typeof form extends fc.Arbitrary<infer F> ? F : never;

/**
 * Columns the model doesn't lift, on every other row: media (per language
 * in a multilingual form), `read_only`, `choice_filter`, a choice filter.
 */
function addColumns(
  survey: Row[],
  choices: Row[],
  multilingual: boolean,
  LANGS: string[],
) {
  const media = (row: Row, file: string) => {
    if (multilingual) {
      row[`media::image::${LANGS[0]}`] = `${file}-de.png`;
      row[`media::image::${LANGS[1]}`] = `${file}-en.png`;
    } else row['media::image'] = `${file}.png`;
  };
  survey.forEach((row, i) => {
    const type = String(row['type']);
    if (type === 'end_group') {
      if (i % 2 === 0) row['$kuid'] = `k${i}`;
      return;
    }
    // The appearance cell's case, as some authors write it.
    if (typeof row['appearance'] === 'string' && i % 3 === 2) {
      const a = row['appearance'];
      row['appearance'] = a.charAt(0).toUpperCase() + a.slice(1);
    }
    if (i % 2 === 0) media(row, String(row['name']));
    // What a row measures, on some rows of every kind (#173).
    // In a multilingual form: the base language's, both, an untagged
    // column (the base's), or only the second language's.
    if (i % 3 === 1) {
      const variant = Math.floor(i / 3) % 4;
      if (!multilingual) row['concept'] = `Concept ${i}`;
      else if (variant === 2) row['concept'] = `Konzept ${i}`;
      else {
        if (variant !== 3) row[`concept::${LANGS[0]}`] = `Konzept ${i}`;
        if (variant !== 0) row[`concept::${LANGS[1]}`] = `Concept ${i}`;
      }
    }
    if (type === 'text' && i % 3 === 0) row['read_only'] = 'yes';
    if (type.startsWith('select_one') && i % 3 === 1) {
      row['choice_filter'] = "filter = 'a'";
    }
  });
  choices.forEach((row, i) => {
    if (i % 2 === 0)
      media(row, `${String(row['list_name'])}_${String(row['name'])}`);
    if (i % 3 === 0) row['filter'] = 'a';
  });
}

/**
 * A short label (#181) on every other row but `end_group`: the labl of a
 * group's, select_multiple's or semi-open question's varGrp, a column on any
 * other row. In a multilingual form: both languages, or only the base's.
 */
function addShortLabels(survey: Row[], multilingual: boolean, LANGS: string[]) {
  survey.forEach((row, i) => {
    if (row['type'] === 'end_group' || i % 2 === 0) return;
    if (!multilingual) row['label_short'] = `S${i}`;
    else {
      row[`label_short::${LANGS[0]}`] = `K${i}`;
      if (i % 4 === 1) row[`label_short::${LANGS[1]}`] = `S${i}`;
    }
  });
}

/** Serialize a generated form to XLSForm rows. */
function sheets(f: Form) {
  const LANGS = f.named ? NAMED : BARE;
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
    b.rows.forEach((r, i) => {
      // A note between a grid's rows (#174); a matrix's ends it.
      if (b.kind === 'grid' && b.note && i === b.rows.length - 1 && i > 0) {
        const note: Row = { type: 'note', name: `q${++n}` };
        put(note, 'label', b.note);
        survey.push(note);
      }
      const member: Row = { type: `select_one ${name}`, name: `q${++n}` };
      put(member, 'label', r);
      if (b.kind === 'matrix') member.appearance = 'list-nolabel';
      survey.push(member);
    });
  };
  for (const b of f.blocks) {
    if (b.kind === 'question') addQuestion(b.q);
    else if (b.kind === 'group') {
      const row: Row = { type: 'begin_group', name: `g${++n}` };
      if (!b.unlabelled) put(row, 'label', b.t);
      if (b.relevant && answered.length)
        row.relevant = `\${${answered[0]}} != ''`;
      if (b.hint) put(row, 'hint', b.hint);
      if (b.guidance) put(row, 'guidance_hint', b.guidance);
      if (b.questionCells) {
        row.required = 'yes';
        row.parameters = 'randomize=true';
      }
      survey.push(row);
      b.inner.forEach(addQuestion);
      if (b.nested.length) {
        const inner: Row = { type: 'begin_group', name: `g${++n}` };
        put(inner, 'label', b.t);
        if (b.guidance) put(inner, 'guidance_hint', b.guidance);
        survey.push(inner);
        b.nested.forEach(addQuestion);
        survey.push({ type: 'end_group' });
      }
      survey.push({ type: 'end_group' });
    } else if (b.kind === 'table') {
      const row: Row = {
        type: 'begin_group',
        name: `table${++n}`,
        appearance: 'table-list',
      };
      put(row, 'label', b.t);
      survey.push(row);
      b.rows.forEach((r, i) => {
        if (b.note && i === b.rows.length - 1 && i > 0) {
          const note: Row = { type: 'note', name: `q${++n}` };
          put(note, 'label', b.note);
          survey.push(note);
        }
        const member: Row = {
          type: r.decimal ? 'decimal' : 'integer',
          name: `q${++n}`,
        };
        put(member, 'label', r.t);
        survey.push(member);
      });
      if (b.text) {
        const other: Row = { type: 'text', name: `q${++n}` };
        put(other, 'label', b.t);
        survey.push(other);
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
  if (f.columns) addColumns(survey, choices, f.multilingual, LANGS);
  if (f.short) addShortLabels(survey, f.multilingual, LANGS);
  const settings: Row = Object.fromEntries(
    Object.entries(f.settings).filter(([, v]) => v !== undefined),
  );
  if (f.multilingual) settings.default_language = LANGS[0];
  if (f.titles) {
    const { subtitle, short, localized } = f.titles;
    // Per language only where the body has both (a language only the
    // settings have isn't one of the form's, as with form_title).
    const both = survey.some((r) => `label::${LANGS[1]}` in r);
    const value = (t: Texts) =>
      f.multilingual && localized && both
        ? { [LANGS[0]]: t.de, [LANGS[1]]: t.en }
        : t.one;
    settings.form_subtitle = value(subtitle);
    settings.form_title_short = value(short);
  }
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

/** Each language tag's name in the form's text columns (#183). */
const languageNames = (s: { survey: unknown[]; choices: unknown[] }) =>
  languageNamesOf([...(s.survey as Row[]), ...(s.choices as Row[])]);

/** A group's columns only a question's row lifts, and its guidance_hint. */
const GROUP_CELLS = new Set([
  'guidance_hint',
  ...conventions.conventions.ddiFields.liftedColumns.questionOnly,
]);

/**
 * Those cells of each `begin_group` row, read off the sheet (a language
 * by its tag): a cell the parser neither lifts nor keeps as a column is
 * missing from both models alike (#179).
 */
const groupCells = (s: { survey: unknown[] }) =>
  (s.survey as Row[])
    .filter((row) => row['type'] === 'begin_group')
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [column, cell] of Object.entries(allColumns(row))) {
        const [base, lang] = column.split('::');
        if (!GROUP_CELLS.has(base)) continue;
        out[lang ? `${base}::${languageTagOf(lang) ?? lang}` : base] = cell;
      }
      return out;
    });

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
        const back = ddiToXlsform(codebook(s));
        expect(model(back)).toEqual(model(s));
        expect(groupCells(back)).toEqual(groupCells(s));
        // The form's names for its languages, not only their tags (#183).
        // A form in one language comes back with plain columns.
        const names = languageNames(s);
        if (Object.keys(names).length > 1) {
          expect(languageNames(back)).toEqual(names);
        }
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

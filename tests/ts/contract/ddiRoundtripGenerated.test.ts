/**
 * The DDI round trip on generated forms (#154): random valid XLSForms from
 * the registry's types (groups, grids, languages, logic, fields) survive
 * XLSForm → DDI → Instrument, compared as `ddiRoundtrip.test.ts` does.
 */
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { instrumentFromDdi } from '../../../src/instrument/fromDdi.js';
import { instrumentFromXlsform } from '../../../src/instrument/fromXlsform.js';
import { canonical } from './canonicalInstrument.js';

type Row = Record<string, unknown>;

const LANGS = ['Deutsch (de)', 'English (en)'];

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

type Question =
  | {
      kind: 'simple';
      type: string;
      t: Texts;
      hint?: Texts;
      required: boolean;
      ref: boolean;
      constraint: boolean;
      appearance: boolean;
      params: boolean;
    }
  | {
      kind: 'select';
      multiple: boolean;
      t: Texts;
      choices: Texts[];
      orOther: boolean;
      exclusive: boolean;
      ref: boolean;
    }
  | { kind: 'note'; t: Texts };

const question: fc.Arbitrary<Question> = fc.oneof(
  fc.record({
    kind: fc.constant('simple' as const),
    type: fc.constantFrom(...SIMPLE),
    t: texts,
    hint: fc.option(texts, { nil: undefined }),
    required: fc.boolean(),
    ref: fc.boolean(),
    constraint: fc.boolean(),
    appearance: fc.boolean(),
    params: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant('select' as const),
    multiple: fc.boolean(),
    t: texts,
    choices: fc.array(texts, { minLength: 1, maxLength: 4 }),
    orOther: fc.boolean(),
    exclusive: fc.boolean(),
    ref: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('note' as const), t: texts }),
);

type Block =
  | { kind: 'question'; q: Question }
  | {
      kind: 'group';
      t: Texts;
      relevant: boolean;
      inner: Question[];
      nested: Question[];
    }
  | { kind: 'grid'; t: Texts; choices: Texts[]; rows: Texts[] };

const block: fc.Arbitrary<Block> = fc.oneof(
  {
    weight: 3,
    arbitrary: question.map((q) => ({ kind: 'question' as const, q })),
  },
  fc.record({
    kind: fc.constant('group' as const),
    t: texts,
    relevant: fc.boolean(),
    inner: fc.array(question, { minLength: 1, maxLength: 3 }),
    nested: fc.array(question, { maxLength: 2 }),
  }),
  fc.record({
    kind: fc.constant('grid' as const),
    t: texts,
    choices: fc.array(texts, { minLength: 1, maxLength: 3 }),
    rows: fc.array(texts, { minLength: 1, maxLength: 3 }),
  }),
);

const form = fc.record({
  multilingual: fc.boolean(),
  blocks: fc.array(block, { minLength: 1, maxLength: 6 }),
});

/** Serialize a generated form to XLSForm rows. */
function sheets(f: fc.RecordValue<{ multilingual: boolean; blocks: Block[] }>) {
  const survey: Row[] = [];
  const choices: Row[] = [];
  let n = 0;
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
  const addQuestion = (q: Question) => {
    const name = `q${++n}`;
    const row: Row = { name };
    put(row, 'label', q.t);
    if (q.kind === 'note') {
      row.type = 'note';
    } else if (q.kind === 'select') {
      list(name, q.choices, q.multiple && q.exclusive);
      row.type = `${q.multiple ? 'select_multiple' : 'select_one'} ${name}${q.orOther ? ' or_other' : ''}`;
      if (q.ref && answered.length) row.relevant = `\${${answered[0]}} != ''`;
    } else {
      row.type = q.type;
      if (q.hint) put(row, 'hint', q.hint);
      if (q.required) row.required = 'yes';
      if (q.ref && numbers.length) row.relevant = `\${${numbers[0]}} > 3`;
      if (q.constraint && q.type === 'integer') {
        row.constraint = '. >= 1 and . <= 10';
        put(row, 'constraint_message', q.t);
      }
      if (q.appearance && q.type === 'text') row.appearance = 'multiline';
      if (q.params && q.type === 'range')
        row.parameters = 'start=0 end=20 step=2';
      if (q.type === 'integer' || q.type === 'decimal') numbers.push(name);
    }
    survey.push(row);
    if (q.kind !== 'note') answered.push(name);
  };
  for (const b of f.blocks) {
    if (b.kind === 'question') addQuestion(b.q);
    else if (b.kind === 'group') {
      const row: Row = { type: 'begin_group', name: `g${++n}` };
      put(row, 'label', b.t);
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
      const row: Row = { type: 'begin_group', name, appearance: 'table-list' };
      put(row, 'label', b.t);
      survey.push(row);
      list(name, b.choices, false);
      for (const r of b.rows) {
        const member: Row = { type: `select_one ${name}`, name: `q${++n}` };
        put(member, 'label', r);
        survey.push(member);
      }
      survey.push({ type: 'end_group' });
    }
  }
  const settings: Row[] = f.multilingual
    ? [{ default_language: LANGS[0] }]
    : [];
  return { survey, choices, settings };
}

describe('generated forms', () => {
  test('XLSForm → DDI → Instrument gives the form back', () => {
    fc.assert(
      fc.property(form, (f) => {
        const { survey, choices, settings } = sheets(f);
        const xml = buildDdiXml(survey, choices, {
          prodDate: '2020-01-01',
          settings: settings[0] ?? {},
        });
        expect(canonical(instrumentFromDdi(xml))).toEqual(
          canonical(instrumentFromXlsform(survey, choices, settings)),
        );
      }),
      { numRuns: 200 },
    );
  });
});

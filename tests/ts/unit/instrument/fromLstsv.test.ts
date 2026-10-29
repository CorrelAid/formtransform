/** LimeSurvey TSV → Instrument (#69, phase 2). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { instrumentFromLstsv } from '../../../../src/instrument/fromLstsv.js';
import type {
  GroupItem,
  QuestionItem,
} from '../../../../src/instrument/types.js';
import { parseLstsv } from '../../../../src/lstsv/parser.js';

const ENTITIES = join(__dirname, '../../../../registry/entities');
const entity = (slug: string) =>
  instrumentFromLstsv(
    parseLstsv(readFileSync(join(ENTITIES, slug, 'tsv.tsv'), 'utf-8')),
  );

const HEADER =
  'class\ttype/scale\tname\trelevance\ttext\thelp\tlanguage\tvalidation\tem_validation_q\tmandatory\tother\tdefault\tsame_default\tother_replace_text';
const tsv = (...rows: string[]) => parseLstsv([HEADER, ...rows, ''].join('\n'));

describe('instrumentFromLstsv', () => {
  test('LimeSurvey codes become XLSForm types; lists are keyed by question', () => {
    const ins = entity('select_one');
    const q = ins.body.flatMap((i) =>
      i.kind === 'group' ? i.children : [i],
    )[0] as QuestionItem;
    expect(q).toMatchObject({ type: 'select_one', list: q.name });
    expect(ins.lists[q.name].length).toBeGreaterThan(1);
  });

  test('a lone F array in its G group is the table-list grid group', () => {
    const [grid] = entity('grid').body as GroupItem[];
    expect(grid).toMatchObject({
      kind: 'group',
      name: 'institutionen',
      appearance: 'table-list',
    });
    expect(grid.children.map((c) => (c as QuestionItem).list)).toEqual([
      'institutionen',
      'institutionen',
    ]);
  });

  test('a from_file vocabulary comes back from cssclass', () => {
    const qs = entity('select_one_long_list').body.flatMap((i) =>
      i.kind === 'group' ? i.children : [i],
    );
    expect(qs[0]).toMatchObject({
      type: 'select_one_from_file',
      file: 'iso_3166_1.csv',
      list: '',
    });
  });

  test('every language merges into one Text; format G means pages', () => {
    const ins = instrumentFromLstsv(
      tsv(
        'S\t\tlanguage\t1\tde\t\tde\t\t\t\t\t\t\t',
        'S\t\tadditional_languages\t1\ten\t\tde\t\t\t\t\t\t\t',
        'S\t\tformat\t1\tG\t\tde\t\t\t\t\t\t\t',
        'G\t1\tSeite\t1\t\t\tde\t\t\t\t\t\t\t',
        'Q\tS\tq\t1\tFrage?\tHilfe\tde\t\t\t\t\t\t\t',
        'G\t1\tPage\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tS\tq\t1\tQuestion?\tHelp\ten\t\t\t\t\t\t\t',
      ),
    );
    expect(ins.languages).toEqual(['de', 'en']);
    expect(ins.defaultLanguage).toBe('de');
    // The bare tag is the model's defaultLanguage, not an authored setting.
    expect(ins.settings).toEqual({ style: 'pages' });
    const [g] = ins.body as GroupItem[];
    expect(g.label).toEqual({ de: 'Seite', en: 'Page' });
    expect(g.children[0]).toMatchObject({
      label: { de: 'Frage?', en: 'Question?' },
      hint: { de: 'Hilfe', en: 'Help' },
    });
  });

  test('other=Y is or_other; other_replace_text labels it; an old <q>other is renamed', () => {
    const ins = instrumentFromLstsv(
      tsv(
        'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t\t',
        'G\t1\tG\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tL\tsrc\t1\tSource?\t\ten\t\t\t\tY\t\t\tPlease specify',
        'A\t\tweb\t\tWeb\t\ten\t\t\t\t\t\t\t',
        'Q\tS\tsrcother\t1\tWhich?\t\ten\t\t\t\t\t\t\t',
      ),
    );
    const [src, companion] = (ins.body[0] as GroupItem)
      .children as QuestionItem[];
    expect(src).toMatchObject({
      orOther: true,
      otherLabel: { en: 'Please specify' },
    });
    expect(companion.name).toBe('src_other');
  });

  test("a group titled like a question doesn't take its name", () => {
    // LimeSurvey keeps group titles and question codes apart; XLSForm (and
    // the DDI's xs:ID) doesn't. The question keeps its code, the group gives
    // way, whichever comes first.
    const ins = instrumentFromLstsv(
      tsv(
        'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t\t',
        'SL\t\tsurveyls_welcometext\t\tHi\t\ten\t\t\t\t\t\t\t',
        'G\t1\tq4\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tN\tq2\t1\tHow many?\t\ten\t\t\t\t\t\t\t',
        'G\t2\tQ4ö\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tL\tq4\t1\tWhich?\t\ten\t\t\t\tY\t\t\t',
        'A\t\tc1\t\tOne\t\ten\t\t\t\t\t\t\t',
        'G\t3\tq4_other\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tF\tgrid\t1\tRate\t\ten\t\t\t\t\t\t\t',
        'SQ\t\trow1\t\tRow\t\ten\t\t\t\t\t\t\t',
        'A\t\tc1\t\tGood\t\ten\t\t\t\t\t\t\t',
        'Q\tN\tq9\t1\tAnd?\t\ten\t\t\t\t\t\t\t',
        'G\t4\trow1\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tN\tq10\t1\tMore?\t\ten\t\t\t\t\t\t\t',
        'G\t5\twelcome\t1\t\t\ten\t\t\t\t\t\t\t',
        'Q\tN\tq11\t1\tLast?\t\ten\t\t\t\t\t\t\t',
      ),
    );
    const groups = ins.body.filter((i) => i.kind === 'group');
    expect(groups.map((g) => g.name)).toEqual([
      'q4_2',
      'q4_3',
      'q4_other_2',
      'row1_2',
      'welcome_2',
    ]);
    expect((groups[1] as GroupItem).children.map((q) => q.name)).toEqual([
      'q4',
    ]);
  });
});

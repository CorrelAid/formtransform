/**
 * Apply a LimeSurvey mapping (convention:lstsvMapping) to an Instrument
 * parsed from a LimeSurvey TSV: every name, answer code, default and the
 * names and codes in `relevant` / `constraint` go back to what the XLSForm
 * had before xlsform2lstsv sanitized them.
 */
import { OTHER_SUFFIX } from '../conventions/other.js';
import type { LstsvMapping } from '../conventions/lstsvMapping.js';
import type { Instrument, InstrumentChoice, QuestionItem } from './types.js';
import { allItems, allQuestions } from './walk.js';

/** Renames from one mapping, by LimeSurvey name. */
class Renamer {
  /** LimeSurvey question name → its answer codes' renames. */
  private readonly codesByQuestion = new Map<string, Record<string, string>>();

  constructor(
    private readonly mapping: LstsvMapping,
    questions: QuestionItem[],
  ) {
    for (const q of questions) {
      const codes = this.codesOf(q);
      if (codes) this.codesByQuestion.set(q.name, codes);
    }
  }

  /** A question's code renames: its list's (a grid's), else its own. */
  codesOf(q: QuestionItem): Record<string, string> | undefined {
    return (q.list && this.mapping.codes[q.list]) || this.mapping.codes[q.name];
  }

  /** An item's XLSForm name; a native other's companion follows its select. */
  name(lsName: string): string {
    const mapped = this.mapping.names[lsName];
    if (mapped !== undefined) return mapped;
    if (lsName.endsWith(OTHER_SUFFIX)) {
      const base = lsName.slice(0, -OTHER_SUFFIX.length);
      const original = this.mapping.names[base];
      if (original !== undefined) return original + OTHER_SUFFIX;
    }
    return lsName;
  }

  /** One answer code of question `question` (LimeSurvey name). */
  code(question: string, code: string): string {
    return this.codesByQuestion.get(question)?.[code] ?? code;
  }

  /**
   * An XPath expression the reverse path wrote: the codes compared with a
   * select (`selected(${q}, 'c')`, `${q} = 'c'`, `${q} != 'c'`), then every
   * `${name}`. The quotes stay as written.
   */
  expression(xpath: string): string {
    if (!xpath) return xpath;
    return xpath
      .replace(
        /selected\(\s*\$\{([^}]+)\}\s*,\s*(['"])(.*?)\2\s*\)/g,
        (_m, q: string, quote: string, c: string) =>
          `selected(\${${q}}, ${quote}${this.code(q, c)}${quote})`,
      )
      .replace(
        /\$\{([^}]+)\}(\s*!?=\s*)(['"])(.*?)\3/g,
        (_m, q: string, op: string, quote: string, c: string) =>
          `\${${q}}${op}${quote}${this.code(q, c)}${quote}`,
      )
      .replace(/\$\{([^}]+)\}/g, (_m, n: string) => `\${${this.name(n)}}`);
  }
}

function renameChoices(
  choices: InstrumentChoice[],
  codes: Record<string, string> | undefined,
): InstrumentChoice[] {
  if (!codes) return choices;
  return choices.map((c) => ({ ...c, name: codes[c.name] ?? c.name }));
}

function renameQuestion(q: QuestionItem, r: Renamer): void {
  const lsName = q.name;
  if (q.default) {
    q.default = q.default
      .split(/\s+/)
      .map((c) => r.code(lsName, c))
      .join(' ');
  }
  q.constraint = r.expression(q.constraint);
  if (q.list) {
    q.list = r.name(q.list);
    q.rawType = q.rawType.replace(/^(\S+\s+)\S+/, `$1${q.list}`);
  }
}

/**
 * A copy of `instrument` with the mapping's renames applied. An instrument
 * parsed from a TSV the mapping doesn't belong to is left as far as its names
 * don't match.
 */
export function applyLstsvMapping(
  instrument: Instrument,
  mapping: LstsvMapping,
): Instrument {
  const out = structuredClone(instrument);
  const r = new Renamer(mapping, allQuestions(out.body));
  const lists: Instrument['lists'] = {};
  for (const [owner, choices] of Object.entries(out.lists)) {
    lists[r.name(owner)] = renameChoices(choices, mapping.codes[owner]);
  }
  out.lists = lists;
  for (const item of allItems(out.body)) {
    item.relevant = r.expression(item.relevant);
    if (item.kind === 'question') renameQuestion(item, r);
  }
  // Names last: the code renames above are keyed by LimeSurvey names.
  for (const item of allItems(out.body)) item.name = r.name(item.name);
  return out;
}

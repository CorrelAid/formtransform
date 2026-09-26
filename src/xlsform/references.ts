/**
 * Structural checks on `relevant` and `constraint` (#73): every `${name}`
 * names a row of the survey, and a literal compared against a question is a
 * value that question can take. Not an expression parser: only the
 * `${x} = 'v'`, `${x} != 'v'` and `selected(${x}, 'v')` shapes are read.
 */
import { warning } from '../diagnostics.js';
import type { Diagnostic } from '../diagnostics.js';
import { OTHER_CODE } from '../conventions/other.js';
import { isFromFileType } from '../conventions/fromFile.js';
import { registeredFileChoices } from '../vocab.js';
import type { ChoiceRow, SurveyRow } from './types.js';

const EXPRESSION_COLUMNS = ['relevant', 'constraint'] as const;

const REF = /\$\{\s*([^}\s]+)\s*\}/g;
const LITERAL = String.raw`(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))`;
const NAME = String.raw`\$\{\s*([^}\s]+)\s*\}`;
/** `${x} = v`, `${x} != v`, `v = ${x}`, `v != ${x}`, `selected(${x}, v)`. */
const COMPARISONS = [
  new RegExp(String.raw`${NAME}\s*!?=\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`${LITERAL}\s*!?=\s*${NAME}`, 'g'),
  new RegExp(String.raw`selected\(\s*${NAME}\s*,\s*${LITERAL}\s*\)`, 'g'),
];

/** What a referenced question accepts: a set of codes, or numbers only. */
type Accepts = { codes: ReadonlySet<string> } | 'number' | 'any';

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'range']);

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  return typeof v === 'number' ? String(v) : '';
}

/** Codes of each choice list, from the choices sheet and file vocabularies. */
function codesByList(
  survey: SurveyRow[],
  choices: ChoiceRow[],
  fileChoices: Record<string, ChoiceRow[]> = {},
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (list: string, rows: ChoiceRow[]) => {
    const codes = out.get(list) ?? new Set<string>();
    for (const c of rows) codes.add(str(c.name));
    out.set(list, codes);
  };
  for (const c of choices) add(str(c.list_name), [c]);
  const files = { ...registeredFileChoices(survey), ...fileChoices };
  for (const [file, rows] of Object.entries(files)) add(file, rows);
  return out;
}

function accepts(row: SurveyRow, lists: Map<string, Set<string>>): Accepts {
  const [baseType = '', list = '', tail = ''] = str(row.type).split(/\s+/);
  if (NUMERIC_TYPES.has(baseType)) return 'number';
  const isSelect =
    baseType === 'select_one' ||
    baseType === 'select_multiple' ||
    isFromFileType(baseType);
  const codes = isSelect ? lists.get(list) : undefined;
  if (!codes) return 'any';
  return tail === 'or_other'
    ? { codes: new Set([...codes, OTHER_CODE]) }
    : { codes };
}

function literalProblem(
  literal: string,
  quoted: boolean,
  target: string,
  want: Accepts,
): string | null {
  if (want === 'any') return null;
  if (want === 'number') {
    return quoted && !/^-?\d+(\.\d+)?$/.test(literal)
      ? `'${literal}' is not a number, but "${target}" is numeric`
      : null;
  }
  return want.codes.has(literal)
    ? null
    : `'${literal}' is not one of the choices of "${target}"`;
}

/** Findings for the expression columns of one row. */
function rowFindings(
  row: SurveyRow,
  names: ReadonlySet<string>,
  acceptsByName: ReadonlyMap<string, Accepts>,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const name = str(row.name);
  const where = name ? ` on "${name}"` : '';
  for (const column of EXPRESSION_COLUMNS) {
    const expr = str(row[column]);
    if (!expr) continue;
    const unknown = new Set(
      [...expr.matchAll(REF)].map((m) => m[1]).filter((r) => !names.has(r)),
    );
    for (const ref of unknown) {
      found.push({
        code: 'reference-unknown',
        severity: 'error',
        message: `${column}${where} references unknown question: \${${ref}}`,
        ...(name ? { name } : {}),
      });
    }
    for (const pattern of COMPARISONS) {
      for (const m of expr.matchAll(pattern)) {
        // Group order differs by pattern; the name is the one set in NAME's slot.
        const [ref, sq, dq, num] =
          pattern === COMPARISONS[1]
            ? [m[4], m[1], m[2], m[3]]
            : [m[1], m[2], m[3], m[4]];
        const want = acceptsByName.get(ref);
        if (!want) continue; // unknown: reported above
        const literal = sq ?? dq ?? num;
        const problem = literalProblem(literal, num === undefined, ref, want);
        if (problem) {
          found.push(
            warning(
              'literal-invalid',
              `${column}${where}: ${problem}, so the comparison is never true`,
              name || undefined,
            ),
          );
        }
      }
    }
  }
  return found;
}

/** Dangling `${name}` references (errors) and impossible literals (warnings). */
export function expressionReferenceDiagnostics(
  survey: SurveyRow[],
  choices: ChoiceRow[],
  fileChoices?: Record<string, ChoiceRow[]>,
): Diagnostic[] {
  const lists = codesByList(survey, choices, fileChoices);
  const acceptsByName = new Map<string, Accepts>();
  for (const row of survey) {
    const name = str(row.name);
    if (name) acceptsByName.set(name, accepts(row, lists));
  }
  const names = new Set(acceptsByName.keys());
  return survey.flatMap((row) => rowFindings(row, names, acceptsByName));
}

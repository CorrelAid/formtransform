/**
 * Response-data CSV emitter, kept in lock-step with the DDI XML schema.
 *
 * `ddi/codebook.ts` expands every `select_multiple` question into N binary
 * `<var>` elements (one per choice, named `<question>_<choice>`). The CSV
 * mirrors that expansion column for column, so every header matches a
 * `<var name="">` in the XML — in the same order the emitter writes them.
 *
 * Source-agnostic: any adapter producing `Variable[]` plus raw response rows
 * can use it. `select_multiple` values are expected as space-joined choice
 * codes (what Kobo and the LimeSurvey adapters both produce).
 */

import { splitDataVars } from '../../ddi/codebook.js';
import type { DataVarBuckets, OtherPattern } from '../../ddi/codebook.js';
import { classifyNotes } from '../../ddi/notes.js';
import type { Variable } from '../../ddi/types.js';

/** One raw response record, keyed by question name or `group/name` path. */
export type Submission = Record<string, unknown>;

/**
 * One CSV column: either the variable's own value (`single`) or one binary
 * `0`/`1` membership flag of a `select_multiple` choice (`binary`).
 */
interface Column {
  name: string;
  variable: Variable;
  /** Choice code this column flags; `''` for a `single` column. */
  choice: string;
}

function single(variable: Variable, name = variable.name): Column {
  return { name, variable, choice: '' };
}

function binary(variable: Variable, choice: string): Column {
  return { name: `${variable.name}_${choice}`, variable, choice };
}

/** Columns for one `_other` pattern, mirroring `emitOtherPatternVars`. */
function otherPatternColumns(p: OtherPattern): Column[] {
  const cols: Column[] = p.isMulti
    ? p.base.choices
        .filter((c) => c.name !== 'other')
        .map((c) => binary(p.base, c.name))
    : [single(p.base)];
  // The `_other` free text is always its own column.
  cols.push(single(p.otherVar));
  return cols;
}

/**
 * Ordered column plan for a variable list.
 *
 * The walk order is the one `addVars` in `ddi/codebook.ts` uses: grid-group
 * members, then `select_multiple` binaries, then `_other` patterns, then
 * standalone variables. `note` variables carry no data and are skipped.
 */
function columnPlan(variables: Variable[]): Column[] {
  const { dataVars } = classifyNotes(variables);
  const buckets: DataVarBuckets = splitDataVars(dataVars);
  const { gridGroups, multiRespGroups, otherPatterns, standaloneVars } =
    buckets;

  const cols: Column[] = [];
  for (const members of gridGroups.values()) {
    cols.push(...members.map((v) => single(v)));
  }
  for (const smVar of multiRespGroups.values()) {
    cols.push(...smVar.choices.map((c) => binary(smVar, c.name)));
  }
  for (const p of otherPatterns.values()) {
    cols.push(...otherPatternColumns(p));
  }
  cols.push(...standaloneVars.map((v) => single(v)));
  return cols;
}

/**
 * Read a variable's raw value from a submission.
 *
 * Adapters key rows either by bare question name (Kobo's `select_multiple`
 * flat export, LimeSurvey) or by the grouped path Kobo's CSV export uses
 * (`group/name`, nested groups slash-joined). Both are accepted; the bare
 * name wins when a row carries both.
 */
function readCell(row: Submission, v: Variable): unknown {
  if (v.name in row) return row[v.name];
  if (v.group) {
    const path = `${v.group}/${v.name}`;
    if (path in row) return row[path];
  }
  return '';
}

/**
 * Stringify a cell. `null`/`undefined` become `''` (never `"None"`), and so do
 * objects/arrays — a data column holds one scalar per respondent.
 */
function cellText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** Selected choice codes of a space-joined `select_multiple` value. */
function selectedCodes(raw: unknown): Set<string> {
  return new Set(cellText(raw).split(/\s+/).filter(Boolean));
}

/**
 * DDI variable names in the order `buildDdiXml` emits `<var name="">`.
 *
 * `select_multiple` expands to one `<name>_<choice>` column per choice; every
 * other variable contributes a single column equal to `variable.name`.
 */
export function getDdiColumnNames(variables: Variable[]): string[] {
  return columnPlan(variables).map((c) => c.name);
}

/**
 * Re-key raw submissions onto DDI variable names.
 *
 * Each output row has exactly one entry per {@link getDdiColumnNames} column,
 * in that order. `select_multiple` values (space-joined choice codes) expand
 * into per-choice `"0"` / `"1"` columns; everything else becomes one string.
 */
export function remapSubmissionsToDdi(
  variables: Variable[],
  submissions: Submission[],
): Record<string, string>[] {
  return rowsFromPlan(columnPlan(variables), submissions);
}

/** Shared body of {@link remapSubmissionsToDdi} over an existing plan. */
function rowsFromPlan(
  cols: Column[],
  submissions: Submission[],
): Record<string, string>[] {
  return submissions.map((row) => {
    const out: Record<string, string> = {};
    const multiCache = new Map<string, Set<string>>();
    for (const col of cols) {
      if (col.choice) {
        let selected = multiCache.get(col.variable.name);
        if (!selected) {
          selected = selectedCodes(readCell(row, col.variable));
          multiCache.set(col.variable.name, selected);
        }
        out[col.name] = selected.has(col.choice) ? '1' : '0';
      } else {
        out[col.name] = cellText(readCell(row, col.variable));
      }
    }
    return out;
  });
}

/** RFC 4180 minimal quoting: quote only on delimiter, quote, or line break. */
function quoteField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function csvLine(fields: string[]): string {
  return `${fields.map(quoteField).join(',')}\r\n`;
}

/**
 * Build the response-data CSV for a DDI codebook.
 *
 * RFC 4180: CRLF line endings, minimal quoting, header row of DDI variable
 * names in XML order followed by the submissions in input order. Callers own
 * validation — a malformed submission row is emitted as read.
 */
export function buildDataCsv(
  variables: Variable[],
  submissions: Submission[],
): string {
  const cols = columnPlan(variables);
  const names = cols.map((c) => c.name);
  const rows = rowsFromPlan(cols, submissions);
  return (
    csvLine(names) +
    rows.map((row) => csvLine(names.map((n) => row[n]))).join('')
  );
}

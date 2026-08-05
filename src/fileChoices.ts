/**
 * Filesystem resolver for `select_*_from_file <name>.csv` choice lists.
 *
 * The converter core is pure (no fs); this node-only helper loads the CSV files
 * a survey references and returns them keyed by filename, ready to pass as
 * `convert(survey, choices, settings, fileChoices)`. Kept OUT of the browser
 * entry (src/index) — import it directly (CLI / bless scripts / tests).
 *
 * Each referenced CSV must have a `code,label` header (e.g. the registered
 * controlled vocabularies under registry/vocab/). Rows become ChoiceRow
 * `{ list_name: <filename>, name: <code>, label: <label> }`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ChoiceRow, SurveyRow } from './config/types.js';

const FROM_FILE_RE = /^select_(?:one|multiple)_from_file\s+(\S+)/;

/** Parse a `code,label` CSV into ChoiceRows keyed to the given list name. */
export function parseVocabCsv(csvText: string, listName: string): ChoiceRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf('code');
  const labelIdx = header.indexOf('label');
  if (codeIdx === -1 || labelIdx === -1) {
    throw new Error(
      `Vocabulary CSV ${listName} must have 'code' and 'label' columns; got: ${header.join(',')}`,
    );
  }
  const rows: ChoiceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const code = (cells[codeIdx] ?? '').trim();
    const label = (cells[labelIdx] ?? '').trim();
    if (code === '') continue;
    rows.push({ list_name: listName, name: code, label });
  }
  return rows;
}

/**
 * Scan a survey for `select_*_from_file` references and load each referenced CSV
 * from `vocabDir`, returning `{ <filename>: ChoiceRow[] }`. Missing files are
 * skipped (the converter then throws for that type, as before).
 */
export function resolveFileChoices(
  survey: SurveyRow[],
  vocabDir: string,
): Record<string, ChoiceRow[]> {
  const out: Record<string, ChoiceRow[]> = {};
  for (const row of survey) {
    const m = String(row.type ?? '')
      .trim()
      .match(FROM_FILE_RE);
    if (!m) continue;
    const filename = m[1];
    if (out[filename]) continue;
    const csvPath = path.join(vocabDir, filename);
    if (!fs.existsSync(csvPath)) continue;
    out[filename] = parseVocabCsv(fs.readFileSync(csvPath, 'utf-8'), filename);
  }
  return out;
}

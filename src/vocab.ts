/**
 * Choice lists for `select_*_from_file <name>.csv` questions. Browser-safe.
 *
 * The registered vocabularies (`registry/vocab/`) ship as generated data, so a
 * form that references one converts without any file access. Other CSVs are
 * the caller's to read and pass through {@link parseVocabCsv}; the node-only
 * `fileChoices.ts` does that from disk for the CLI.
 */
import type { ChoiceRow, SurveyRow } from './xlsform/types.js';
import { VOCABULARY_OPTIONS } from './generated/VocabularyOptions.js';
import { parseCsvRecords } from './responseFile.js';
import { ConversionError } from './diagnostics.js';

const FROM_FILE_RE = /^select_(?:one|multiple)_from_file\s+(\S+)/;

/** Filenames referenced by the survey's `select_*_from_file` rows, in order. */
export function referencedVocabFiles(survey: SurveyRow[]): string[] {
  const files = new Set<string>();
  for (const row of survey) {
    const m = String(row.type ?? '')
      .trim()
      .match(FROM_FILE_RE);
    if (m) files.add(m[1]);
  }
  return [...files];
}

/**
 * Parse a `code,label` CSV into ChoiceRows keyed to the given list name.
 * `name,label`, the header ODK/pyxform use for `select_*_from_file` CSVs, is
 * read the same way. Quoted fields (`"Korea, Republic of"`) and a leading BOM
 * are handled.
 */
export function parseVocabCsv(csvText: string, listName: string): ChoiceRow[] {
  const [header, ...records] = parseCsvRecords(
    csvText.replace(/^\uFEFF/, ''),
    ',',
  );
  if (!header) return [];
  const columns = header.map((h) => h.trim().toLowerCase());
  const codeIdx = columns.includes('code')
    ? columns.indexOf('code')
    : columns.indexOf('name');
  const labelIdx = columns.indexOf('label');
  if (codeIdx === -1 || labelIdx === -1) {
    throw new ConversionError(
      'vocab-csv-invalid',
      `Vocabulary CSV ${listName} must have 'code' (or 'name') and 'label' columns; got: ${columns.join(',')}`,
    );
  }
  const rows: ChoiceRow[] = [];
  for (const cells of records) {
    const code = (cells[codeIdx] ?? '').trim();
    const label = (cells[labelIdx] ?? '').trim();
    if (code === '') continue;
    rows.push({ list_name: listName, name: code, label });
  }
  return rows;
}

/** Filenames of the registered vocabularies (`registry/vocab/`). */
export function registeredVocabFiles(): string[] {
  return Object.keys(VOCABULARY_OPTIONS);
}

/**
 * Choices for every registered vocabulary the survey references, keyed by
 * filename. Unregistered filenames are left out; the caller supplies those.
 */
export function registeredFileChoices(
  survey: SurveyRow[],
): Record<string, ChoiceRow[]> {
  const out: Record<string, ChoiceRow[]> = {};
  for (const filename of referencedVocabFiles(survey)) {
    const options = VOCABULARY_OPTIONS[filename];
    if (!options) continue;
    out[filename] = options.map(([name, label]) => ({
      list_name: filename,
      name,
      label,
    }));
  }
  return out;
}

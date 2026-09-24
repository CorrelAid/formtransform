/**
 * Filesystem resolver for `select_*_from_file <name>.csv` choice lists.
 *
 * The converter core is pure (no fs) and already knows the registered
 * vocabularies (see `vocab.ts`). This node-only helper loads CSV files that sit
 * beside a form on disk, e.g. an unregistered vocabulary, and returns them
 * keyed by filename, ready to pass as
 * `convert(survey, choices, settings, fileChoices)`. Kept OUT of the browser
 * entry (src/index) — import it directly (CLI / tests).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ChoiceRow, SurveyRow } from './config/types.js';
import { parseVocabCsv, referencedVocabFiles } from './vocab.js';

/**
 * Load each CSV the survey references from `vocabDir`, returning
 * `{ <filename>: ChoiceRow[] }`. Missing files are skipped: the converter then
 * falls back to the registered vocabulary, or throws for an unknown one.
 */
export function resolveFileChoices(
  survey: SurveyRow[],
  vocabDir: string,
): Record<string, ChoiceRow[]> {
  const out: Record<string, ChoiceRow[]> = {};
  for (const filename of referencedVocabFiles(survey)) {
    const csvPath = path.join(vocabDir, filename);
    if (!fs.existsSync(csvPath)) continue;
    out[filename] = parseVocabCsv(fs.readFileSync(csvPath, 'utf-8'), filename);
  }
  return out;
}

/**
 * Response-file reader: the text of a survey platform's response export →
 * `Submission[]` for `buildDataCsv` / `buildDdiXml` / `lstsvToDataCsv`.
 *
 * Used by the CLI's `--data` flag and exported from `src/index.ts`, so a
 * browser app can feed an uploaded export through the same parser. Pure — no
 * filesystem or network. Two shapes are accepted:
 *
 * - **JSON** — an array of submission objects (e.g. a Kobo or LimeSurvey JSON
 *   export), or an API page `{ results: [...] }`.
 * - **CSV** — a header row of question names (bare or `group/name`), then one
 *   row per respondent. Kobo's CSV export defaults to `;`, so the delimiter is
 *   sniffed from the header: whichever of `;` / `,` occurs more often outside
 *   quotes wins.
 */

import type { Submission } from './pipelines/xlsform2ddi/data.js';

type Format = 'json' | 'csv';

/**
 * Pick the format from the extension, falling back to the first
 * non-whitespace character (`[` / `{` → JSON) for anything else.
 */
function detectFormat(text: string, filename: string): Format {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'csv';
}

function parseJson(text: string): Submission[] {
  const data: unknown = JSON.parse(text);
  const records =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as { results?: unknown }).results
      : data;
  if (!Array.isArray(records)) {
    throw new Error(
      'expected a JSON array of submissions or an object with a "results" array',
    );
  }
  records.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error(`submission ${i} is not a JSON object`);
    }
  });
  return records as Submission[];
}

/** `;` or `,`, whichever occurs more often in the header line outside quotes. */
function sniffDelimiter(text: string): string {
  let semis = 0;
  let commas = 0;
  let inQuotes = false;
  for (const c of text) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === '\n' || c === '\r')) break;
    else if (!inQuotes && c === ';') semis++;
    else if (!inQuotes && c === ',') commas++;
  }
  return semis > commas ? ';' : ',';
}

/**
 * RFC 4180 tokenizer: quoted fields may hold the delimiter, doubled quotes and
 * line breaks (free-text answers routinely do). Accepts CRLF or LF.
 */
function parseCsvRecords(text: string, delim: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delim) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // A blank line tokenizes as one empty field — not a respondent.
  return records.filter((r) => !(r.length === 1 && r[0] === ''));
}

function parseCsv(text: string): Submission[] {
  const [header, ...rows] = parseCsvRecords(text, sniffDelimiter(text));
  if (!header) return [];
  return rows.map((cells, i) => {
    if (cells.length > header.length) {
      throw new Error(
        `row ${i + 2} has ${cells.length} fields, header has ${header.length}`,
      );
    }
    const row: Submission = {};
    header.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    return row;
  });
}

/**
 * Parse a response export into submissions. `filename` only steers format
 * detection. A leading UTF-8 BOM (Excel, Kobo) is dropped.
 */
export function parseResponses(text: string, filename: string): Submission[] {
  const body = text.replace(/^\uFEFF/, '');
  return detectFormat(body, filename) === 'json'
    ? parseJson(body)
    : parseCsv(body);
}

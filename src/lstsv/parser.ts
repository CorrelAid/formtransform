/**
 * Parse a LimeSurvey structure TSV into row records keyed by header.
 *
 * The forward emitter ({@link ../processors/TSVGenerator}) never writes
 * multi-line fields — newlines become `<br />` and only fields containing a tab
 * or a quote are wrapped in quotes (with `"` doubled). So each line is one row
 * and a single-pass tokenizer suffices; RFC-4180 multi-line quoting is not
 * needed.
 *
 * @see https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure
 */

/** Split one TSV line into fields, unescaping LimeSurvey's quoting. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const c = line[i];

    if (inQuotes) {
      if (c === '"') {
        // Doubled quote inside a quoted field → literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    // A quote only opens a quoted field at the start of that field (the emitter
    // always wraps the whole field), so a bare quote mid-field stays literal.
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === '\t') {
      out.push(field);
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }

  out.push(field);
  return out;
}

/**
 * Parse a LimeSurvey structure TSV string into an ordered list of row records,
 * each keyed by the header row's column names. A leading BOM, CRLF line ends
 * and trailing blank lines are accepted.
 */
export function parseLstsv(tsv: string): Record<string, string>[] {
  // Excel and some editors save a UTF-8 BOM; it would glue onto `class`.
  const lines = tsv.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let li = 1; li < lines.length; li++) {
    if (lines[li] === '') continue;
    const cells = parseLine(lines[li]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

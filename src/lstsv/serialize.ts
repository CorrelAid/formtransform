import { ATTRIBUTE_COLUMNS, BASE_COLUMNS } from './columns.js';
import type { TSVRow } from './columns.js';

export type { TSVRow } from './columns.js';

export class TSVGenerator {
  private rows: TSVRow[] = [];

  addRow(row: TSVRow): void {
    this.rows.push(row);
  }

  // https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure
  generateTSV(): string {
    // Attribute columns only appear when at least one row sets them.
    const headers: (keyof TSVRow)[] = [
      ...BASE_COLUMNS,
      ...ATTRIBUTE_COLUMNS.filter((attr) => this.rows.some((r) => r[attr])),
    ];

    const lines = [headers.join('\t')];

    for (const row of this.rows) {
      const values = headers.map((h) => this.escapeForTSV(row[h] ?? ''));
      lines.push(values.join('\t'));
    }

    return lines.join('\n');
  }

  private escapeForTSV(value: string): string {
    // Escape tabs, newlines, and wrap in quotes if needed
    // Replace newlines with <br /> for LimeSurvey compatibility.
    // LimeSurvey's TSV importer parses line-by-line and does not handle
    // RFC 4180 multi-line quoted fields. HTML breaks render correctly
    // in LimeSurvey's question text and help fields.
    value = value.replace(/\r\n/g, '<br />').replace(/\n/g, '<br />');

    if (value.includes('\t') || value.includes('"')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  clear(): void {
    this.rows = [];
  }

  getRowCount(): number {
    return this.rows.length;
  }
}

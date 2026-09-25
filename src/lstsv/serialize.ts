interface TSVRow {
  class: string;
  'type/scale': string;
  name: string;
  relevance: string;
  text: string;
  help: string;
  language: string;
  validation: string;
  em_validation_q: string;
  mandatory: string;
  other: string;
  default: string;
  same_default: string;
  hidden?: string;
  // LimeSurvey `cssclass` question attribute. Used only on select_*_from_file
  // questions to carry vocabulary provenance (`cdlvocab-<id>`); empty elsewhere.
  // A registered attribute, so it survives import and is queryable (an
  // unregistered custom column would be dropped).
  cssclass?: string;
  // LimeSurvey `hide_tip` question attribute ('1' to suppress the stock
  // per-question tip). Emitted for every real question in this ecosystem;
  // empty elsewhere. See ConversionConfig.hideQuestionTips.
  hide_tip?: string;
  // LimeSurvey `date_format` question attribute for date/time (type D)
  // questions — controls whether the widget shows a date, a time, or both.
  // Sourced from the registry's limesurvey.dateFormat; empty elsewhere.
  date_format?: string;
  // LimeSurvey numeric-input (N) attributes, from the XLSForm `parameters`
  // column via the registry (limesurvey.parameterAttributes / integerOnly).
  // Only `range` sets them.
  min_num_value_n?: string;
  max_num_value_n?: string;
  num_value_int_only?: string;
  // Multiple choice (M): answer codes that exclude all others, `;`-joined
  // (convention:exclusiveChoice, from the choices sheet's `exclusive` column).
  exclude_all_others?: string;
}

export class TSVGenerator {
  private rows: TSVRow[] = [];

  addRow(row: TSVRow): void {
    this.rows.push(row);
  }

  // https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure
  generateTSV(): string {
    const headers = [
      'class',
      'type/scale',
      'name',
      'relevance',
      'text',
      'help',
      'language',
      'validation',
      'em_validation_q',
      'mandatory',
      'other',
      'default',
      'same_default',
      'hidden',
    ];

    // Attribute columns are only emitted when at least one row carries them,
    // so surveys that don't use a given attribute keep a lean TSV. The order
    // here is the column order in the output.
    for (const attr of [
      'cssclass',
      'hide_tip',
      'date_format',
      'min_num_value_n',
      'max_num_value_n',
      'num_value_int_only',
      'exclude_all_others',
    ] as const) {
      if (this.rows.some((r) => r[attr])) {
        headers.push(attr);
      }
    }

    const lines = [headers.join('\t')];

    for (const row of this.rows) {
      const values = headers.map((h) =>
        this.escapeForTSV(row[h as keyof TSVRow] ?? ''),
      );
      lines.push(values.join('\t'));
    }

    return lines.join('\n');
  }

  private escapeForTSV(value: string): string {
    // Escape tabs, newlines, and wrap in quotes if needed
    if (typeof value !== 'string') value = String(value);

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

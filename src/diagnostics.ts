/**
 * Structured findings: what the validators report and the converters throw or
 * warn with. Every finding carries a stable `code`, so a consumer can translate
 * it or point the user at the offending question instead of parsing messages.
 * Shared by every format module and pipeline, so it lives outside all of them.
 */

/** Stable identifiers for every finding the library produces. */
export type DiagnosticCode =
  // XLSForm structure and subset
  | 'sheet-missing'
  | 'sheet-empty'
  | 'column-missing'
  | 'column-unexpected'
  | 'language-invalid'
  | 'language-unmapped'
  | 'language-approximated'
  | 'name-invalid'
  | 'name-too-long'
  | 'name-duplicate'
  | 'name-empty-after-sanitize'
  | 'name-truncated'
  | 'name-collision'
  | 'code-invalid'
  | 'code-too-long'
  | 'code-duplicate'
  | 'grid-list-mismatch'
  | 'code-missing'
  | 'code-empty-after-sanitize'
  | 'code-truncated'
  | 'label-missing'
  | 'hint-dropped'
  | 'reference-unknown'
  | 'literal-invalid'
  | 'type-unregistered'
  | 'type-unsupported'
  | 'choice-list-missing'
  | 'choice-list-empty'
  | 'vocab-file-missing'
  | 'vocab-unregistered'
  | 'vocab-csv-invalid'
  | 'appearance-unregistered'
  | 'appearance-invalid-for-type'
  | 'exclusive-invalid'
  | 'exclusive-no-effect'
  | 'other-label-noncanonical'
  | 'parameter-invalid'
  | 'xlsform-outside-subset'
  // expressions
  | 'xpath-syntax'
  | 'xpath-unsupported'
  | 'constraint-dropped'
  // LimeSurvey TSV (reverse)
  | 'lstsv-outside-subset'
  | 'em-unsupported'
  // responses
  | 'responses-invalid'
  | 'response-ambiguous'
  // configuration and registry
  | 'config-invalid'
  | 'registry-invalid';

export type Severity = 'error' | 'warning';

/** One finding. `name` is the question (or choice list) it concerns, if any. */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  name?: string;
}

/**
 * What `validateSubset` and `validateLstsvSubset` return: an `error` blocks a
 * lossless conversion, a `warning` doesn't.
 */
export type SubsetViolation = Diagnostic;

/** Receives the warnings a conversion produces. */
export type WarningHandler = (warning: Diagnostic) => void;

/**
 * The default handler: prints to the console, as the library always did. The
 * only place the library writes to the console; pass your own handler (e.g. to
 * collect warnings in a UI) via the `onWarning` options.
 */
export const consoleWarning: WarningHandler = (w) => {
  console.warn(w.message);
};

/** Build a warning. */
export function warning(
  code: DiagnosticCode,
  message: string,
  name?: string,
): Diagnostic {
  return { code, severity: 'warning', message, ...(name ? { name } : {}) };
}

/**
 * The error every library function throws. `code` is stable; `message` is for
 * humans and may change.
 */
export class ConversionError extends Error implements Diagnostic {
  readonly severity = 'error' as const;
  readonly code: DiagnosticCode;
  readonly name: string;
  /** The question (or choice list) concerned, if any. */
  readonly subject?: string;
  /** Every finding, when the error summarises several. */
  readonly details: readonly Diagnostic[];

  constructor(
    code: DiagnosticCode,
    message: string,
    options: {
      subject?: string;
      cause?: unknown;
      details?: readonly Diagnostic[];
    } = {},
  ) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.details = options.details ?? [];
    if (options.subject) this.subject = options.subject;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  /** Rethrow a finding as an error. */
  static from(d: Diagnostic): ConversionError {
    return new ConversionError(d.code, d.message, { subject: d.name });
  }
}

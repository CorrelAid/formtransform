import conventions from '../generated/conventions.js';
import { ConversionError, consoleWarning, warning } from '../diagnostics.js';
import type {
  Diagnostic,
  DiagnosticCode,
  SubsetViolation,
  WarningHandler,
} from '../diagnostics.js';
import { APPEARANCES } from '../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';

import { SurveyRow, ChoiceRow } from './types.js';
import { registeredVocabFiles } from '../vocab.js';
import {
  EXCLUSIVE_RULE,
  exclusiveCell,
  isExclusive,
} from '../conventions/exclusive.js';
import { OTHER_SUFFIX } from '../conventions/other.js';
import { isFromFileType } from '../conventions/fromFile.js';
import { METADATA_ROW_TYPES } from '../conventions/metadata.js';
import { normalizeName } from './identifiers.js';

const NAME_RULES = conventions.conventions.sanitization.name;
const CHOICE_RULES = conventions.conventions.sanitization.choiceCode;
const NAME_RE = new RegExp(NAME_RULES.pattern);
const CHOICE_RE = new RegExp(CHOICE_RULES.pattern);

// Survey rows that carry no LimeSurvey-bound name (structural closers).
const NO_NAME_TYPES = new Set(['end_group', 'end group', 'end_repeat']);

// Structural group markers (validated for names, not for type membership).
const STRUCTURAL = new Set([
  'begin_group',
  'begin group',
  'end_group',
  'end group',
]);

// Metadata rows silently skipped by the converter (convention:unregisteredRows).
const METADATA_TYPES = new Set<string>(METADATA_ROW_TYPES);

/** A single subset-validation finding. */
export type { SubsetViolation } from '../diagnostics.js';

/** Options for {@link XLSValidator.validateSubset}. */
export interface SubsetOptions {
  /**
   * Choices for `select_*_from_file` CSVs the caller will pass to `convert()`,
   * keyed by filename. These count as resolvable next to the registered
   * vocabularies.
   */
  fileChoices?: Record<string, ChoiceRow[]>;
  /**
   * What the form is checked for. `'lstsv'` (default) applies every rule,
   * including LimeSurvey's name/code limits. `'ddi'` drops those limits: DDI
   * keeps names as authored, so a Kobo name like `full_name` is fine. Types,
   * choice lists, appearances and uniqueness are still checked.
   */
  target?: SubsetTarget;
}

/** The conversion a subset check is for. */
export type SubsetTarget = 'lstsv' | 'ddi';

/** Inputs for {@link XLSValidator.validateAll}. */
export interface ValidateAllOpts {
  surveyData: SurveyRow[];
  choicesData: ChoiceRow[];
  hasSurveySheet: boolean;
  hasChoicesSheet: boolean;
  surveySheetName?: string;
  choicesSheetName?: string;
  /** Receives non-fatal findings (empty sheet, unexpected column). */
  onWarning?: WarningHandler;
}

/** What {@link XLSValidator.rowDiagnostic} needs to know about the form. */
export interface RowCheckContext {
  /** List names that have at least one row on the choices sheet. */
  listNames: ReadonlySet<string>;
  /** `select_*_from_file` CSVs the caller supplies, keyed by filename. */
  fileChoices?: Record<string, ChoiceRow[]>;
  target?: SubsetTarget;
}

const error = (
  code: DiagnosticCode,
  message: string,
  name?: string,
): Diagnostic => ({
  code,
  severity: 'error',
  message,
  ...(name ? { name } : {}),
});

// The semi-open `<base>_other` follow-up (convention:other): LimeSurvey
// carries "other" via its native `other=Y` setting, so the suffix's underscore
// is a source-side marker, not a literal LS code — validate only `<base>`.

/** A cell's text: a string or number, or the joined values of a `{lang: text}` map. */
function cellText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v !== null && typeof v === 'object') {
    return Object.values(v as Record<string, unknown>)
      .map(cellText)
      .join('');
  }
  return '';
}

export class XLSValidator {
  /**
   * Validate that required sheets are present
   * @param hasSurveySheet Whether survey sheet was found
   * @param hasChoicesSheet Whether choices sheet was found
   * @throws ConversionError (`sheet-missing`) if required sheets are missing
   */
  static validateRequiredSheets(
    hasSurveySheet: boolean,
    hasChoicesSheet: boolean,
  ): void {
    const missingSheets = [];
    if (!hasSurveySheet) missingSheets.push('survey');
    if (!hasChoicesSheet) missingSheets.push('choices');

    if (missingSheets.length > 0) {
      throw new ConversionError(
        'sheet-missing',
        `XLSX file is missing required sheets: ${missingSheets.join(', ')}. An XLSForm must contain survey and choices sheets.`,
      );
    }
  }

  /**
   * Validate that survey sheet has required columns
   * @param data Survey data
   * @param sheetName Name of the survey sheet
   * @throws Error if required columns are missing
   */
  static validateSurveySheetColumns(
    data: SurveyRow[],
    sheetName: string,
    onWarning: WarningHandler = consoleWarning,
  ): void {
    if (data.length === 0) {
      onWarning(
        warning('sheet-empty', `Survey sheet "${sheetName}" is empty.`),
      );
      return;
    }

    // Collect all column keys that appear across any row
    const allColumns = new Set<string>();
    for (const row of data) {
      if (row && typeof row === 'object') {
        for (const key of Object.keys(row)) {
          allColumns.add(key);
        }
      }
    }

    if (allColumns.size === 0) {
      onWarning(
        warning(
          'sheet-empty',
          `Survey sheet "${sheetName}" has no valid data rows.`,
        ),
      );
      return;
    }

    // Check for required columns across all rows
    const requiredColumns = ['type', 'name', 'label'];
    const missingColumns = requiredColumns.filter(
      (col) => !allColumns.has(col),
    );

    if (missingColumns.length > 0) {
      throw new ConversionError(
        'column-missing',
        `Survey sheet "${sheetName}" is missing required columns: ${missingColumns.join(', ')}. A survey sheet must contain type, name, and label columns.`,
      );
    }

    // Warn about unexpected columns
    const expectedColumns = [
      'type',
      'name',
      'label',
      'hint',
      'guidance_hint',
      'required',
      'relevant',
      'constraint',
      'constraint_message',
      'calculation',
      'default',
      'appearance',
      'parameters',
    ];
    const unexpectedColumns = [...allColumns].filter(
      (col) => !expectedColumns.includes(col) && !col.startsWith('_'),
    );

    if (unexpectedColumns.length > 0) {
      onWarning(
        warning(
          'column-unexpected',
          `Survey sheet "${sheetName}" contains unexpected columns: ${unexpectedColumns.join(', ')}. These columns will be ignored.`,
        ),
      );
    }
  }

  /**
   * Validate that choices sheet has required columns
   * @param data Choices data
   * @param sheetName Name of the choices sheet
   * @throws Error if required columns are missing
   */
  static validateChoicesSheetColumns(
    data: ChoiceRow[],
    sheetName: string,
    onWarning: WarningHandler = consoleWarning,
  ): void {
    if (data.length === 0) {
      onWarning(
        warning('sheet-empty', `Choices sheet "${sheetName}" is empty.`),
      );
      return;
    }

    // Collect all column keys that appear across any row
    const allColumns = new Set<string>();
    for (const row of data) {
      if (row && typeof row === 'object') {
        for (const key of Object.keys(row)) {
          allColumns.add(key);
        }
      }
    }

    if (allColumns.size === 0) {
      onWarning(
        warning(
          'sheet-empty',
          `Choices sheet "${sheetName}" has no valid data rows.`,
        ),
      );
      return;
    }

    // Check for required columns (handle both list_name and list name variations)
    const hasListName =
      allColumns.has('list_name') || allColumns.has('list name');
    const hasName = allColumns.has('name');
    const hasLabel = allColumns.has('label');

    const missingColumns = [];
    if (!hasListName) missingColumns.push('list_name');
    if (!hasName) missingColumns.push('name');
    if (!hasLabel) missingColumns.push('label');

    if (missingColumns.length > 0) {
      throw new ConversionError(
        'column-missing',
        `Choices sheet "${sheetName}" is missing required columns: ${missingColumns.join(', ')}. A choices sheet must contain list_name, name, and label columns.`,
      );
    }

    // Warn about unexpected columns
    const expectedColumns = [
      'list_name',
      'list name',
      'name',
      'label',
      'filter',
      EXCLUSIVE_RULE.choicesColumn,
    ];
    const unexpectedColumns = [...allColumns].filter(
      (col) => !expectedColumns.includes(col) && !col.startsWith('_'),
    );

    if (unexpectedColumns.length > 0) {
      onWarning(
        warning(
          'column-unexpected',
          `Choices sheet "${sheetName}" contains unexpected columns: ${unexpectedColumns.join(', ')}. These columns will be ignored.`,
        ),
      );
    }
  }

  /**
   * Validate all sheets in the parsed data.
   *
   * @param opts - bundle of parsed sheets + sheet-presence flags. Sheet names
   *   default to `'survey'` / `'choices'` when omitted.
   */
  static validateAll(opts: ValidateAllOpts): void {
    const {
      surveyData,
      choicesData,
      hasSurveySheet,
      hasChoicesSheet,
      surveySheetName = 'survey',
      choicesSheetName = 'choices',
      onWarning = consoleWarning,
    } = opts;

    // Validate required sheets
    this.validateRequiredSheets(hasSurveySheet, hasChoicesSheet);

    // Validate survey sheet columns
    if (hasSurveySheet && surveyData.length > 0) {
      this.validateSurveySheetColumns(surveyData, surveySheetName, onWarning);
    }

    // Validate choices sheet columns
    if (hasChoicesSheet && choicesData.length > 0) {
      this.validateChoicesSheetColumns(
        choicesData,
        choicesSheetName,
        onWarning,
      );
    }

    // Reject names/codes LimeSurvey cannot represent (strict by default).
    this.validateNamesAndCodes(surveyData, choicesData);
  }

  /**
   * Validate that every field name and answer code already satisfies the
   * LimeSurvey naming rules (alphanumeric, length-bounded, unique). We reject
   * rather than silently sanitize so the LimeSurvey/DDI round-trip is lossless:
   * a rejected form must be fixed at the source, not quietly renamed.
   *
   * @throws ConversionError listing every offending name/code; its `code` is
   *   the first finding's, and `details` holds all of them.
   */
  static validateNamesAndCodes(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
  ): void {
    const found = this.collectNameCodeDiagnostics(surveyData, choicesData);
    if (found.length > 0) {
      throw new ConversionError(
        found[0].code,
        `XLSForm uses ${found.length} name(s)/code(s) that LimeSurvey cannot represent. ` +
          `Fix them at the source (or pass skipValidation to sanitize instead, losing round-trip fidelity):\n  - ` +
          found.map((d) => d.message).join('\n  - '),
        { subject: found[0].name, details: found },
      );
    }
  }

  /**
   * @deprecated Use {@link collectNameCodeDiagnostics}, which also returns
   *   each finding's `code`.
   */
  static collectNameCodeErrors(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    target: SubsetTarget = 'lstsv',
  ): string[] {
    return this.collectNameCodeDiagnostics(surveyData, choicesData, target).map(
      (d) => d.message,
    );
  }

  /** Every name/code that breaks the rules for `target` (does not throw). */
  static collectNameCodeDiagnostics(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    target: SubsetTarget = 'lstsv',
  ): Diagnostic[] {
    const errors: Diagnostic[] = [];
    const seen = new Set<string>();
    const lsRules = target === 'lstsv';

    for (const row of surveyData) {
      this.collectSurveyNameError(row, seen, lsRules, errors);
    }
    const codesByList = new Map<string, Set<string>>();
    for (const choice of choicesData) {
      this.collectChoiceCodeError(choice, codesByList, lsRules, errors);
    }

    return errors;
  }

  private static collectSurveyNameError(
    row: SurveyRow,
    seen: Set<string>,
    lsRules: boolean,
    errors: Diagnostic[],
  ): void {
    const type = (row.type || '').trim();
    if (NO_NAME_TYPES.has(type)) return;
    const name = (row.name || '').trim();
    if (!name) return;

    // Exempt the `_other` suffix: validate the base and the LimeSurvey code
    // it sanitizes to (base + "other"), not the raw underscore form.
    const isOther = name.endsWith(OTHER_SUFFIX);
    const base = isOther ? name.slice(0, -OTHER_SUFFIX.length) : name;
    const lsLength = isOther
      ? base.length + normalizeName(OTHER_SUFFIX).length
      : name.length;

    if (!lsRules) {
      // DDI keeps names as authored; only uniqueness below applies.
    } else if (!NAME_RE.test(base)) {
      errors.push(
        error(
          'name-invalid',
          `field name "${name}" must match ${NAME_RULES.pattern} (letters/digits only — no underscores, hyphens or spaces)`,
          name,
        ),
      );
    } else if (lsLength > NAME_RULES.maxLength) {
      errors.push(
        error(
          'name-too-long',
          `field name "${name}" exceeds the ${NAME_RULES.maxLength}-character limit`,
          name,
        ),
      );
    }

    if (seen.has(name)) {
      errors.push(
        error(
          'name-duplicate',
          `field name "${name}" is used more than once`,
          name,
        ),
      );
    }
    seen.add(name);
  }

  private static collectChoiceCodeError(
    choice: ChoiceRow,
    codesByList: Map<string, Set<string>>,
    lsRules: boolean,
    errors: Diagnostic[],
  ): void {
    const code = (choice.name ?? '').toString().trim();
    const listName = String(choice.list_name ?? '').trim();
    if (!code) {
      // A row with a list but no code would be dropped from the question.
      if (listName) {
        errors.push(
          error(
            'code-missing',
            `a choice in list "${listName}" has no code (name)`,
            listName,
          ),
        );
      }
      return;
    }
    // Duplicate codes collide in LimeSurvey and make answers ambiguous.
    const seen = codesByList.get(listName) ?? new Set<string>();
    if (seen.has(code)) {
      errors.push(
        error(
          'code-duplicate',
          `answer code "${code}" is used more than once in list "${listName}"`,
          listName,
        ),
      );
    }
    seen.add(code);
    codesByList.set(listName, seen);
    if (!lsRules) return;
    if (!CHOICE_RE.test(code)) {
      errors.push(
        error(
          'code-invalid',
          `answer code "${code}" (list "${listName}") must match ${CHOICE_RULES.pattern} (letters/digits only)`,
          listName,
        ),
      );
    } else if (code.length > CHOICE_RULES.maxLength) {
      errors.push(
        error(
          'code-too-long',
          `answer code "${code}" (list "${listName}") exceeds the ${CHOICE_RULES.maxLength}-character limit`,
          listName,
        ),
      );
    }
  }

  /**
   * Validate an XLSForm against the registry-defined allowed subset, returning
   * every finding (does not throw). The subset is entirely registry-driven:
   *   - question types      → `TYPE_MAPPINGS` (registered + LS-expressible)
   *   - appearances         → `APPEARANCES` allowlist (+ valid-for-type)
   *   - names / answer codes → `conventions.sanitization` (alnum, length, unique)
   *
   * Errors block a lossless transform; warnings are silently dropped by the
   * converter (e.g. an unknown appearance). Surfaced via the `validate` CLI
   * command and the `validateXlsform` export.
   */
  static validateSubset(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    options: SubsetOptions = {},
  ): SubsetViolation[] {
    const violations: SubsetViolation[] = [];

    const target = options.target ?? 'lstsv';
    violations.push(
      ...this.collectNameCodeDiagnostics(surveyData, choicesData, target),
    );

    const ctx: RowCheckContext = {
      listNames: this.listNamesOf(choicesData),
      fileChoices: options.fileChoices,
      target,
    };
    for (const row of surveyData) {
      const problem = this.rowDiagnostic(row, ctx);
      if (problem) violations.push(problem);
      this.collectAppearanceViolations(row, violations);
      const dropped = this.droppedHint(row, target);
      if (dropped) violations.push(dropped);
    }

    for (const choice of choicesData) {
      const found = this.emptyChoiceLabel(choice);
      if (found) violations.push(found);
    }
    violations.push(...this.exclusiveProblems(surveyData, choicesData));

    return violations;
  }

  /**
   * A choice whose label is empty, in every language or in some, shows as a
   * blank option. A warning: the form still converts.
   */
  private static emptyChoiceLabel(choice: ChoiceRow): Diagnostic | null {
    const code = (choice.name ?? '').toString().trim();
    if (!code) return null; // reported as a missing code
    const listName = String(choice.list_name ?? '').trim();
    const where = `choice "${code}" (list "${listName}")`;
    const labels = this.choiceLabels(choice);
    const missing = [...labels]
      .filter(([, text]) => text === '')
      .map(([k]) => k);
    if (labels.size > 0 && missing.length === 0) return null;
    const message =
      labels.size === 0 || missing.length === labels.size
        ? `${where} has no label`
        : `${where} has no label in: ${missing.join(', ')}`;
    return warning('label-missing', message, listName);
  }

  /**
   * A hint the target has no place for. DDI: a `select_multiple` becomes a
   * group of binary variables with no per-question text, so its `hint` and
   * `guidance_hint` are lost. LimeSurvey: `guidance_hint` has no equivalent
   * (`hint` becomes the question's help text).
   */
  private static droppedHint(
    row: SurveyRow,
    target: SubsetTarget,
  ): Diagnostic | null {
    const has = (col: string) =>
      Object.entries(row).some(
        ([k, v]) =>
          (k === col || k.startsWith(`${col}::`)) && cellText(v) !== '',
      ) ||
      (col === 'guidance_hint' &&
        /(^|;)\s*guidance_hint\s*=/.test(cellText(row['parameters'])));
    const baseType = (row.type || '').trim().split(/\s+/)[0];
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    let lost: string[] = [];
    let why = '';
    if (target === 'ddi' && baseType === 'select_multiple') {
      lost = ['hint', 'guidance_hint'].filter(has);
      why = 'a select_multiple has no per-question text slot in DDI';
    } else if (target === 'lstsv') {
      lost = ['guidance_hint'].filter(has);
      why = 'LimeSurvey has no equivalent';
    }
    if (lost.length === 0) return null;
    return warning(
      'hint-dropped',
      `${lost.join(' and ')} on "${name}" is not carried over: ${why}`,
      name,
    );
  }

  /** List names with at least one row on the choices sheet. */
  static listNamesOf(choicesData: ChoiceRow[]): Set<string> {
    return new Set(choicesData.map((c) => String(c.list_name ?? '').trim()));
  }

  /**
   * A choice's label text per language, trimmed (`''` = empty). Covers the
   * loader's shape (`label` as a string, or `{lang: text}` with `_languages`)
   * and raw rows that keep `label::<lang>` columns (Kobo's layout once a form
   * declares a language). A plain `label` is keyed `''`.
   */
  private static choiceLabels(choice: ChoiceRow): Map<string, string> {
    const out = new Map<string, string>();
    const text = (v: unknown) =>
      typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    const label = choice.label;
    if (label !== null && typeof label === 'object') {
      for (const lang of choice._languages ?? Object.keys(label)) {
        out.set(lang, text(label[lang]));
      }
    } else if (label !== undefined) {
      out.set('', text(label));
    }
    for (const [key, value] of Object.entries(choice)) {
      if (key.startsWith('label::'))
        out.set(key.slice('label::'.length), text(value));
    }
    return out;
  }

  /**
   * The error that keeps one survey row out of the subset (an unregistered or
   * unsupported type, or a select whose answer options can't be resolved), or
   * `null`. The single row check: {@link validateSubset} collects it for every
   * row, and the converters throw it.
   */
  static rowDiagnostic(
    row: SurveyRow,
    ctx: RowCheckContext,
  ): Diagnostic | null {
    const rawType = (row.type || '').trim();
    if (!rawType) return null;
    const baseType = rawType.split(/\s+/)[0];
    if (STRUCTURAL.has(rawType) || METADATA_TYPES.has(baseType)) return null;

    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const where = name ? ` (question "${name}")` : '';
    return (
      this.typeProblem(baseType, where, name, ctx.target ?? 'lstsv') ??
      (TYPE_MAPPINGS[baseType]?.requiresListName
        ? this.choiceListProblem(rawType, baseType, where, name, ctx)
        : null)
    );
  }

  /**
   * `exclusive` marks that have no effect: an unrecognised value, or a list
   * that no `select_multiple` uses (convention:exclusiveChoice).
   */
  private static exclusiveProblems(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
  ): Diagnostic[] {
    const multiLists = new Set<string>();
    for (const row of surveyData) {
      const [base, list] = String(row.type ?? '')
        .trim()
        .split(/\s+/);
      if (list && EXCLUSIVE_RULE.appliesTo.includes(base)) multiLists.add(list);
    }
    const col = EXCLUSIVE_RULE.choicesColumn;
    const problems: Diagnostic[] = [];
    for (const choice of choicesData) {
      const cell = exclusiveCell(choice);
      if (!cell || cell === 'no' || cell === 'false' || cell === '0') continue;
      const listName = String(choice.list_name ?? '').trim();
      const where = `choice "${String(choice.name ?? '').trim()}" (list "${listName}")`;
      if (!isExclusive(choice)) {
        problems.push(
          warning(
            'exclusive-invalid',
            `${where}: "${col}" value "${cell}" isn't recognised (use ${EXCLUSIVE_RULE.trueValues.join('/')}) and is ignored`,
            listName,
          ),
        );
      } else if (!multiLists.has(listName)) {
        problems.push(
          warning(
            'exclusive-no-effect',
            `${where} is marked "${col}", but no ${EXCLUSIVE_RULE.appliesTo.join('/')} uses this list, so it has no effect`,
            listName,
          ),
        );
      }
    }
    return problems;
  }

  /** Why a type is outside the subset, or `null` if it's in it. */
  private static typeProblem(
    baseType: string,
    where: string,
    name: string,
    target: SubsetTarget,
  ): Diagnostic | null {
    const mapping = TYPE_MAPPINGS[baseType];
    if (!mapping) {
      return error(
        'type-unregistered',
        `type "${baseType}"${where} is not in the registry — not part of the supported XLSForm subset`,
        name,
      );
    }
    // select_*_from_file is registered-but-not-natively-expressible; it is
    // still supported (inlined from the CSV), so only flag other such types.
    if (
      target === 'lstsv' &&
      mapping.supported === false &&
      mapping.limeSurveyType === null &&
      !isFromFileType(baseType)
    ) {
      return error(
        'type-unsupported',
        `type "${baseType}"${where} is registered but not expressible in LimeSurvey TSV`,
        name,
      );
    }
    return null;
  }

  /**
   * Why a select's answer options can't be resolved, or `null` if they can.
   * `select_one`/`select_multiple` need a list name with rows on the choices
   * sheet; `select_*_from_file` needs a registered vocabulary or a file in
   * `fileChoices`. Without options the converter emits a question with no
   * answers, or fails.
   */
  private static choiceListProblem(
    rawType: string,
    baseType: string,
    where: string,
    name: string,
    ctx: RowCheckContext,
  ): Diagnostic | null {
    const target = rawType.split(/\s+/)[1];
    if (isFromFileType(baseType)) {
      if (!target) {
        return error(
          'vocab-file-missing',
          `"${baseType}"${where} needs a vocabulary file: "${baseType} <file>.csv"`,
          name,
        );
      }
      if (registeredVocabFiles().includes(target)) return null;
      if ((ctx.fileChoices?.[target]?.length ?? 0) > 0) return null;
      return error(
        'vocab-unregistered',
        `"${rawType}"${where}: "${target}" is not a registered vocabulary (registered: ${registeredVocabFiles().join(', ')})`,
        name,
      );
    }
    if (!target || target === 'or_other') {
      return error(
        'choice-list-missing',
        `"${baseType}"${where} needs a choice list: "${baseType} <list_name>"`,
        name,
      );
    }
    if (!ctx.listNames.has(target)) {
      return error(
        'choice-list-empty',
        `"${rawType}"${where}: list "${target}" has no rows on the choices sheet`,
        name,
      );
    }
    return null;
  }

  /**
   * Warnings for appearances outside the registry allowlist or wrong for the
   * row's type (the converter ignores them). Shared by {@link validateSubset}
   * and the converter.
   */
  static appearanceDiagnostics(row: SurveyRow): Diagnostic[] {
    const found: Diagnostic[] = [];
    this.collectAppearanceViolations(row, found);
    return found;
  }

  private static collectAppearanceViolations(
    row: SurveyRow,
    violations: SubsetViolation[],
  ): void {
    const appearance =
      typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';
    if (!appearance) return;
    const baseType = (row.type || '').trim().split(/\s+/)[0];
    const name = typeof row.name === 'string' ? row.name : '';
    for (const part of appearance.split(/\s+/)) {
      const spec = APPEARANCES[part];
      if (!spec) {
        violations.push(
          warning(
            'appearance-unregistered',
            `appearance "${part}" on "${name}" is not in the registry allowlist and will be ignored`,
            name,
          ),
        );
      } else if (spec.validForTypes && !spec.validForTypes.includes(baseType)) {
        violations.push(
          warning(
            'appearance-invalid-for-type',
            `appearance "${part}" on "${name}" is not valid for type "${baseType}" and will be ignored`,
            name,
          ),
        );
      }
    }
  }
}

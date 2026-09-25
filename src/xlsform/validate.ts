import conventions from '../generated/conventions.js';
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
export interface SubsetViolation {
  severity: 'error' | 'warning';
  message: string;
}

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
}

// The semi-open `<base>_other` follow-up (convention:other): LimeSurvey
// carries "other" via its native `other=Y` setting, so the suffix's underscore
// is a source-side marker, not a literal LS code — validate only `<base>`.

export class XLSValidator {
  /**
   * Validate that required sheets are present
   * @param hasSurveySheet Whether survey sheet was found
   * @param hasChoicesSheet Whether choices sheet was found
   * @throws Error if required sheets are missing
   */
  static validateRequiredSheets(
    hasSurveySheet: boolean,
    hasChoicesSheet: boolean,
  ): void {
    const missingSheets = [];
    if (!hasSurveySheet) missingSheets.push('survey');
    if (!hasChoicesSheet) missingSheets.push('choices');

    if (missingSheets.length > 0) {
      throw new Error(
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
  ): void {
    if (data.length === 0) {
      console.warn(`Warning: Survey sheet "${sheetName}" is empty.`);
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
      console.warn(
        `Warning: Survey sheet "${sheetName}" has no valid data rows.`,
      );
      return;
    }

    // Check for required columns across all rows
    const requiredColumns = ['type', 'name', 'label'];
    const missingColumns = requiredColumns.filter(
      (col) => !allColumns.has(col),
    );

    if (missingColumns.length > 0) {
      throw new Error(
        `Survey sheet "${sheetName}" is missing required columns: ${missingColumns.join(', ')}. A survey sheet must contain type, name, and label columns.`,
      );
    }

    // Warn about unexpected columns
    const expectedColumns = [
      'type',
      'name',
      'label',
      'hint',
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
      console.warn(
        `Warning: Survey sheet "${sheetName}" contains unexpected columns: ${unexpectedColumns.join(', ')}. These columns will be ignored.`,
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
  ): void {
    if (data.length === 0) {
      console.warn(`Warning: Choices sheet "${sheetName}" is empty.`);
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
      console.warn(
        `Warning: Choices sheet "${sheetName}" has no valid data rows.`,
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
      throw new Error(
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
      console.warn(
        `Warning: Choices sheet "${sheetName}" contains unexpected columns: ${unexpectedColumns.join(', ')}. These columns will be ignored.`,
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
    } = opts;

    // Validate required sheets
    this.validateRequiredSheets(hasSurveySheet, hasChoicesSheet);

    // Validate survey sheet columns
    if (hasSurveySheet && surveyData.length > 0) {
      this.validateSurveySheetColumns(surveyData, surveySheetName);
    }

    // Validate choices sheet columns
    if (hasChoicesSheet && choicesData.length > 0) {
      this.validateChoicesSheetColumns(choicesData, choicesSheetName);
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
   * @throws Error listing every offending name/code.
   */
  static validateNamesAndCodes(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
  ): void {
    const errors = this.collectNameCodeErrors(surveyData, choicesData);
    if (errors.length > 0) {
      throw new Error(
        `XLSForm uses ${errors.length} name(s)/code(s) that LimeSurvey cannot represent. ` +
          `Fix them at the source (or pass skipValidation to sanitize instead, losing round-trip fidelity):\n  - ` +
          errors.join('\n  - '),
      );
    }
  }

  /** Collect (without throwing) every name/code that breaks the LS rules. */
  static collectNameCodeErrors(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
    target: SubsetTarget = 'lstsv',
  ): string[] {
    const errors: string[] = [];
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
    errors: string[],
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
        `field name "${name}" must match ${NAME_RULES.pattern} (letters/digits only — no underscores, hyphens or spaces)`,
      );
    } else if (lsLength > NAME_RULES.maxLength) {
      errors.push(
        `field name "${name}" exceeds the ${NAME_RULES.maxLength}-character limit`,
      );
    }

    if (seen.has(name)) {
      errors.push(`field name "${name}" is used more than once`);
    }
    seen.add(name);
  }

  private static collectChoiceCodeError(
    choice: ChoiceRow,
    codesByList: Map<string, Set<string>>,
    lsRules: boolean,
    errors: string[],
  ): void {
    const code = (choice.name ?? '').toString().trim();
    const listName = String(choice.list_name ?? '').trim();
    if (!code) {
      // A row with a list but no code would be dropped from the question.
      if (listName) {
        errors.push(`a choice in list "${listName}" has no code (name)`);
      }
      return;
    }
    // Duplicate codes collide in LimeSurvey and make answers ambiguous.
    const seen = codesByList.get(listName) ?? new Set<string>();
    if (seen.has(code)) {
      errors.push(
        `answer code "${code}" is used more than once in list "${listName}"`,
      );
    }
    seen.add(code);
    codesByList.set(listName, seen);
    if (!lsRules) return;
    if (!CHOICE_RE.test(code)) {
      errors.push(
        `answer code "${code}" (list "${listName}") must match ${CHOICE_RULES.pattern} (letters/digits only)`,
      );
    } else if (code.length > CHOICE_RULES.maxLength) {
      errors.push(
        `answer code "${code}" (list "${listName}") exceeds the ${CHOICE_RULES.maxLength}-character limit`,
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
    for (const msg of this.collectNameCodeErrors(
      surveyData,
      choicesData,
      target,
    )) {
      violations.push({ severity: 'error', message: msg });
    }

    const listNames = new Set(
      choicesData.map((c) => String(c.list_name ?? '').trim()),
    );

    for (const row of surveyData) {
      this.collectRowViolations(row, listNames, options, violations);
    }

    for (const choice of choicesData) {
      const message = this.emptyChoiceLabel(choice);
      if (message) violations.push({ severity: 'warning', message });
    }
    for (const message of this.exclusiveProblems(surveyData, choicesData)) {
      violations.push({ severity: 'warning', message });
    }

    return violations;
  }

  /**
   * A choice whose label is empty, in every language or in some, shows as a
   * blank option. A warning: the form still converts.
   */
  private static emptyChoiceLabel(choice: ChoiceRow): string | null {
    const code = (choice.name ?? '').toString().trim();
    if (!code) return null; // reported as a missing code
    const where = `choice "${code}" (list "${String(choice.list_name ?? '').trim()}")`;
    const label = choice.label;
    if (label !== null && typeof label === 'object') {
      const langs = choice._languages ?? Object.keys(label);
      const missing = langs.filter(
        (lang) => String(label[lang] ?? '').trim() === '',
      );
      if (missing.length === 0) return null;
      if (missing.length === langs.length) return `${where} has no label`;
      return `${where} has no label in: ${missing.join(', ')}`;
    }
    return String(label ?? '').trim() === '' ? `${where} has no label` : null;
  }

  /** Type, choice-list and appearance findings for one survey row. */
  private static collectRowViolations(
    row: SurveyRow,
    listNames: Set<string>,
    options: SubsetOptions,
    violations: SubsetViolation[],
  ): void {
    const rawType = (row.type || '').trim();
    if (!rawType) return;
    const baseType = rawType.split(/\s+/)[0];
    if (STRUCTURAL.has(rawType) || METADATA_TYPES.has(baseType)) return;

    const where = row.name ? ` (question "${row.name}")` : '';
    const problem =
      this.typeProblem(baseType, where, options.target ?? 'lstsv') ??
      (TYPE_MAPPINGS[baseType]?.requiresListName
        ? this.choiceListProblem(
            rawType,
            baseType,
            where,
            listNames,
            options.fileChoices ?? {},
          )
        : null);
    if (problem) violations.push({ severity: 'error', message: problem });

    this.collectAppearanceViolations(row, baseType, violations);
  }

  /**
   * `exclusive` marks that have no effect: an unrecognised value, or a list
   * that no `select_multiple` uses (convention:exclusiveChoice).
   */
  private static exclusiveProblems(
    surveyData: SurveyRow[],
    choicesData: ChoiceRow[],
  ): string[] {
    const multiLists = new Set<string>();
    for (const row of surveyData) {
      const [base, list] = String(row.type ?? '')
        .trim()
        .split(/\s+/);
      if (list && EXCLUSIVE_RULE.appliesTo.includes(base)) multiLists.add(list);
    }
    const col = EXCLUSIVE_RULE.choicesColumn;
    const problems: string[] = [];
    for (const choice of choicesData) {
      const cell = exclusiveCell(choice);
      if (!cell || cell === 'no' || cell === 'false' || cell === '0') continue;
      const where = `choice "${String(choice.name ?? '').trim()}" (list "${String(choice.list_name ?? '').trim()}")`;
      if (!isExclusive(choice)) {
        problems.push(
          `${where}: "${col}" value "${cell}" isn't recognised (use ${EXCLUSIVE_RULE.trueValues.join('/')}) and is ignored`,
        );
      } else if (!multiLists.has(String(choice.list_name ?? '').trim())) {
        problems.push(
          `${where} is marked "${col}", but no ${EXCLUSIVE_RULE.appliesTo.join('/')} uses this list, so it has no effect`,
        );
      }
    }
    return problems;
  }

  /** Why a type is outside the subset, or `null` if it's in it. */
  private static typeProblem(
    baseType: string,
    where: string,
    target: SubsetTarget,
  ): string | null {
    const mapping = TYPE_MAPPINGS[baseType];
    if (!mapping) {
      return `type "${baseType}"${where} is not in the registry — not part of the supported XLSForm subset`;
    }
    // select_*_from_file is registered-but-not-natively-expressible; it is
    // still supported (inlined from the CSV), so only flag other such types.
    if (
      target === 'lstsv' &&
      mapping.supported === false &&
      mapping.limeSurveyType === null &&
      !isFromFileType(baseType)
    ) {
      return `type "${baseType}"${where} is registered but not expressible in LimeSurvey TSV`;
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
    listNames: Set<string>,
    fileChoices: Record<string, ChoiceRow[]>,
  ): string | null {
    const target = rawType.split(/\s+/)[1];
    if (isFromFileType(baseType)) {
      if (!target) {
        return `"${baseType}"${where} needs a vocabulary file: "${baseType} <file>.csv"`;
      }
      if (registeredVocabFiles().includes(target)) return null;
      if ((fileChoices[target]?.length ?? 0) > 0) return null;
      return `"${rawType}"${where}: "${target}" is not a registered vocabulary (registered: ${registeredVocabFiles().join(', ')})`;
    }
    if (!target || target === 'or_other') {
      return `"${baseType}"${where} needs a choice list: "${baseType} <list_name>"`;
    }
    if (!listNames.has(target)) {
      return `"${rawType}"${where}: list "${target}" has no rows on the choices sheet`;
    }
    return null;
  }

  /** Flag appearances outside the registry allowlist or wrong for the type. */
  private static collectAppearanceViolations(
    row: SurveyRow,
    baseType: string,
    violations: SubsetViolation[],
  ): void {
    const appearance =
      typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';
    if (!appearance) return;
    for (const part of appearance.split(/\s+/)) {
      const spec = APPEARANCES[part];
      if (!spec) {
        violations.push({
          severity: 'warning',
          message: `appearance "${part}" on "${row.name}" is not in the registry allowlist and will be ignored`,
        });
      } else if (spec.validForTypes && !spec.validForTypes.includes(baseType)) {
        violations.push({
          severity: 'warning',
          message: `appearance "${part}" on "${row.name}" is not valid for type "${baseType}" and will be ignored`,
        });
      }
    }
  }
}

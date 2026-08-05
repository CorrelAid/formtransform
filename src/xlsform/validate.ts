import conventions from '../generated/conventions.json' with { type: 'json' };
import { APPEARANCES } from '../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';

import { SurveyRow, ChoiceRow } from '../config/types.js';

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
const METADATA_TYPES = new Set<string>(
  conventions.conventions.unregisteredRows.metadataRowTypes,
);

/** A single subset-validation finding. */
export interface SubsetViolation {
  severity: 'error' | 'warning';
  message: string;
}

/** Inputs for {@link XLSValidator.validateAll}. */
export interface ValidateAllOpts {
  surveyData: SurveyRow[];
  choicesData: ChoiceRow[];
  hasSurveySheet: boolean;
  hasChoicesSheet: boolean;
  surveySheetName?: string;
  choicesSheetName?: string;
}

// The semi-open `<base>_other` follow-up is a registry convention. LimeSurvey
// carries "other" via its native `other=Y` setting, so this underscore is a
// source-side marker, not a literal LS code — validate only the `<base>` part.
const OTHER_SUFFIX = '_other';

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
  ): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const row of surveyData) {
      this.collectSurveyNameError(row, seen, errors);
    }
    for (const choice of choicesData) {
      this.collectChoiceCodeError(choice, errors);
    }

    return errors;
  }

  private static collectSurveyNameError(
    row: SurveyRow,
    seen: Set<string>,
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
    const lsLength = isOther ? base.length + 'other'.length : name.length;

    if (!NAME_RE.test(base)) {
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
    errors: string[],
  ): void {
    const code = (choice.name ?? '').toString().trim();
    if (!code) return;
    const listName = choice.list_name ?? '';
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
  ): SubsetViolation[] {
    const violations: SubsetViolation[] = [];

    for (const msg of this.collectNameCodeErrors(surveyData, choicesData)) {
      violations.push({ severity: 'error', message: msg });
    }

    for (const row of surveyData) {
      const rawType = (row.type || '').trim();
      if (!rawType) continue;
      const baseType = rawType.split(/\s+/)[0];
      if (STRUCTURAL.has(rawType) || METADATA_TYPES.has(baseType)) continue;

      const mapping = TYPE_MAPPINGS[baseType];
      const where = row.name ? ` (question "${row.name}")` : '';
      if (!mapping) {
        violations.push({
          severity: 'error',
          message: `type "${baseType}"${where} is not in the registry — not part of the supported XLSForm subset`,
        });
      } else if (
        mapping.supported === false &&
        mapping.limeSurveyType === null
      ) {
        // select_*_from_file is registered-but-not-natively-expressible; it is
        // still supported (inlined from the CSV), so only flag other such types.
        if (!baseType.endsWith('_from_file')) {
          violations.push({
            severity: 'error',
            message: `type "${baseType}"${where} is registered but not expressible in LimeSurvey TSV`,
          });
        }
      }

      this.collectAppearanceViolations(row, baseType, violations);
    }

    return violations;
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

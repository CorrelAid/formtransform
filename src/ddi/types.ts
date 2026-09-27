/**
 * Canonical, source-agnostic survey model consumed by the DDI emitter.
 *
 * A survey is flattened into an ordered list of {@link Variable}s. Each carries
 * the standardized type slug (see `TYPE_MAP` in `src/generated/DdiMappings.ts`),
 * its label, enclosing-group metadata, and resolved choices.
 */

/**
 * The form's own texts in its other languages (#135): language tag → text.
 * The base-language text stays in the plain field; nothing here is ever a
 * machine translation.
 */
export type Translations = Record<string, string>;

/** A single answer option of a categorical question. */
export interface Choice {
  name: string;
  label: string;
  /** `label` in the form's other languages. */
  translations?: Translations;
  /** Marked `exclusive` (convention:exclusiveChoice): a `cdl:exclusive` note. */
  exclusive?: boolean;
  /** The choices sheet's other columns: `cdl:choice_column` notes (#160). */
  columns?: Record<string, string>;
}

/**
 * A group the variable is in (#152): one object per group, shared by all its
 * members, so the DDI can give every group a `<varGrp>`.
 */
export interface DdiGroup {
  /** Its own name. */
  name: string;
  /** Slash-joined path from the top level, the `varGrp/@name`. */
  path: string;
  label: string;
  /** `label` in the form's other languages. */
  translations?: Translations;
  /** Lowercased `appearance`. */
  appearance: string;
  /** Its own `relevant` (XPath); `''` when none. */
  relevant: string;
  /** Its `hint`: a `cdl:hint` note (#153); `''` when none. */
  hint: string;
  /** It has no label of its own: `label` is its name (`cdl:no_label`, #160). */
  unlabelled?: boolean;
  /** Its columns the model doesn't lift: `cdl:column` notes (#160). */
  columns?: Record<string, string>;
  /** `hint` in the form's other languages. */
  hintTranslations?: Translations;
}

/** A variable's texts in one of the form's other languages. */
export interface VariableTexts {
  label?: string;
  hint?: string;
  guidanceHint?: string;
  groupLabel?: string;
  constraintMessage?: string;
}

/** One data-carrying (or note) row of a survey, normalized. */
export interface Variable {
  /** Field name (XLSForm `name` column). */
  name: string;
  /** Standardized type slug, e.g. `select_one`, `integer`, `note`. */
  type: string;
  /** Human-readable question label. */
  label: string;
  /** Slash-joined enclosing group path, or `''` when top-level. */
  group: string;
  /** Label of the innermost enclosing group. */
  groupLabel: string;
  /** Lowercased `appearance` of the innermost enclosing group. */
  groupAppearance: string;
  /** Referenced choice list name (`select_*`), else `''`. */
  listName: string;
  /** External code-list vocab stem (`select_*_from_file`), else `''`. */
  vocab: string;
  /** Resolved answer options; empty for non-categorical / external-list types. */
  choices: Choice[];
  /** XLSForm `hint`, emitted as `<qstn><postQTxt>` (#153). */
  hint?: string;
  /** XLSForm `guidance_hint`, emitted as `<qstn><ivuInstr>`. */
  guidanceHint?: string;
  /**
   * The enclosing groups, outermost first (#152). Without it the codebook
   * has no `section` groups.
   */
  groups?: DdiGroup[];
  /**
   * Its own XLSForm `relevant` (XPath): a `cdl:relevant` note, and with the
   * groups' conditions the `<universe>` prose (#151).
   */
  relevant?: string;
  /** XLSForm `constraint` (XPath): a `cdl:constraint` note, maybe `<valrng>`. */
  constraint?: string;
  /** XLSForm `constraint_message`: a `cdl:constraint_message` note. */
  constraintMessage?: string;
  /** XLSForm `required`: a `cdl:required` note. */
  required?: boolean;
  /** The `required` cell when it isn't `yes` (`TRUE`), the note's text (#160). */
  requiredCell?: string;
  /** XLSForm `default`: a `cdl:default` note (#153). */
  default?: string;
  /** The question's own lowercased `appearance`: a `cdl:appearance` note. */
  appearance?: string;
  /** XLSForm `parameters` as authored (#153). */
  parameters?: string;
  /** Its texts in the form's other languages, by language tag (#135). */
  translations?: Record<string, VariableTexts>;
  /**
   * A select whose "other" answer and companion were added, not authored: a
   * `cdl:or_other` note (#160). `shorthand` from the XLSForm type cell's
   * `or_other`, `added` from a source that only says it has one
   * (LimeSurvey's `other=Y`).
   */
  orOther?: 'shorthand' | 'added';
  /** The `or_other` companion the projection added, not an authored row. */
  synthesized?: boolean;
  /**
   * Its columns the model doesn't lift: `cdl:column` notes, a row's without
   * data or a note's `cdl:row_column` (#160).
   */
  columns?: Record<string, string>;
  /**
   * A row with no data column (a metadata row, a matrix header): its type
   * cell, a `cdl:row` note (#160).
   */
  row?: string;
}

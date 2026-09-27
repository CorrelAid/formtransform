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
  /** XLSForm `hint`, emitted as `<qstn><preQTxt>` (after any folded note). */
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
  /** Its texts in the form's other languages, by language tag (#135). */
  translations?: Record<string, VariableTexts>;
}

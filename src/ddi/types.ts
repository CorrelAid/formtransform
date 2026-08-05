/**
 * Canonical, source-agnostic survey model consumed by the DDI emitter.
 *
 * A survey is flattened into an ordered list of {@link Variable}s. Each carries
 * the standardized type slug (see `TYPE_MAP` in `src/generated/DdiMappings.ts`),
 * its label, enclosing-group metadata, and resolved choices.
 */

/** A single answer option of a categorical question. */
export interface Choice {
  name: string;
  label: string;
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
}

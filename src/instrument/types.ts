/**
 * The parsed survey instrument (#69): one source-independent model every
 * direction parses into and emits from, instead of each pipeline mapping
 * rows to rows and re-deriving groups, grids and the other pattern.
 *
 *   XLSForm rows ──parse──┐                 ┌──emit── DDI (via Variable[])
 *                         ├──▶ Instrument ──┤
 *   LimeSurvey TSV ─parse─┘                 └──emit── LimeSurvey TSV, XLSForm
 *
 * It keeps what the sources say, in their vocabulary (XLSForm type names,
 * XPath expressions), and every language. Target-specific decisions (names
 * sanitized for LimeSurvey, the DDI's single language) belong to emitters.
 */

/**
 * Translatable text: language tag → text. `''` is the untagged value (a plain
 * `label` column, or a single-language form). Empty when absent.
 */
export type Text = Record<string, string>;

/** One answer option of a choice list. */
export interface InstrumentChoice {
  name: string;
  label: Text;
  /** The source row, for columns the model doesn't lift yet. */
  row: Record<string, unknown>;
}

/** Fields every item has. */
interface ItemBase {
  /** As authored (not sanitized for any target). */
  name: string;
  label: Text;
  hint: Text;
  /** XPath, as authored; `''` when absent. */
  relevant: string;
  /** Lowercased and trimmed; `''` when absent. */
  appearance: string;
  /** The source row, for columns the model doesn't lift yet. */
  row: Record<string, unknown>;
}

export interface GroupItem extends ItemBase {
  kind: 'group';
  children: Item[];
}

export interface QuestionItem extends ItemBase {
  kind: 'question';
  /** XLSForm base type (`select_one`, `integer`, `note`, …). */
  type: string;
  /** The whole type cell (`select_one colors or_other`). */
  rawType: string;
  /** Choice list name of a `select_*`; `''` otherwise. */
  list: string;
  /** Vocabulary file of a `select_*_from_file` (`iso_3166_1.csv`); `''` otherwise. */
  file: string;
  /** The `or_other` shorthand on the type. */
  orOther: boolean;
  guidanceHint: Text;
  constraint: string;
  constraintMessage: Text;
  required: boolean;
  default: string;
  /** The `parameters` cell as authored. */
  parameters: string;
  /**
   * The free-text "other" answer's label, when the source has one apart from
   * a companion question (LimeSurvey's `other_replace_text`).
   */
  otherLabel?: Text;
}

export type Item = GroupItem | QuestionItem;

export interface Instrument {
  /** Language tags in the order the source first uses them; `['']` if untagged. */
  languages: string[];
  /** `settings.default_language` as a tag, when set. */
  defaultLanguage?: string;
  /** The settings sheet's first row, as authored. */
  settings: Record<string, unknown>;
  /** Choice lists by list name, in sheet order. */
  lists: Record<string, InstrumentChoice[]>;
  /** Top-level items in survey order. */
  body: Item[];
}

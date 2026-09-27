/**
 * The form's remaining fields in the DDI (`convention:ddiFields`, #153): in a
 * standard element or attribute where DDI 2.5 has one, else a typed note
 * `<notes type="cdl:<field>">`.
 */
import conventions from '../generated/conventions.js';
import { allColumns } from '../conventions/columns.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';
import { parseParameters } from '../utils/parameters.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';
import { localizedChild, textsOf } from './translations.js';
import type { Choice, DdiGroup, Variable } from './types.js';
import type { XmlElement } from './xml.js';

const NOTES = conventions.conventions.ddiFields.notes;

/** A `range`'s bounds, the registry's defaults where not authored. */
export function rangeBounds(v: Variable): { min: string; max: string } {
  const values = {
    ...(TYPE_MAPPINGS['range']?.parameters ?? {}),
    ...parseParameters(v.parameters ?? ''),
  };
  return { min: values['start'], max: values['end'] };
}

/** A question's `cdl:default`, `cdl:appearance` and `cdl:parameters`. */
export function addFieldNotes(el: XmlElement, v: Variable): void {
  if (v.default) {
    el.textChild('notes', v.default, { type: NOTES.default.type });
  }
  if (v.appearance) {
    el.textChild('notes', v.appearanceCell ?? v.appearance, {
      type: NOTES.appearance.type,
    });
  }
  // As authored (#160): a range's bounds are its valrng too, and a
  // guidance_hint inside is its ivuInstr too, but only the cell says so.
  if (v.parameters) {
    el.textChild('notes', v.parameters, { type: NOTES.parameters.type });
  }
  addColumnNotes(el, v.columns);
}

/** A `select_multiple`'s exclusive choices as one `cdl:exclusive` note. */
export function addExclusiveNote(el: XmlElement, choices: Choice[]): void {
  const codes = choices.filter((c) => c.exclusive).map((c) => c.name);
  if (codes.length) {
    el.textChild('notes', codes.join(' '), { type: NOTES.exclusive.type });
  }
}

/**
 * A group's `cdl:hint` (per language) and `cdl:appearance`. A grid's
 * `table-list` is its `type="grid"`, so only another appearance is noted.
 */
export function addGroupFieldNotes(
  el: XmlElement,
  group: DdiGroup,
  grid: boolean,
): void {
  if (group.hint) {
    localizedChild(el, 'notes', group.hint, group.hintTranslations, {
      type: NOTES.hint.type,
    });
  }
  const gridOnly =
    grid && group.appearance === GRID_APPEARANCE && !group.appearanceCell;
  if (group.appearance && !gridOnly) {
    el.textChild('notes', group.appearanceCell ?? group.appearance, {
      type: NOTES.appearance.type,
    });
  }
  // Its txt is its name, for readers that show one (#160).
  if (group.unlabelled) {
    el.textChild('notes', 'yes', { type: NOTES.no_label.type });
  }
  addColumnNotes(el, group.columns);
  addColumnNotes(el, group.endColumns, NOTES.end_column.type);
}

/** Settings in a standard element: `titl`, `IDNo`, `verStmt/version`. */
const STANDARD_SETTINGS = new Set<string>(NOTES.setting.standard);

/**
 * Every setting DDI has no element for, as `cdl:setting` notes by key
 * (#160). `default_language` too, as authored: `codeBook/@xml:lang` is also
 * set without it (a LimeSurvey survey's language, a multilingual form's first).
 */
export function addSettingNotes(
  stdy: XmlElement,
  settings: Record<string, unknown>,
): void {
  // A setting per language is one note per `<key>::<language>` (#160).
  const cells = allColumns(settings);
  for (const column of Object.keys(cells).sort()) {
    const base = column.split('::')[0];
    // A standard setting, or one of its languages when titl/parTitl has them.
    if (STANDARD_SETTINGS.has(column)) continue;
    if (STANDARD_SETTINGS.has(base) && typeof settings[base] === 'object') {
      continue;
    }
    stdy.textChild('notes', cells[column], {
      type: NOTES.setting.type,
      subject: column,
    });
  }
}

/**
 * The form's languages (`cdl:language`), in its order, by tag with its own
 * name: all of a form in several, else one whose name isn't its bare tag.
 */
export function addLanguageNotes(
  stdy: XmlElement,
  names: Record<string, string>,
): void {
  const all = Object.keys(names).length > 1;
  for (const [tag, name] of Object.entries(names)) {
    if (name && (all || name !== tag)) {
      stdy.textChild('notes', name, {
        type: NOTES.language.type,
        subject: tag,
      });
    }
  }
}

/**
 * The list's name (`cdl:list`), when it isn't `named` (the question's own
 * name, a grid member's grid's): what a reader without the note assumes.
 */
export function addListNote(el: XmlElement, v: Variable, named: string): void {
  if (v.listName && v.listName !== named) {
    el.textChild('notes', v.listName, { type: NOTES.list.type });
  }
}

/**
 * A row without data on `stdyDscr` (#160): its type cell (`cdl:row`), label
 * and fields, by its name.
 */
export function addRowNotes(stdy: XmlElement, v: Variable): void {
  stdy.textChild('notes', v.row ?? v.type, {
    type: NOTES.row.type,
    subject: v.name,
  });
  addRowLabel(stdy, v);
  addRowFieldNotes(stdy, v);
}

/** A row's own label by its name (`cdl:row_label`), in every language. */
export function addRowLabel(stdy: XmlElement, v: Variable): void {
  if (v.label) {
    localizedChild(stdy, 'notes', v.label, textsOf(v, 'label'), {
      type: NOTES.row_label.type,
      subject: v.name,
    });
  }
}

/** A note row's or data-less row's hint, relevant, appearance and columns, by its name. */
export function addRowFieldNotes(stdy: XmlElement, v: Variable): void {
  const subject = v.name;
  addColumnNotes(stdy, v.columns, NOTES.row_column.type, `${subject} `);
  if (v.hint) {
    localizedChild(stdy, 'notes', v.hint, textsOf(v, 'hint'), {
      type: NOTES.row_hint.type,
      subject,
    });
  }
  if (v.relevant) {
    stdy.textChild('notes', v.relevant, {
      type: NOTES.row_relevant.type,
      subject,
    });
  }
  if (v.appearance) {
    stdy.textChild('notes', v.appearanceCell ?? v.appearance, {
      type: NOTES.row_appearance.type,
      subject,
    });
  }
}

/**
 * Columns the model doesn't lift (#160), one note each with the column's
 * name as its subject (`prefix` first: the row or choice it belongs to).
 */
function addColumnNotes(
  el: XmlElement,
  columns: Record<string, string> | undefined,
  type: string = NOTES.column.type,
  prefix = '',
): void {
  for (const [column, cell] of Object.entries(columns ?? {})) {
    el.textChild('notes', cell, { type, subject: prefix + column });
  }
}

/**
 * The choices' columns the model doesn't lift (`cdl:choice_column`), on the
 * first question that uses the list: `written` has the lists already done.
 */
export function addChoiceColumnNotes(
  el: XmlElement,
  v: Variable,
  written: Set<string>,
): void {
  if (!v.listName || written.has(v.listName)) return;
  written.add(v.listName);
  for (const choice of v.choices) {
    addColumnNotes(
      el,
      choice.columns,
      NOTES.choice_column.type,
      `${choice.name} `,
    );
  }
}

/** The names of the note rows a lead-in text joins (`cdl:note_names`). */
export function addNoteNames(el: XmlElement, names: string[] | undefined) {
  if (names?.length) {
    el.textChild('notes', names.join(' '), { type: NOTES.note_names.type });
  }
}

/** The `${name}`s an expression refers to, in order, each once. */
export function references(expression: string): string[] {
  return [
    ...new Set([...expression.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1])),
  ];
}

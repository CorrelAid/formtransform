/**
 * The form's remaining fields in the DDI (`convention:ddiFields`, #153): in a
 * standard element or attribute where DDI 2.5 has one, else a typed note
 * `<notes type="cdl:<field>">`.
 */
import conventions from '../generated/conventions.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';
import { parseParameters } from '../utils/parameters.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';
import { localizedChild } from './translations.js';
import type { Choice, DdiGroup, Variable } from './types.js';
import type { XmlElement } from './xml.js';

const NOTES = conventions.conventions.ddiFields.notes;

/** `range`'s own bounds, which its `valrng` carries. */
const RANGE_BOUNDS = ['start', 'end'];

/**
 * The `parameters` DDI has no element for, as `key=value` tokens: without
 * `guidance_hint` (`ivuInstr`) and a range's `start`/`end` (`valrng`).
 */
export function otherParameters(v: Variable): string {
  const tokens: string[] = [];
  for (const part of (v.parameters ?? '').split(';')) {
    if (/^\s*guidance_hint\s*=/.test(part)) continue;
    for (const token of part.split(/[\s,]+/).filter(Boolean)) {
      const key = token.split('=')[0].trim().toLowerCase();
      if (v.type === 'range' && RANGE_BOUNDS.includes(key)) continue;
      tokens.push(token);
    }
  }
  return tokens.join(' ');
}

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
    el.textChild('notes', v.appearance, { type: NOTES.appearance.type });
  }
  const parameters = otherParameters(v);
  if (parameters) {
    el.textChild('notes', parameters, { type: NOTES.parameters.type });
  }
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
  if (group.appearance && !(grid && group.appearance === GRID_APPEARANCE)) {
    el.textChild('notes', group.appearance, { type: NOTES.appearance.type });
  }
}

/** The settings DDI has no element for, as `cdl:setting` notes. */
export function addSettingNotes(
  stdy: XmlElement,
  settings: Record<string, unknown>,
): void {
  for (const key of NOTES.setting.keys) {
    const value = settings[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (text) {
      stdy.textChild('notes', text, {
        type: NOTES.setting.type,
        subject: key,
      });
    }
  }
}

/** The `${name}`s an expression refers to, in order, each once. */
export function references(expression: string): string[] {
  return [
    ...new Set([...expression.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1])),
  ];
}

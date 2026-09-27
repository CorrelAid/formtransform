/**
 * DDI Codebook 2.5 → {@link Instrument} (#154): the reverse of the DDI
 * emitter, reading standard DDI first and the `cdl:` notes where DDI has no
 * element (`convention:logicMapping` `ddiEncoding`, `convention:ddiFields`).
 *
 * A codebook formtransform wrote gives back its form, up to the losses
 * `src/pipelines/ddi2xlsform/README.md` lists. Any other DDI (hand-written,
 * another tool's, a fragment) is read as far as its standard elements go:
 * never refused, with a warning for each field it can't supply.
 *
 * Input may be a whole `<codeBook>`, a `<dataDscr>`, or bare `<var>` /
 * `<varGrp>` elements.
 */
import conventions from '../generated/conventions.js';
import {
  ConversionError,
  warning,
  type WarningHandler,
} from '../diagnostics.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';
import { EXCLUSIVE_RULE } from '../conventions/exclusive.js';
import { OTHER_CODE, otherLabelFor } from '../conventions/other.js';
import { fromFileTypeFor } from '../conventions/fromFile.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';
import { parseParameters } from '../utils/parameters.js';
import {
  childNamed,
  childrenNamed,
  parseXml,
  textContent,
  type XmlNode,
} from '../utils/xmlParse.js';
import type {
  GroupItem,
  Instrument,
  InstrumentChoice,
  Item,
  QuestionItem,
  Text,
} from './types.js';

const LOGIC = conventions.conventions.logicMapping.ddiEncoding.notes;
const FIELDS = conventions.conventions.ddiFields.notes;

/** What reading one codebook needs. */
interface ReadState {
  /** The codebook's base language: `codeBook/@xml:lang`, else untagged. */
  base: string;
  /** Every language seen, base first. */
  languages: string[];
  vars: Map<string, XmlNode>;
  groups: Map<string, XmlNode>;
  /** Section / grid a `var` or `varGrp` is directly in. */
  parent: Map<string, string>;
  /** multipleResp / other `varGrp` a `var` belongs to. */
  owner: Map<string, string>;
  lists: Record<string, InstrumentChoice[]>;
  /** Choice set (as a key) → its list's name. */
  listByKey: Map<string, string>;
  names: Set<string>;
  onWarning?: WarningHandler;
}

// ── texts ────────────────────────────────────────────────────────────────

/** The elements' texts by language: untagged is the base. */
function texts(nodes: XmlNode[], state: ReadState): Text {
  const out: Text = {};
  for (const node of nodes) {
    const lang = node.attrs['xml:lang'] ?? state.base;
    const value = textContent(node).trim();
    if (!value || lang in out) continue;
    out[lang] = value;
    if (!state.languages.includes(lang)) state.languages.push(lang);
  }
  return out;
}

const childTexts = (node: XmlNode | undefined, name: string, s: ReadState) =>
  node ? texts(childrenNamed(node, name), s) : {};

/** The typed notes of one `cdl:` type. */
function notesOf(node: XmlNode, type: string): XmlNode[] {
  return childrenNamed(node, 'notes').filter((n) => n.attrs['type'] === type);
}

/** A typed note's base-language text (`''` when absent). */
function noteText(node: XmlNode, type: string, state: ReadState): string {
  const notes = notesOf(node, type);
  const base = notes.find(
    (n) => (n.attrs['xml:lang'] ?? state.base) === state.base,
  );
  const note = base ?? notes[0];
  return note ? textContent(note).trim() : '';
}

const ids = (value: string | undefined) =>
  (value ?? '').split(/\s+/).filter(Boolean);

// ── structure ────────────────────────────────────────────────────────────

/** The `var` / `varGrp` elements, wherever the input put them. */
function dataElements(roots: XmlNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (node: XmlNode) => {
    if (node.name === 'var' || node.name === 'varGrp') out.push(node);
    else if (node.name === 'codeBook' || node.name === 'dataDscr') {
      node.children.forEach(walk);
    }
  };
  roots.forEach(walk);
  return out;
}

const STRUCTURE_TYPES = new Set(['section', 'grid']);

/** Index the groups and who contains whom. */
function indexStructure(elements: XmlNode[], state: ReadState): void {
  for (const el of elements) {
    const id = el.attrs['ID'];
    if (!id) continue;
    if (el.name === 'var') state.vars.set(id, el);
    else state.groups.set(id, el);
  }
  for (const [id, grp] of state.groups) {
    const type = grp.attrs['type'] ?? '';
    const members = [...ids(grp.attrs['var']), ...ids(grp.attrs['varGrp'])];
    for (const member of members) {
      if (!state.vars.has(member) && !state.groups.has(member)) {
        state.onWarning?.(
          warning(
            'ddi-reference-outside',
            `varGrp ${id} refers to ${member}, which is not in the input`,
          ),
        );
      }
      if (STRUCTURE_TYPES.has(type)) state.parent.set(member, id);
      else if (type === 'multipleResp' || type === 'other') {
        state.owner.set(member, id);
      }
    }
  }
}

/** The groups a `var` / `varGrp` is in, outermost first. */
function chainOf(id: string, state: ReadState): string[] {
  const chain: string[] = [];
  for (let at = state.parent.get(id); at; at = state.parent.get(at)) {
    if (chain.includes(at)) break;
    chain.unshift(at);
  }
  return chain;
}

// ── choices ──────────────────────────────────────────────────────────────

/**
 * A choice set's list: an identical set already read shares its list (the
 * list's own name is not in the DDI), else a new one named `preferred`.
 */
function listFor(
  choices: InstrumentChoice[],
  preferred: string,
  state: ReadState,
): string {
  const key = JSON.stringify(
    choices.map((c) => [c.name, c.label, c.row[EXCLUSIVE_RULE.choicesColumn]]),
  );
  const known = state.listByKey.get(key);
  if (known) return known;
  let name = preferred;
  for (let i = 2; name in state.lists; i++) name = `${preferred}_${i}`;
  state.lists[name] = choices;
  state.listByKey.set(key, name);
  return name;
}

function categories(v: XmlNode, state: ReadState): InstrumentChoice[] {
  return childrenNamed(v, 'catgry').map((c) => ({
    name: textContent(childNamed(c, 'catValu') ?? c).trim(),
    label: childTexts(c, 'labl', state),
    row: {},
  }));
}

// ── questions ────────────────────────────────────────────────────────────

function emptyQuestion(name: string): QuestionItem {
  return {
    kind: 'question',
    name,
    label: {},
    hint: {},
    relevant: '',
    appearance: '',
    row: {},
    type: 'text',
    rawType: 'text',
    list: '',
    file: '',
    orOther: false,
    guidanceHint: {},
    constraint: '',
    constraintMessage: {},
    required: false,
    default: '',
    parameters: '',
  };
}

/** The logic and field notes on a `var` or a question's `varGrp`. */
function readNotes(q: QuestionItem, node: XmlNode, state: ReadState): void {
  q.relevant = noteText(node, LOGIC.relevant.type, state);
  q.constraint = noteText(node, LOGIC.constraint.type, state);
  q.constraintMessage = texts(
    notesOf(node, LOGIC.constraint_message.type),
    state,
  );
  q.required = noteText(node, LOGIC.required.type, state) !== '';
  q.default = noteText(node, FIELDS.default.type, state);
  q.appearance = noteText(node, FIELDS.appearance.type, state);
  q.parameters = noteText(node, FIELDS.parameters.type, state);
}

/** `qstn`'s texts: label, hint, guidance hint. */
function readQstn(q: QuestionItem, v: XmlNode, state: ReadState): void {
  const qstn = childNamed(v, 'qstn');
  q.label = childTexts(qstn, 'qstnLit', state);
  q.hint = childTexts(qstn, 'postQTxt', state);
  q.guidanceHint = childTexts(qstn, 'ivuInstr', state);
}

/** A range's `valrng` bounds back into its `parameters`, where not defaults. */
function rangeParameters(v: XmlNode, notes: string): string {
  const range = childNamed(childNamed(v, 'valrng') ?? v, 'range');
  const defaults = TYPE_MAPPINGS['range']?.parameters ?? {};
  const own = parseParameters(notes);
  const bounds = [
    ['start', range?.attrs['min']],
    ['end', range?.attrs['max']],
  ]
    .filter(([key, value]) => value && value !== defaults[key!] && !own[key!])
    .map(([key, value]) => `${key}=${value}`);
  return [...bounds, notes].filter(Boolean).join(' ');
}

/** A number: `dcml="0"` is an integer; bounds with no constraint, a range. */
function numericType(v: XmlNode): string {
  if (v.attrs['dcml'] === '0') return 'integer';
  const bounded = !!childNamed(v, 'valrng');
  return bounded && !notesOf(v, LOGIC.constraint.type).length
    ? 'range'
    : 'decimal';
}

/** Text, or the date / time its `varFormat/@category` says. */
function textType(v: XmlNode): string {
  const category = childNamed(v, 'varFormat')?.attrs['category'];
  return category === 'date' || category === 'time' ? category : 'text';
}

/** A plain `var`'s XLSForm type, from its standard DDI. */
function varType(v: XmlNode, state: ReadState): string {
  const domain = childNamed(v, 'qstn')?.attrs['responseDomainType'] ?? 'text';
  const vocab = childNamed(v, 'concept')?.attrs['vocab'];
  const select = (base: string) => (vocab ? fromFileTypeFor(base) : base);
  if (domain === 'category') return select('select_one');
  if (domain === 'multiple') return select('select_multiple');
  if (domain === 'numeric') return numericType(v);
  if (domain !== 'text') {
    state.onWarning?.(
      warning(
        'ddi-type-unknown',
        `responseDomainType "${domain}" of ${v.attrs['name']} is not one formtransform writes; read as text`,
        v.attrs['name'],
      ),
    );
  }
  return textType(v);
}

/** One plain `var` as a question. */
function plainQuestion(
  v: XmlNode,
  state: ReadState,
  listName = v.attrs['name'] ?? '',
): QuestionItem {
  const q = emptyQuestion(v.attrs['name'] ?? v.attrs['ID'] ?? '');
  readQstn(q, v, state);
  readNotes(q, v, state);
  q.type = varType(v, state);
  const vocab = childNamed(v, 'concept')?.attrs['vocab'];
  if (vocab) {
    q.file = `${vocab}.csv`;
  } else if (q.type === 'select_one' || q.type === 'select_multiple') {
    q.list = listFor(categories(v, state), listName, state);
  }
  if (q.type === 'range') q.parameters = rangeParameters(v, q.parameters);
  q.rawType = [q.type, q.file || q.list].filter(Boolean).join(' ');
  return q;
}

/** Exclusive codes of a select_multiple (`cdl:exclusive`). */
function exclusive(grp: XmlNode, state: ReadState): Set<string> {
  return new Set(ids(noteText(grp, FIELDS.exclusive.type, state)));
}

/**
 * A select_multiple from its `varGrp` (`multipleResp`, or the semi-open
 * pair's `other` around it): label and logic from the group, choices and
 * hints from its binary `var`s.
 */
function multiQuestion(
  grp: XmlNode,
  binaries: XmlNode[],
  withOther: boolean,
  state: ReadState,
): QuestionItem {
  const name = grp.attrs['name'] ?? '';
  const q = emptyQuestion(name);
  q.type = 'select_multiple';
  q.label = childTexts(grp, 'txt', state);
  readNotes(q, grp, state);
  const first = binaries[0];
  if (first) {
    const qstn = childNamed(first, 'qstn');
    q.hint = childTexts(qstn, 'postQTxt', state);
    q.guidanceHint = childTexts(qstn, 'ivuInstr', state);
  }
  const excl = exclusive(grp, state);
  const choices: InstrumentChoice[] = binaries.map((b) => {
    const code = (b.attrs['name'] ?? '').slice(name.length + 1);
    return {
      name: code,
      label: childTexts(childNamed(b, 'qstn'), 'qstnLit', state),
      row: excl.has(code)
        ? { [EXCLUSIVE_RULE.choicesColumn]: EXCLUSIVE_RULE.trueValues[0] }
        : {},
    };
  });
  if (withOther) {
    // Its binary isn't written; the label is the convention's.
    const label: Text = {};
    for (const lang of state.languages)
      label[lang] = otherLabelFor(lang || 'en');
    choices.push({ name: OTHER_CODE, label, row: {} });
  }
  q.list = listFor(choices, name, state);
  q.rawType = `select_multiple ${q.list}`;
  return q;
}

// ── notes ────────────────────────────────────────────────────────────────

/** A note row, whose name the DDI doesn't keep. */
function noteItem(label: Text, near: string, state: ReadState): QuestionItem {
  let name = `${near}_note`;
  for (let i = 2; state.names.has(name); i++) name = `${near}_note_${i}`;
  state.names.add(name);
  return { ...emptyQuestion(name), type: 'note', rawType: 'note', label };
}

/** A lead-in note kept as `preQTxt` (standalone) or an untyped group note. */
function leadIn(label: Text, near: string, state: ReadState): QuestionItem[] {
  return Object.keys(label).length ? [noteItem(label, near, state)] : [];
}

const untypedNotes = (node: XmlNode, state: ReadState) =>
  texts(
    childrenNamed(node, 'notes').filter((n) => !n.attrs['type']),
    state,
  );

// ── tree ─────────────────────────────────────────────────────────────────

/** A question in survey order, with the element that places it in groups. */
interface Placed {
  items: QuestionItem[];
  /** The `var` / `varGrp` ID its enclosing groups contain. */
  anchor: string;
}

/** The `var`s an element's `@var` lists that are in the input. */
function varsOf(grp: XmlNode, state: ReadState): XmlNode[] {
  return ids(grp.attrs['var'])
    .map((m) => state.vars.get(m))
    .filter((m): m is XmlNode => !!m);
}

/** A `var`'s lead-in note (its `preQTxt`) and the question itself. */
function withLeadIn(v: XmlNode, state: ReadState): QuestionItem[] {
  const note = childTexts(childNamed(v, 'qstn'), 'preQTxt', state);
  return [
    ...leadIn(note, v.attrs['name'] ?? '', state),
    plainQuestion(v, state),
  ];
}

/** A `var` in no multipleResp / other group: a standalone or grid question. */
function placePlain(id: string, v: XmlNode, state: ReadState): Placed {
  const parentId = state.parent.get(id) ?? '';
  // A grid member's preQTxt is the grid's text, not a note.
  if (state.groups.get(parentId)?.attrs['type'] !== 'grid') {
    return { items: withLeadIn(v, state), anchor: id };
  }
  return {
    items: [plainQuestion(v, state, gridName(parentId, state))],
    anchor: id,
  };
}

/** A select_multiple, and with an `other` pair around it, its companion. */
function placeMulti(multiId: string, multi: XmlNode, state: ReadState): Placed {
  const pairId = state.owner.get(multiId);
  const pair = pairId ? state.groups.get(pairId) : undefined;
  const q = multiQuestion(pair ?? multi, varsOf(multi, state), !!pair, state);
  const lead = untypedNotes(pair ?? multi, state);
  const items = [...leadIn(lead, q.name, state), q];
  if (pair)
    items.push(...varsOf(pair, state).map((m) => plainQuestion(m, state)));
  return { items, anchor: pairId ?? multiId };
}

/** The question(s) one `var` starts, or none if an earlier one covered it. */
function placeVar(
  id: string,
  v: XmlNode,
  seen: Set<string>,
  state: ReadState,
): Placed | null {
  const ownerId = state.owner.get(id);
  const owner = ownerId ? state.groups.get(ownerId) : undefined;
  if (!owner || !ownerId) return placePlain(id, v, state);
  // A multi pair's companion is in its `other` group, next to the multi.
  const multiId =
    owner.attrs['type'] === 'multipleResp'
      ? ownerId
      : ids(owner.attrs['varGrp']).find((g) => state.groups.has(g));
  const key = multiId ? (state.owner.get(multiId) ?? multiId) : ownerId;
  if (seen.has(key)) return null;
  seen.add(key);
  if (multiId) return placeMulti(multiId, state.groups.get(multiId)!, state);
  // A semi-open select_one: its `other` group holds the select and its text.
  return {
    items: varsOf(owner, state).flatMap((m) => withLeadIn(m, state)),
    anchor: ownerId,
  };
}

/** A grid's own name (its path's last part), its members' list name. */
function gridName(id: string, state: ReadState): string {
  const path = state.groups.get(id)?.attrs['name'] ?? id;
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A section / grid `varGrp` as an (empty) group item. */
function groupItem(id: string, state: ReadState): GroupItem {
  const grp = state.groups.get(id)!;
  const grid = grp.attrs['type'] === 'grid';
  const lead = grid
    ? leadIn(untypedNotes(grp, state), gridName(id, state), state)
    : [];
  return {
    kind: 'group',
    name: gridName(id, state),
    label: childTexts(grp, 'txt', state),
    hint: texts(notesOf(grp, FIELDS.hint.type), state),
    relevant: noteText(grp, LOGIC.relevant.type, state),
    appearance:
      noteText(grp, FIELDS.appearance.type, state) ||
      (grid ? GRID_APPEARANCE : ''),
    row: {},
    children: lead,
    closed: true,
  };
}

/** Seat each placed question in its groups, opening them as they come. */
function buildTree(placed: Placed[], state: ReadState): Item[] {
  const body: Item[] = [];
  const open: Array<{ id: string; item: GroupItem }> = [];
  for (const { items, anchor } of placed) {
    const chain = chainOf(anchor, state);
    let depth = 0;
    while (depth < open.length && open[depth].id === chain[depth]) depth++;
    open.length = depth;
    for (const id of chain.slice(depth)) {
      const item = groupItem(id, state);
      (open.length ? open[open.length - 1].item.children : body).push(item);
      open.push({ id, item });
    }
    (open.length ? open[open.length - 1].item.children : body).push(...items);
  }
  return body;
}

/** `var`s in survey order: element order, `qstn/@seqNo` where given. */
function inSurveyOrder(vars: Map<string, XmlNode>): Array<[string, XmlNode]> {
  const seq = (v: XmlNode) =>
    Number(childNamed(v, 'qstn')?.attrs['seqNo'] ?? Number.NaN);
  const entries = [...vars.entries()];
  if (!entries.every(([, v]) => Number.isFinite(seq(v)))) return entries;
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => seq(a.e[1]) - seq(b.e[1]) || a.i - b.i)
    .map(({ e }) => e);
}

// ── study ────────────────────────────────────────────────────────────────

/** The text at a `stdyDscr/citation` path (`titlStmt/titl`), `''` if none. */
function citationText(stdy: XmlNode, path: string[]): string {
  let at: XmlNode | undefined = childNamed(stdy, 'citation');
  for (const name of path) at = at && childNamed(at, name);
  return at ? textContent(at).trim() : '';
}

function readSettings(
  root: XmlNode | undefined,
  state: ReadState,
): Record<string, unknown> {
  const stdy = root && childNamed(root, 'stdyDscr');
  if (!stdy) return {};
  const fields: Array<[string, string]> = [
    ['form_title', citationText(stdy, ['titlStmt', 'titl'])],
    ['form_id', citationText(stdy, ['titlStmt', 'IDNo'])],
    ['version', citationText(stdy, ['verStmt', 'version'])],
    ['default_language', state.base],
  ];
  const out: Record<string, unknown> = Object.fromEntries(
    fields.filter(([, value]) => value && value !== 'Untitled'),
  );
  // Parallel titles: form_title in the other languages.
  const titlStmt = childNamed(childNamed(stdy, 'citation') ?? stdy, 'titlStmt');
  const parallel = titlStmt ? childrenNamed(titlStmt, 'parTitl') : [];
  if (parallel.length && typeof out['form_title'] === 'string') {
    out['form_title'] = {
      ...texts(parallel, state),
      [state.base]: out['form_title'],
    };
  }
  for (const note of notesOf(stdy, FIELDS.setting.type)) {
    const key = note.attrs['subject'];
    if (key) out[key] = textContent(note).trim();
  }
  return out;
}

/** The study's notes (`type="instruction"`): notes with no question after them. */
function orphanNotes(
  root: XmlNode | undefined,
  state: ReadState,
): QuestionItem[] {
  const stdy = root && childNamed(root, 'stdyDscr');
  if (!stdy) return [];
  const bySubject = new Map<string, XmlNode[]>();
  for (const note of childrenNamed(stdy, 'notes')) {
    if (note.attrs['type'] !== 'instruction') continue;
    const subject = note.attrs['subject'] ?? '';
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), note]);
  }
  return [...bySubject].map(([subject, notes]) => {
    state.names.add(subject);
    return {
      ...emptyQuestion(subject),
      type: 'note',
      rawType: 'note',
      label: texts(notes, state),
    };
  });
}

// ── provenance ───────────────────────────────────────────────────────────

/** Fields only a CDL codebook carries, reported once each when absent. */
const CDL_ONLY = [
  'question order (qstn/@seqNo)',
  'skip logic (cdl:relevant)',
  'validation (cdl:constraint)',
  'required (cdl:required)',
  'default (cdl:default)',
  'appearance (cdl:appearance)',
];

function isCdl(elements: XmlNode[]): boolean {
  return elements.some(
    (el) =>
      childNamed(el, 'qstn')?.attrs['seqNo'] !== undefined ||
      childrenNamed(el, 'notes').some((n) =>
        (n.attrs['type'] ?? '').startsWith('cdl:'),
      ),
  );
}

function warnNotCdl(onWarning: WarningHandler | undefined): void {
  for (const field of CDL_ONLY) {
    onWarning?.(
      warning(
        'ddi-field-missing',
        `Not a CDL codebook: no ${field}; the form gets none (formtransform#155)`,
      ),
    );
  }
}

/** The languages seen, base first; `['']` for an untagged one-language form. */
function languagesOf(state: ReadState): string[] {
  const languages = state.languages.filter((l, i, all) => all.indexOf(l) === i);
  return state.base || languages.length > 1 ? languages : [''];
}

// ── entry point ──────────────────────────────────────────────────────────

export interface DdiParseOptions {
  /** Receives what the DDI can't supply (not a CDL codebook, a fragment). */
  onWarning?: WarningHandler;
}

/**
 * Parse DDI Codebook 2.5 XML (a whole codebook or a fragment) into an
 * Instrument. Throws `ddi-invalid` when the XML is not well-formed or holds
 * neither a `codeBook` nor a `var`.
 */
export function instrumentFromDdi(
  xml: string,
  options: DdiParseOptions = {},
): Instrument {
  const roots = parseXml(xml);
  const root = roots.find((r) => r.name === 'codeBook');
  const base = root?.attrs['xml:lang'] ?? '';
  const state: ReadState = {
    base,
    languages: [base],
    vars: new Map(),
    groups: new Map(),
    parent: new Map(),
    owner: new Map(),
    lists: {},
    listByKey: new Map(),
    names: new Set(),
    onWarning: options.onWarning,
  };
  const elements = dataElements(roots);
  indexStructure(elements, state);
  if (!root && state.vars.size === 0) {
    throw new ConversionError(
      'ddi-invalid',
      'The input holds no <codeBook> and no <var>.',
    );
  }
  if (!isCdl(elements)) warnNotCdl(options.onWarning);
  for (const [, v] of state.vars) state.names.add(v.attrs['name'] ?? '');

  const seen = new Set<string>();
  const placed: Placed[] = [];
  for (const [id, v] of inSurveyOrder(state.vars)) {
    const p = placeVar(id, v, seen, state);
    if (p) placed.push(p);
  }
  const settings = readSettings(root, state);
  const body = [...buildTree(placed, state), ...orphanNotes(root, state)];
  return {
    languages: languagesOf(state),
    ...(base ? { defaultLanguage: base } : {}),
    settings,
    lists: state.lists,
    body,
  };
}

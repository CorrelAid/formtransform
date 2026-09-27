/**
 * Build DDI-Codebook 2.5 XML from parsed survey data.
 *
 * Output structure (qwacback-compatible):
 * - `<concept>` (not `<labl>`) on `<var>` / `<varGrp>`
 * - `responseDomainType` on every `<qstn>`
 * - `select_multiple` expands into `<varGrp type="multipleResp">` + binary vars
 * - grid groups (`appearance="table-list"`) as `<varGrp type="grid">`
 * - the semi-open `_other` pattern as `<varGrp type="other">`
 * - every other group as `<varGrp type="section">`, nested by `@varGrp` (#152)
 * - `<var>`s in survey order (#152)
 * - external code lists (`select_*_from_file`) as `<concept vocab="…">`
 */

import { DDI_TYPE_MAP, RESPONSE_DOMAIN_MAP } from '../generated/DdiMappings.js';

import {
  OTHER_APPLIES_TO,
  OTHER_CODE,
  otherCompanionBase,
} from '../conventions/other.js';
import { isGridAppearance } from '../conventions/grid.js';
import { XmlElement } from './xml.js';
import { classifyNotes } from './notes.js';
import { Choice, DdiGroup, Translations, Variable } from './types.js';
import { localizedChild, textsOf } from './translations.js';
import {
  addExclusiveNote,
  addFieldNotes,
  addGroupFieldNotes,
  addSettingNotes,
  references,
} from './fields.js';
import {
  addLogicNotes,
  addRelevantNote,
  addUniverse,
  addValrng,
  logicContext,
  universeOf,
  type LogicContext,
} from './logic.js';
import { registeredVocabCodes } from '../conventions/fromFile.js';
import { languageTagOf } from '../utils/languageUtils.js';

const NS = 'ddi:codebook:2_5';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const SCHEMA_LOC =
  'ddi:codebook:2_5 https://ddialliance.org/Specification/DDI-Codebook/2.5/XMLSchema/codebook.xsd';

/** `xs:ID` forbids `/` (and other non-NCName chars) — replace with `_`. */
function sanitizeId(name: string): string {
  return name.replace(/\//g, '_');
}

function makeVarId(name: string): string {
  return `V_${sanitizeId(name)}`;
}

function makeGrpId(name: string): string {
  return `VG_${sanitizeId(name)}`;
}

/** A group is a grid when its innermost appearance contains `table-list`. */
function isGridGroup(variables: Variable[], groupName: string): boolean {
  for (const v of variables) {
    if (v.group === groupName && v.groupAppearance) {
      return isGridAppearance(v.groupAppearance);
    }
  }
  return false;
}

/**
 * Resolve a group's label from its member variables, else the group name,
 * with the labeling member's translations of it.
 */
function getGroupLabel(
  variables: Variable[],
  groupName: string,
): { label: string; translations: Translations } {
  for (const v of variables) {
    if (v.group === groupName && v.groupLabel) {
      return { label: v.groupLabel, translations: textsOf(v, 'groupLabel') };
    }
  }
  return { label: groupName, translations: {} };
}

interface AddVarOpts {
  vocab?: string;
  preQTxt?: string;
  preQTxtTranslations?: Translations;
}

interface AddVarSpec {
  varId: string;
  name: string;
  label: string;
  varType: string;
  choices: Choice[];
  opts?: AddVarOpts;
  /** The source variable's hint (→ postQTxt) and guidance hint (→ ivuInstr). */
  hint?: string;
  guidanceHint?: string;
  /** `label` / `hint` / `guidanceHint` in the form's other languages. */
  labelTranslations?: Translations;
  hintTranslations?: Translations;
  guidanceHintTranslations?: Translations;
  /** The variable whose logic (#151) this `<var>` carries. */
  logic?: { v: Variable; ctx: LogicContext };
}

/** An {@link AddVarSpec}'s translations, read off its source variable. */
function specTranslations(
  v: Variable,
): Pick<
  AddVarSpec,
  'labelTranslations' | 'hintTranslations' | 'guidanceHintTranslations'
> {
  return {
    labelTranslations: textsOf(v, 'label'),
    hintTranslations: textsOf(v, 'hint'),
    guidanceHintTranslations: textsOf(v, 'guidanceHint'),
  };
}

/**
 * A categorical variable's data column holds its codes, so it is `numeric`
 * only when every code is a number (#119): `such` / `DE` are `character`.
 * With a vocabulary the codes are the registered vocabulary's; an unknown
 * vocabulary's codes can't be checked, so they count as `character`.
 */
function categoricalFormat(
  typeFormat: string,
  respDomain: string,
  choices: Choice[],
  vocab: string,
): string {
  if (typeFormat !== 'numeric') return typeFormat;
  if (respDomain !== 'category' && respDomain !== 'multiple') return typeFormat;
  const codes = vocab
    ? registeredVocabCodes(vocab)
    : choices.map((c) => c.name);
  const numeric =
    codes.length > 0 && codes.every((c) => /^-?\d+(\.\d+)?$/.test(c.trim()));
  return numeric ? 'numeric' : 'character';
}

/**
 * Append one `<var>`. Element order: `qstn → valrng → universe → catgry* →
 * concept → varFormat → notes`.
 * With `vocab`, no `<catgry>` is emitted and `<concept>` carries `@vocab`.
 */
function addVarElement(parent: XmlElement, spec: AddVarSpec): XmlElement {
  const { varId, name, label, varType, choices } = spec;
  const { vocab = '' } = spec.opts ?? {};
  const [intrvl, typeFormat] = DDI_TYPE_MAP[varType] ?? [
    'discrete',
    'character',
  ];
  const respDomain = RESPONSE_DOMAIN_MAP[varType] ?? 'text';
  const fmtType = categoricalFormat(typeFormat, respDomain, choices, vocab);

  const varEl = parent.child('var', {
    ID: varId,
    name,
    intrvl,
    // An integer's data has no decimals; a decimal's number of them is open.
    ...(varType === 'integer' ? { dcml: '0' } : {}),
    files: 'F1',
  });

  if (label) addQstn(varEl, spec, respDomain);

  if (spec.logic) {
    addValrng(varEl, spec.logic.v);
    addUniverse(varEl, universeOf(spec.logic.v), spec.logic.ctx);
  }

  if (!vocab) addCategories(varEl, choices);

  varEl.textChild('concept', label, vocab ? { vocab } : {});
  varEl.child('varFormat', {
    type: fmtType,
    schema: 'other',
    ...(DATE_TIME.has(varType) ? { category: varType } : {}),
  });
  if (spec.logic) {
    addLogicNotes(varEl, spec.logic.v);
    addFieldNotes(varEl, spec.logic.v);
  }

  return varEl;
}

/**
 * `<qstn>`: a folded note or a grid's shared text (`preQTxt`), the label,
 * then the hints and dependencies (#153).
 */
function addQstn(varEl: XmlElement, spec: AddVarSpec, respDomain: string) {
  const qstn = varEl.child('qstn', qstnAttrs(respDomain, spec.logic));
  const preQTxt = spec.opts?.preQTxt;
  if (preQTxt) {
    localizedChild(qstn, 'preQTxt', preQTxt, spec.opts?.preQTxtTranslations);
  }
  localizedChild(qstn, 'qstnLit', spec.label, spec.labelTranslations);
  addQstnTail(qstn, spec, spec.logic);
}

function addCategories(varEl: XmlElement, choices: Choice[]): void {
  for (const choice of choices) {
    const catgry = varEl.child('catgry');
    catgry.textChild('catValu', choice.name);
    localizedChild(catgry, 'labl', choice.label, choice.translations);
  }
}

/** Types whose format is a `varFormat/@category` of the same name (#153). */
const DATE_TIME = new Set(['date', 'time']);

/** `<qstn>`'s attributes: its response domain and, known, its position. */
function qstnAttrs(
  respDomain: string,
  logic: AddVarSpec['logic'],
): Record<string, string> {
  const seqNo = logic ? logic.ctx.seqNo.get(logic.v.name) : undefined;
  return {
    responseDomainType: respDomain,
    ...(seqNo ? { seqNo: String(seqNo) } : {}),
  };
}

/**
 * `<qstn>` after `qstnLit`, in XSD order: the hint (`postQTxt`), the
 * questions its condition refers to (`backward`), the guidance hint
 * (`ivuInstr`).
 */
function addQstnTail(
  qstn: XmlElement,
  texts: Pick<
    AddVarSpec,
    'hint' | 'hintTranslations' | 'guidanceHint' | 'guidanceHintTranslations'
  >,
  logic: AddVarSpec['logic'],
): void {
  if (texts.hint) {
    localizedChild(qstn, 'postQTxt', texts.hint, texts.hintTranslations);
  }
  if (logic) {
    const own = logic.ctx.ids.get(logic.v.name);
    const refs = references(logic.v.relevant ?? '')
      .map((name) => logic.ctx.ids.get(name))
      .filter((id): id is string => !!id && id !== own);
    if (refs.length)
      qstn.child('backward', { qstn: [...new Set(refs)].join(' ') });
  }
  if (texts.guidanceHint) {
    localizedChild(
      qstn,
      'ivuInstr',
      texts.guidanceHint,
      texts.guidanceHintTranslations,
    );
  }
}

/**
 * A group-level question (a `select_multiple`, a semi-open pair) on its
 * `<varGrp>`: universe, any lead-in note, then its typed notes.
 */
function addGroupLogic(
  grpEl: XmlElement,
  v: Variable,
  ctx: LogicContext,
  notes?: { note: InlineNotes; name: string },
): void {
  addUniverse(grpEl, universeOf(v), ctx);
  if (notes) addGroupNote(grpEl, notes.note, notes.name);
  addLogicNotes(grpEl, v);
  addFieldNotes(grpEl, v);
  addExclusiveNote(grpEl, v.choices);
}

/** Append a binary 0/1 `<var>` for one `select_multiple` option. */
function addBinaryVar(
  parent: XmlElement,
  name: string,
  question: Variable,
  choice: Choice,
  ctx: LogicContext,
): XmlElement {
  const questionLabel = question.label;
  const choiceLabel = choice.label;
  const varEl = parent.child('var', {
    ID: makeVarId(name),
    name,
    intrvl: 'discrete',
    files: 'F1',
  });

  const logic = { v: question, ctx };
  const qstn = varEl.child('qstn', qstnAttrs('multiple', logic));
  localizedChild(qstn, 'preQTxt', questionLabel, textsOf(question, 'label'));
  localizedChild(qstn, 'qstnLit', choiceLabel, choice.translations);
  // The question's hints go with each of its options (#153).
  addQstnTail(
    qstn,
    {
      hint: question.hint,
      guidanceHint: question.guidanceHint,
      ...specTranslations(question),
    },
    logic,
  );
  // The question's notes are on its varGrp; the prose also here, for readers.
  addUniverse(varEl, universeOf(question), ctx);

  for (const val of ['0', '1']) {
    varEl.child('catgry').textChild('catValu', val);
  }

  varEl.textChild('concept', `${questionLabel}: ${choiceLabel}`);
  varEl.child('varFormat', { type: 'numeric', schema: 'other' });

  return varEl;
}

export interface OtherPattern {
  base: Variable;
  otherVar: Variable;
  isMulti: boolean;
}

/**
 * Detect the semi-open `_other` pattern: a `text` variable `<base>_other`
 * following a `select_one`/`select_multiple` `<base>` with an `other` choice.
 */
function detectOtherPatterns(variables: Variable[]): Map<string, OtherPattern> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const patterns = new Map<string, OtherPattern>();
  for (const v of variables) {
    const baseName = v.type === 'text' ? otherCompanionBase(v.name) : null;
    if (!baseName) continue;
    const base = byName.get(baseName);
    if (!base || !OTHER_APPLIES_TO.includes(base.type)) continue;
    if (!base.choices.some((c) => c.name === OTHER_CODE)) continue;
    patterns.set(baseName, {
      base,
      otherVar: v,
      isMulti: base.type === 'select_multiple',
    });
  }
  return patterns;
}

/** Emit the parent `<varGrp type="other">` (+ child multipleResp for multi). */
function emitOtherPattern(
  dataDscr: XmlElement,
  p: OtherPattern,
  ctx: LogicContext,
  notes: InlineNotes,
): void {
  const { base, otherVar } = p;
  const label = base.label;
  const labelTranslations = textsOf(base, 'label');
  const baseName = base.name;

  if (p.isMulti) {
    const nonOther = base.choices.filter((c) => c.name !== OTHER_CODE);
    const childName = `${baseName}_choices`;
    const childId = makeGrpId(childName);
    const childMembers = nonOther
      .map((c) => makeVarId(`${baseName}_${c.name}`))
      .join(' ');

    const parentEl = dataDscr.child('varGrp', {
      ID: makeGrpId(baseName),
      name: baseName,
      type: 'other',
      var: makeVarId(otherVar.name),
      varGrp: childId,
    });
    localizedChild(parentEl, 'txt', label, labelTranslations);
    parentEl.textChild('concept', label);
    // No var has the question's name: the parent group carries its logic,
    // and a note before it.
    addGroupLogic(parentEl, base, ctx, { note: notes, name: baseName });

    const childEl = dataDscr.child('varGrp', {
      ID: childId,
      name: childName,
      type: 'multipleResp',
      var: childMembers,
    });
    localizedChild(childEl, 'txt', label, labelTranslations);
    childEl.textChild('concept', label);
  } else {
    const parentEl = dataDscr.child('varGrp', {
      ID: makeGrpId(baseName),
      name: baseName,
      type: 'other',
      var: [makeVarId(baseName), makeVarId(otherVar.name)].join(' '),
    });
    localizedChild(parentEl, 'txt', label, labelTranslations);
    parentEl.textChild('concept', label);
  }
}

/** Emit the `<var>` elements associated with an `_other` pattern. */
function emitOtherPatternVars(
  dataDscr: XmlElement,
  p: OtherPattern,
  ctx: LogicContext,
  notes: InlineNotes,
): void {
  const { base, otherVar } = p;
  const baseName = base.name;

  if (p.isMulti) {
    for (const choice of base.choices) {
      if (choice.name === OTHER_CODE) continue;
      addBinaryVar(dataDscr, `${baseName}_${choice.name}`, base, choice, ctx);
    }
  } else {
    addVarElement(dataDscr, {
      varId: makeVarId(baseName),
      name: baseName,
      label: base.label,
      varType: base.type,
      choices: base.choices,
      opts: {
        preQTxt: notes.text[baseName] ?? '',
        preQTxtTranslations: notes.translations[baseName],
      },
      hint: base.hint,
      guidanceHint: base.guidanceHint,
      ...specTranslations(base),
      logic: { v: base, ctx },
    });
  }

  // The `_other` text follow-up is always a standalone text var.
  addVarElement(dataDscr, {
    varId: makeVarId(otherVar.name),
    name: otherVar.name,
    label: otherVar.label,
    varType: otherVar.type,
    choices: [],
    hint: otherVar.hint,
    guidanceHint: otherVar.guidanceHint,
    ...specTranslations(otherVar),
    logic: { v: otherVar, ctx },
  });
}

/** Optional settings that shape study-level metadata. */
export interface DdiSettings {
  /** A plain title, or one per language (`{ en: …, es: … }`). */
  form_title?: string | Record<string, string>;
  /** Study ID (`IDNo`); `id_string` is Kobo's older name for it. */
  form_id?: string | number;
  id_string?: string | number;
  version?: string | number;
  /** Base language (`German (de)` or `de`): `codeBook/@xml:lang`. */
  default_language?: string;
  [key: string]: unknown;
}

export interface BuildDdiOptions {
  /** Study title; falls back to `settings.form_title`, then `Untitled`. */
  assetName?: string;
  settings?: DdiSettings;
  /** Response records — only their count (`caseQnty`) is used. */
  submissions?: unknown[];
  /** Data file URI recorded in `<fileDscr>` (default `data.csv`). */
  datasetFilename?: string;
  /** Override the `prodDate` (ISO `YYYY-MM-DD`); defaults to today. */
  prodDate?: string;
}

/**
 * One question's `<var>`s, in survey order (#152): a plain variable (`grid`:
 * the grid group it is a member of), a `select_multiple`'s binaries, or a
 * semi-open pair.
 */
export type EmitUnit =
  | { kind: 'var'; v: Variable; grid?: string }
  | { kind: 'multi'; v: Variable }
  | { kind: 'other'; p: OtherPattern };

/** Returned by {@link splitDataVars}: every data var bucketed by its emit role. */
export interface DataVarBuckets {
  otherPatterns: Map<string, OtherPattern>;
  gridGroups: Map<string, Variable[]>;
  multiRespGroups: Map<string, Variable>;
  /** The questions in survey order, which the `<var>`s and data columns follow. */
  units: EmitUnit[];
}

/** Sort the flat data vars into the four emit roles `dataDscr` walks through. */
export function splitDataVars(dataVars: Variable[]): DataVarBuckets {
  const otherPatterns = detectOtherPatterns(dataVars);
  const baseNamesInOther = new Set(
    [...otherPatterns.values()].map((p) => p.base.name),
  );
  const otherVarNames = new Set(
    [...otherPatterns.values()].map((p) => p.otherVar.name),
  );

  const gridGroups = new Map<string, Variable[]>();
  const multiRespGroups = new Map<string, Variable>();
  const units: EmitUnit[] = [];

  for (const v of dataVars) {
    // A semi-open pair is emitted where its select is; the companion with it.
    if (otherVarNames.has(v.name)) continue;
    const pattern = otherPatterns.get(v.name);
    if (pattern && baseNamesInOther.has(v.name)) {
      units.push({ kind: 'other', p: pattern });
    } else if (v.type === 'select_multiple') {
      multiRespGroups.set(v.name, v);
      units.push({ kind: 'multi', v });
    } else if (v.group && isGridGroup(dataVars, v.group)) {
      const members = gridGroups.get(v.group) ?? [];
      members.push(v);
      gridGroups.set(v.group, members);
      units.push({ kind: 'var', v, grid: v.group });
    } else {
      units.push({ kind: 'var', v });
    }
  }

  return { otherPatterns, gridGroups, multiRespGroups, units };
}

/** Emit `<stdyDscr>` (citation, then orphan notes and `cdl:setting` notes). */
function addStudyDscr(
  root: XmlElement,
  settings: DdiSettings,
  title: StudyTitle,
  prodDate: string,
  orphanNotes: Variable[],
): void {
  const stdy = root.child('stdyDscr');
  const citation = stdy.child('citation');

  const titlStmt = citation.child('titlStmt');
  titlStmt.textChild('titl', title.title);
  // A title in another language is DDI's parallel title.
  for (const [lang, text] of Object.entries(title.parallel)) {
    titlStmt.textChild('parTitl', text, { 'xml:lang': lang });
  }
  const studyId = settings.form_id ?? settings.id_string;
  if (studyId) titlStmt.textChild('IDNo', String(studyId));

  const prodStmt = citation.child('prodStmt');
  prodStmt.textChild('prodDate', prodDate, { date: prodDate });

  const ver = settings.version;
  if (ver) citation.child('verStmt').textChild('version', String(ver));

  for (const note of orphanNotes) {
    if (!note.label) continue;
    const attrs: Record<string, string> = { type: 'instruction' };
    if (note.name) attrs.subject = note.name;
    localizedChild(stdy, 'notes', note.label, textsOf(note, 'label'), attrs);
  }
  addSettingNotes(stdy, settings);
}

interface StudyTitle {
  title: string;
  /** `form_title` in the form's other languages, by tag. */
  parallel: Translations;
}

/**
 * The study title: `assetName`, else `form_title` (a `{ lang: text }` one in
 * the base language, the others as parallel titles), else `Untitled`.
 */
function studyTitle(assetName: string, settings: DdiSettings): StudyTitle {
  const raw = settings.form_title;
  if (assetName.trim()) return { title: assetName.trim(), parallel: {} };
  if (raw === null || typeof raw !== 'object') {
    return { title: String(raw ?? '').trim() || 'Untitled', parallel: {} };
  }
  const base =
    typeof settings.default_language === 'string'
      ? languageTagOf(settings.default_language)
      : null;
  const byTag = Object.entries(raw as Record<string, unknown>)
    .map(([key, v]): [string, string] => [
      languageTagOf(key) ?? key,
      typeof v === 'string' ? v.trim() : '',
    ])
    .filter(([, v]) => v);
  const main = byTag.find(([tag]) => tag === base) ?? byTag[0];
  return {
    title: main?.[1] ?? 'Untitled',
    parallel: Object.fromEntries(byTag.filter((e) => e !== main)),
  };
}

/** Emit `<fileDscr>` with `caseQnty` set to the submissions count. */
function addFileDscr(
  root: XmlElement,
  datasetFilename: string,
  caseCount: number,
): void {
  const fileTxt = root
    .child('fileDscr', { ID: 'F1', URI: datasetFilename })
    .child('fileTxt');
  fileTxt.textChild('fileName', datasetFilename);
  fileTxt.child('dimensns').textChild('caseQnty', String(caseCount));
  fileTxt.textChild('fileType', 'Comma-separated values (CSV)');
  fileTxt.textChild('format', 'text/csv');
}

/** Lead-in note text by the variable it precedes, and its translations. */
interface InlineNotes {
  text: Record<string, string>;
  translations: Record<string, Translations>;
}

/** A group's lead-in note (the one preceding `name`) as `<notes>`. */
function addGroupNote(
  grpEl: XmlElement,
  notes: InlineNotes,
  name: string,
): void {
  const note = notes.text[name];
  if (note) localizedChild(grpEl, 'notes', note, notes.translations[name]);
}

/** A group with what it directly contains, by `varGrp` ID reference. */
interface GroupNode {
  group: DdiGroup;
  /** Its conditions and its enclosing groups', outermost first. */
  universe: string[];
  /** IDs of the plain `<var>`s directly in it. */
  vars: string[];
  /** IDs of the `<varGrp>`s directly in it. */
  groups: string[];
}

/** The variable a unit is placed by. */
function unitVar(unit: EmitUnit): Variable {
  return unit.kind === 'other' ? unit.p.base : unit.v;
}

/**
 * Every group that has a variable under it, by path in survey order, with
 * its direct members (#152). A grid member belongs to its grid's `varGrp`;
 * a `select_multiple` and a semi-open pair are represented by theirs.
 */
function groupTree(units: EmitUnit[]): Map<string, GroupNode> {
  const tree = new Map<string, GroupNode>();
  for (const unit of units) {
    const chain = unitVar(unit).groups ?? [];
    chain.forEach((group, i) => {
      if (tree.has(group.path)) return;
      tree.set(group.path, {
        group,
        universe: chain.slice(0, i + 1).map((g) => g.relevant),
        vars: [],
        groups: [],
      });
      if (i > 0)
        tree.get(chain[i - 1].path)?.groups.push(makeGrpId(group.path));
    });
    const inner = chain.length ? tree.get(chain[chain.length - 1].path) : null;
    if (!inner) continue;
    if (unit.kind === 'multi') inner.groups.push(makeGrpId(unit.v.name));
    else if (unit.kind === 'other')
      inner.groups.push(makeGrpId(unit.p.base.name));
    else if (!unit.grid) inner.vars.push(makeVarId(unit.v.name));
  }
  return tree;
}

/**
 * The element each question's name refers to: its `<var>`, or for a
 * `select_multiple` (plain or semi-open) its `<varGrp>`.
 */
function questionIds(units: EmitUnit[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const unit of units) {
    if (unit.kind === 'multi') ids.set(unit.v.name, makeGrpId(unit.v.name));
    else if (unit.kind === 'var') ids.set(unit.v.name, makeVarId(unit.v.name));
    else {
      const { base, otherVar, isMulti } = unit.p;
      ids.set(base.name, isMulti ? makeGrpId(base.name) : makeVarId(base.name));
      ids.set(otherVar.name, makeVarId(otherVar.name));
    }
  }
  return ids;
}

/** A plain group as `<varGrp type="section">` (#152). */
function addSection(
  dataDscr: XmlElement,
  node: GroupNode,
  ctx: LogicContext,
): void {
  const { group } = node;
  const grpEl = dataDscr.child('varGrp', {
    ID: makeGrpId(group.path),
    name: group.path,
    type: 'section',
    ...(node.vars.length ? { var: node.vars.join(' ') } : {}),
    ...(node.groups.length ? { varGrp: node.groups.join(' ') } : {}),
  });
  const label = group.label || group.name;
  localizedChild(grpEl, 'txt', label, group.translations);
  grpEl.textChild('concept', label);
  addUniverse(grpEl, node.universe, ctx);
  addRelevantNote(grpEl, group.relevant);
  addGroupFieldNotes(grpEl, group, false);
}

/** Emit every `<varGrp>` element into `<dataDscr>` (must come before `<var>`). */
function addVarGroups(
  dataDscr: XmlElement,
  dataVars: Variable[],
  notes: InlineNotes,
  buckets: DataVarBuckets,
  ctx: LogicContext,
): void {
  const { gridGroups, multiRespGroups, otherPatterns } = buckets;
  const tree = groupTree(buckets.units);

  for (const node of tree.values()) {
    if (!gridGroups.has(node.group.path)) addSection(dataDscr, node, ctx);
  }

  for (const [groupName, members] of gridGroups) {
    const group = getGroupLabel(dataVars, groupName);
    const node = tree.get(groupName);
    const grpEl = dataDscr.child('varGrp', {
      ID: makeGrpId(groupName),
      name: groupName,
      type: 'grid',
      var: members.map((m) => makeVarId(m.name)).join(' '),
      ...(node?.groups.length ? { varGrp: node.groups.join(' ') } : {}),
    });
    localizedChild(grpEl, 'txt', group.label, group.translations);
    grpEl.textChild('concept', group.label);
    if (node) addUniverse(grpEl, node.universe, ctx);
    // A lead-in note belongs to the group: a member's preQTxt must equal txt.
    addGroupNote(grpEl, notes, members[0]?.name ?? '');
    if (node) {
      addRelevantNote(grpEl, node.group.relevant);
      addGroupFieldNotes(grpEl, node.group, true);
    }
  }

  for (const [smName, smVar] of multiRespGroups) {
    const grpEl = dataDscr.child('varGrp', {
      ID: makeGrpId(smName),
      name: smName,
      type: 'multipleResp',
      var: smVar.choices.map((c) => makeVarId(`${smName}_${c.name}`)).join(' '),
    });
    localizedChild(grpEl, 'txt', smVar.label, textsOf(smVar, 'label'));
    grpEl.textChild('concept', smVar.label);
    addGroupLogic(grpEl, smVar, ctx, { note: notes, name: smName });
  }

  for (const p of otherPatterns.values()) {
    emitOtherPattern(dataDscr, p, ctx, notes);
  }
}

/** Emit every `<var>` element into `<dataDscr>` (XSD ordering: after `<varGrp>`). */
function addVars(
  dataDscr: XmlElement,
  dataVars: Variable[],
  notes: InlineNotes,
  buckets: DataVarBuckets,
  ctx: LogicContext,
): void {
  for (const unit of buckets.units) {
    if (unit.kind === 'multi') {
      for (const choice of unit.v.choices) {
        addBinaryVar(
          dataDscr,
          `${unit.v.name}_${choice.name}`,
          unit.v,
          choice,
          ctx,
        );
      }
    } else if (unit.kind === 'other') {
      emitOtherPatternVars(dataDscr, unit.p, ctx, notes);
    } else if (unit.grid) {
      const group = getGroupLabel(dataVars, unit.grid);
      // preQTxt must equal the group's txt (Schematron); the member's own
      // hint is its postQTxt.
      addVarElement(dataDscr, {
        varId: makeVarId(unit.v.name),
        name: unit.v.name,
        label: unit.v.label,
        varType: unit.v.type,
        choices: unit.v.choices,
        opts: { preQTxt: group.label, preQTxtTranslations: group.translations },
        hint: unit.v.hint,
        guidanceHint: unit.v.guidanceHint,
        ...specTranslations(unit.v),
        logic: { v: unit.v, ctx },
      });
    } else {
      addStandaloneVar(dataDscr, unit.v, notes, ctx);
    }
  }
}

/** A variable outside any grid, pair or `select_multiple`. */
function addStandaloneVar(
  dataDscr: XmlElement,
  v: Variable,
  notes: InlineNotes,
  ctx: LogicContext,
): void {
  addVarElement(dataDscr, {
    varId: makeVarId(v.name),
    name: v.name,
    label: v.label,
    varType: v.type,
    choices: v.choices,
    opts: {
      vocab: v.vocab,
      preQTxt: notes.text[v.name] ?? '',
      preQTxtTranslations: notes.translations[v.name],
    },
    hint: v.hint,
    guidanceHint: v.guidanceHint,
    ...specTranslations(v),
    logic: { v, ctx },
  });
}

/**
 * Build the DDI-Codebook document tree from an already-extracted variable list.
 * Exposed for callers that build a {@link Variable} list by other means.
 */
export function buildDdiCodebook(
  variables: Variable[],
  options: BuildDdiOptions = {},
): XmlElement {
  const {
    assetName = '',
    settings = {},
    submissions = [],
    datasetFilename = 'data.csv',
    prodDate = new Date().toISOString().slice(0, 10),
  } = options;

  const classified = classifyNotes(variables);
  const { dataVars, orphanNotes } = classified;
  const notes: InlineNotes = {
    text: classified.inlinePreqtxt,
    translations: classified.inlinePreqtxtTranslations,
  };

  const title = studyTitle(assetName, settings);

  const root = new XmlElement('codeBook');
  root.setAttr('xmlns', NS);
  root.setAttr('xmlns:xsi', XSI);
  root.setAttr('xsi:schemaLocation', SCHEMA_LOC);
  root.setAttr('version', '2.5');
  const lang =
    typeof settings.default_language === 'string'
      ? languageTagOf(settings.default_language)
      : null;
  if (lang) root.setAttr('xml:lang', lang);

  addStudyDscr(root, settings, title, prodDate, orphanNotes);
  addFileDscr(root, datasetFilename, submissions.length);

  const dataDscr = root.child('dataDscr');
  const buckets = splitDataVars(dataVars);
  const ctx = logicContext(variables, lang, questionIds(buckets.units));
  addVarGroups(dataDscr, dataVars, notes, buckets, ctx);
  addVars(dataDscr, dataVars, notes, buckets, ctx);

  return root;
}

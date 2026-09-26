/**
 * Build DDI-Codebook 2.5 XML from parsed survey data.
 *
 * Output structure (qwacback-compatible):
 * - `<concept>` (not `<labl>`) on `<var>` / `<varGrp>`
 * - `responseDomainType` on every `<qstn>`
 * - `select_multiple` expands into `<varGrp type="multipleResp">` + binary vars
 * - grid groups (`appearance="table-list"`) as `<varGrp type="grid">`
 * - the semi-open `_other` pattern as `<varGrp type="other">`
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
import { Choice, Variable } from './types.js';

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

/** Resolve a group's label from its member variables, else the group name. */
function getGroupLabel(variables: Variable[], groupName: string): string {
  for (const v of variables) {
    if (v.group === groupName && v.groupLabel) return v.groupLabel;
  }
  return groupName;
}

interface AddVarOpts {
  vocab?: string;
  preQTxt?: string;
}

interface AddVarSpec {
  varId: string;
  name: string;
  label: string;
  varType: string;
  choices: Choice[];
  opts?: AddVarOpts;
  /** The source variable's hint (→ preQTxt) and guidance hint (→ ivuInstr). */
  hint?: string;
  guidanceHint?: string;
}

/**
 * Append one `<var>`. Element order: `qstn → catgry* → concept → varFormat`.
 * With `vocab`, no `<catgry>` is emitted and `<concept>` carries `@vocab`.
 */
function addVarElement(parent: XmlElement, spec: AddVarSpec): XmlElement {
  const { varId, name, label, varType, choices } = spec;
  const { vocab = '' } = spec.opts ?? {};
  // A folded note or grid lead-in comes first, then the question's own hint.
  const preQTxt = [spec.opts?.preQTxt, spec.hint]
    .filter((t): t is string => !!t)
    .join('\n\n');
  const [intrvl, fmtType] = DDI_TYPE_MAP[varType] ?? ['discrete', 'character'];
  const respDomain = RESPONSE_DOMAIN_MAP[varType] ?? 'text';

  const varEl = parent.child('var', { ID: varId, name, intrvl, files: 'F1' });

  if (label) {
    const qstn = varEl.child('qstn', { responseDomainType: respDomain });
    if (preQTxt) qstn.textChild('preQTxt', preQTxt);
    qstn.textChild('qstnLit', label);
    // DDI order within <qstn>: preQTxt, qstnLit, postQTxt, forward, backward, ivuInstr.
    if (spec.guidanceHint) qstn.textChild('ivuInstr', spec.guidanceHint);
  }

  if (!vocab) {
    for (const choice of choices) {
      const catgry = varEl.child('catgry');
      catgry.textChild('catValu', choice.name);
      catgry.textChild('labl', choice.label);
    }
  }

  varEl.textChild('concept', label, vocab ? { vocab } : {});
  varEl.child('varFormat', { type: fmtType, schema: 'other' });

  return varEl;
}

/** Append a binary 0/1 `<var>` for one `select_multiple` option. */
function addBinaryVar(
  parent: XmlElement,
  varId: string,
  name: string,
  questionLabel: string,
  choiceLabel: string,
): XmlElement {
  const varEl = parent.child('var', {
    ID: varId,
    name,
    intrvl: 'discrete',
    files: 'F1',
  });

  const qstn = varEl.child('qstn', { responseDomainType: 'multiple' });
  qstn.textChild('preQTxt', questionLabel);
  qstn.textChild('qstnLit', choiceLabel);

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
function emitOtherPattern(dataDscr: XmlElement, p: OtherPattern): void {
  const { base, otherVar } = p;
  const label = base.label;
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
    parentEl.textChild('txt', label);
    parentEl.textChild('concept', label);

    const childEl = dataDscr.child('varGrp', {
      ID: childId,
      name: childName,
      type: 'multipleResp',
      var: childMembers,
    });
    childEl.textChild('txt', label);
    childEl.textChild('concept', label);
  } else {
    const parentEl = dataDscr.child('varGrp', {
      ID: makeGrpId(baseName),
      name: baseName,
      type: 'other',
      var: [makeVarId(baseName), makeVarId(otherVar.name)].join(' '),
    });
    parentEl.textChild('txt', label);
    parentEl.textChild('concept', label);
  }
}

/** Emit the `<var>` elements associated with an `_other` pattern. */
function emitOtherPatternVars(dataDscr: XmlElement, p: OtherPattern): void {
  const { base, otherVar } = p;
  const baseName = base.name;

  if (p.isMulti) {
    for (const choice of base.choices) {
      if (choice.name === OTHER_CODE) continue;
      addBinaryVar(
        dataDscr,
        makeVarId(`${baseName}_${choice.name}`),
        `${baseName}_${choice.name}`,
        base.label,
        choice.label,
      );
    }
  } else {
    addVarElement(dataDscr, {
      varId: makeVarId(baseName),
      name: baseName,
      label: base.label,
      varType: base.type,
      choices: base.choices,
      hint: base.hint,
      guidanceHint: base.guidanceHint,
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
  });
}

/** Optional settings that shape study-level metadata. */
export interface DdiSettings {
  form_title?: string;
  id_string?: string | number;
  version?: string | number;
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

/** Returned by {@link splitDataVars}: every data var bucketed by its emit role. */
export interface DataVarBuckets {
  otherPatterns: Map<string, OtherPattern>;
  gridGroups: Map<string, Variable[]>;
  multiRespGroups: Map<string, Variable>;
  standaloneVars: Variable[];
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
  const standaloneVars: Variable[] = [];

  for (const v of dataVars) {
    if (baseNamesInOther.has(v.name) || otherVarNames.has(v.name)) continue;
    if (v.type === 'select_multiple') {
      multiRespGroups.set(v.name, v);
    } else if (v.group && isGridGroup(dataVars, v.group)) {
      const members = gridGroups.get(v.group) ?? [];
      members.push(v);
      gridGroups.set(v.group, members);
    } else {
      standaloneVars.push(v);
    }
  }

  return { otherPatterns, gridGroups, multiRespGroups, standaloneVars };
}

/** Emit `<stdyDscr>` (citation + orphan notes appended). */
function addStudyDscr(
  root: XmlElement,
  settings: DdiSettings,
  title: string,
  prodDate: string,
  orphanNotes: Variable[],
): void {
  const stdy = root.child('stdyDscr');
  const citation = stdy.child('citation');

  const titlStmt = citation.child('titlStmt');
  titlStmt.textChild('titl', title);
  const studyId = settings.id_string;
  if (studyId) titlStmt.textChild('IDNo', String(studyId));

  const prodStmt = citation.child('prodStmt');
  prodStmt.textChild('prodDate', prodDate, { date: prodDate });

  const ver = settings.version;
  if (ver) citation.child('verStmt').textChild('version', String(ver));

  for (const note of orphanNotes) {
    if (!note.label) continue;
    const attrs: Record<string, string> = { type: 'instruction' };
    if (note.name) attrs.subject = note.name;
    stdy.textChild('notes', note.label, attrs);
  }
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

/** Emit every `<varGrp>` element into `<dataDscr>` (must come before `<var>`). */
function addVarGroups(
  dataDscr: XmlElement,
  dataVars: Variable[],
  notePreqtxt: Record<string, string>,
  buckets: DataVarBuckets,
  otherPatterns: Map<string, OtherPattern>,
): void {
  const { gridGroups, multiRespGroups } = buckets;

  for (const [groupName, members] of gridGroups) {
    const groupLabel = getGroupLabel(dataVars, groupName);
    const grpEl = dataDscr.child('varGrp', {
      ID: makeGrpId(groupName),
      name: groupName,
      type: 'grid',
      var: members.map((m) => makeVarId(m.name)).join(' '),
    });
    grpEl.textChild('txt', groupLabel);
    grpEl.textChild('concept', groupLabel);
    // A lead-in note belongs to the group: a member's preQTxt must equal txt.
    const note = notePreqtxt[members[0]?.name ?? ''];
    if (note) grpEl.textChild('notes', note);
  }

  for (const [smName, smVar] of multiRespGroups) {
    const grpEl = dataDscr.child('varGrp', {
      ID: makeGrpId(smName),
      name: smName,
      type: 'multipleResp',
      var: smVar.choices.map((c) => makeVarId(`${smName}_${c.name}`)).join(' '),
    });
    grpEl.textChild('txt', smVar.label);
    grpEl.textChild('concept', smVar.label);
    const note = notePreqtxt[smName];
    if (note) grpEl.textChild('notes', note);
  }

  for (const p of otherPatterns.values()) {
    emitOtherPattern(dataDscr, p);
  }
}

/** Emit every `<var>` element into `<dataDscr>` (XSD ordering: after `<varGrp>`). */
function addVars(
  dataDscr: XmlElement,
  dataVars: Variable[],
  notePreqtxt: Record<string, string>,
  buckets: DataVarBuckets,
  otherPatterns: Map<string, OtherPattern>,
): void {
  const { gridGroups, multiRespGroups, standaloneVars } = buckets;

  for (const [groupName, members] of gridGroups) {
    const groupLabel = getGroupLabel(dataVars, groupName);
    for (const v of members) {
      // preQTxt must equal the group's txt (Schematron), so a member's own
      // hint has no slot; validateSubset warns `hint-dropped`.
      addVarElement(dataDscr, {
        varId: makeVarId(v.name),
        name: v.name,
        label: v.label,
        varType: v.type,
        choices: v.choices,
        opts: { preQTxt: groupLabel },
        guidanceHint: v.guidanceHint,
      });
    }
  }

  for (const [smName, smVar] of multiRespGroups) {
    for (const choice of smVar.choices) {
      addBinaryVar(
        dataDscr,
        makeVarId(`${smName}_${choice.name}`),
        `${smName}_${choice.name}`,
        smVar.label,
        choice.label,
      );
    }
  }

  for (const p of otherPatterns.values()) {
    emitOtherPatternVars(dataDscr, p);
  }

  for (const v of standaloneVars) {
    addVarElement(dataDscr, {
      varId: makeVarId(v.name),
      name: v.name,
      label: v.label,
      varType: v.type,
      choices: v.choices,
      opts: {
        vocab: v.vocab,
        preQTxt: notePreqtxt[v.name] ?? '',
      },
      hint: v.hint,
      guidanceHint: v.guidanceHint,
    });
  }
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
  const { dataVars, inlinePreqtxt, orphanNotes } = classified;

  const title =
    assetName.trim() || String(settings.form_title ?? '').trim() || 'Untitled';

  const root = new XmlElement('codeBook');
  root.setAttr('xmlns', NS);
  root.setAttr('xmlns:xsi', XSI);
  root.setAttr('xsi:schemaLocation', SCHEMA_LOC);
  root.setAttr('version', '2.5');

  addStudyDscr(root, settings, title, prodDate, orphanNotes);
  addFileDscr(root, datasetFilename, submissions.length);

  const dataDscr = root.child('dataDscr');
  const buckets = splitDataVars(dataVars);
  addVarGroups(
    dataDscr,
    dataVars,
    inlinePreqtxt,
    buckets,
    buckets.otherPatterns,
  );
  addVars(dataDscr, dataVars, inlinePreqtxt, buckets, buckets.otherPatterns);

  return root;
}

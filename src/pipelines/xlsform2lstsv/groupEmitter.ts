import { SurveyRow } from '../../xlsform/types.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { RowEmitter } from './rowEmitter.js';
import { LanguageHandler } from './languageHandler.js';
import { GroupStackItem } from './constants.js';
import { Counters } from './counters.js';

/**
 * Helper class for the group-related callbacks the converter passes
 * into processRow. Doesn't own the seq counters (those are shared with
 * question/matrix emission); instead receives a snapshot via the
 * counters interface and reports back the post-increment values.
 */
export type GroupCounters = Counters;

/** What the pre-scan found about a group (`GroupProcessor`). */
export interface GroupKind {
  messageOnly: boolean;
  parentOnly: boolean;
  array: boolean;
}

/** Helpers passed to handleBeginGroup for name resolution + relevance. */
export interface GroupHelpers {
  sanitizeName: (name: string) => string;
  convertRelevance: (relevant?: string) => string;
}

/**
 * Emits G (group) rows and the X-row (note) placeholders that parent-only
 * groups become. Owns the group stack, current-group pointer, and pending
 * group-note queue.
 *
 * LimeSurvey groups are flat and a question belongs to the G row before it,
 * so a group's G row waits for its first question ({@link openCurrentGroup}),
 * and a group whose own questions resume after a nested group gets another
 * G row there (#206).
 */
export class GroupEmitter {
  private currentGroup: string | null = null;
  private groupStack: GroupStackItem[] = [];
  private pendingGroupNotes: SurveyRow[] = [];
  /** The stack entry the last G row was emitted for. */
  private openGroup: GroupStackItem | null = null;

  constructor(
    private configManager: ConfigManager,
    private rowEmitter: RowEmitter,
    private languageHandler: LanguageHandler,
    private counters: GroupCounters,
  ) {}

  getCurrentGroup(): string | null {
    return this.currentGroup;
  }

  getGroupStack(): GroupStackItem[] {
    return this.groupStack;
  }

  getPendingGroupNotes(): SurveyRow[] {
    return this.pendingGroupNotes;
  }

  addDefaultGroup(): void {
    const groupName = this.configManager.getDefaults().groupName;
    this.currentGroup = groupName;

    // Emit the group in every detected survey language, NOT the config default
    // ('en'). A group row whose language differs from the survey base language
    // fails LimeSurvey's activation consistency check (e.g. a German-base survey
    // with an English-only "Questions" group).
    // The group only exists because LimeSurvey needs one: give it the
    // configured name (defaults.groupName) and no description, rather than
    // repeating the name as a description nobody wrote.
    this.rowEmitter.emitForEachLanguage(
      () => ({ class: 'G', name: groupName, text: '' }),
      'direct',
    );

    this.counters.bumpGroupSeq();
  }

  addAutoGroupForOrphans(): void {
    const groupName = `G${this.counters.getGroupSeq()}`;
    this.counters.bumpGroupSeq();
    this.currentGroup = groupName;

    const groupSeqKey = String(this.counters.getGroupSeq());

    this.rowEmitter.emitForEachLanguage(
      () => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: groupName,
        text: groupName,
      }),
      'direct',
    );
  }

  addGroup(
    row: SurveyRow,
    sanitizeName: (name: string) => string,
    convertRelevance: (relevant?: string) => string,
    withDescription = true,
  ): void {
    const groupName =
      row.name && row.name.trim() !== ''
        ? sanitizeName(row.name.trim())
        : `G${this.counters.getGroupSeq()}`;

    this.counters.bumpGroupSeq();
    this.currentGroup = groupName;

    // type/scale is used as a stable group sequence key for LimeSurvey's TSV importer
    // to correctly match group translations across languages.
    const groupSeqKey = String(this.counters.getGroupSeq());
    const relevance = convertRelevance(row.relevant);

    this.rowEmitter.emitForEachLanguage(
      (lang) => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: this.languageHandler.renderText(row, 'label', lang, groupName),
        relevance,
        text: withDescription
          ? this.languageHandler.renderText(row, 'hint', lang)
          : '',
      }),
      'direct',
    );
  }

  pushStack(item: GroupStackItem): void {
    this.groupStack.push(item);
  }

  popStack(): GroupStackItem | undefined {
    return this.groupStack.pop();
  }

  addPendingGroupNote(row: SurveyRow): void {
    this.pendingGroupNotes.push(row);
  }

  /**
   * Called on end_group. Outside every group, the next question needs a
   * group of its own; inside one, {@link openCurrentGroup} gives the
   * enclosing group's next question its G row.
   */
  restoreCurrentGroupFromStack(): void {
    if (this.groupStack.length === 0) {
      this.currentGroup = null;
      this.openGroup = null;
    }
  }

  /**
   * Before a question: the innermost group's G row, unless it is the last
   * one emitted. The first G row of a group carries its description; one
   * after a nested group, or after its title became a note, carries the
   * title alone (#206).
   */
  openCurrentGroup(helpers: GroupHelpers): void {
    const top = this.groupStack[this.groupStack.length - 1];
    if (!top || top === this.openGroup) return;
    this.rowEmitter.flushGroupContent();
    this.addGroup(
      top.row,
      helpers.sanitizeName,
      helpers.convertRelevance,
      !top.shown,
    );
    this.currentGroup = top.sanitizedName;
    top.shown = true;
    this.openGroup = top;
    this.emitPendingGroupNotes(helpers.sanitizeName, helpers.convertRelevance);
  }

  /**
   * Emit pending parent-only group labels as note questions (type X).
   */
  emitPendingGroupNotes(
    sanitizeName: (name: string) => string,
    convertRelevance: (relevant?: string) => string,
  ): void {
    for (const noteRow of this.pendingGroupNotes) {
      const noteName =
        noteRow.name && noteRow.name.trim() !== ''
          ? sanitizeName(noteRow.name.trim())
          : `GN${this.counters.getQuestionSeq()}`;

      this.counters.bumpQuestionSeq();
      const relevance = convertRelevance(noteRow.relevant);

      this.rowEmitter.emitForEachLanguage((lang) => ({
        class: 'Q',
        'type/scale': 'X',
        name: noteName,
        relevance,
        text: this.languageHandler.renderText(noteRow, 'label', lang, noteName),
        help: this.languageHandler.renderText(noteRow, 'hint', lang),
      }));
    }
    this.pendingGroupNotes = [];
  }

  /** `own` AND-ed with every enclosing group's `relevant`, as XPath. */
  private withAncestors(own: string): string {
    const parts = [...this.groupStack.map((g) => g.relevant ?? ''), own].filter(
      (r) => r !== '',
    );
    if (parts.length <= 1) return parts[0] ?? '';
    return parts.map((r) => `(${r})`).join(' and ');
  }

  /**
   * Handle a `begin_group` row. An enclosing group whose title is not out
   * yet (no question of its own so far) becomes a note first. Then:
   *
   *   - `array` (a `table-list` group with choice rows): emit as a
   *     LimeSurvey array (F) — the G row plus an `addTableListHeader` to mark
   *     the array. A table of numbers is an ordinary group (#174).
   *   - `messageOnly` (group contains only a welcome/end note): push, never
   *     emitted.
   *   - `parentOnly` (group has no direct questions): push, queue a pending
   *     note, never emitted.
   *   - otherwise: push; its first question emits the G row
   *     ({@link openCurrentGroup}).
   */
  handleBeginGroup(
    groupRow: SurveyRow,
    kind: GroupKind,
    helpers: GroupHelpers,
    onTableList: (sanitizedName: string) => void,
  ): void {
    const ownRelevant = relevantOf(groupRow);
    // LimeSurvey groups are flat: a G row (or the note a flattened group
    // becomes) carries its enclosing groups' conditions too.
    const row: SurveyRow = {
      ...groupRow,
      relevant: this.withAncestors(ownRelevant),
    };
    const originalName = (row.name || '').trim();
    const sanitizedName = originalName
      ? helpers.sanitizeName(originalName)
      : `G${this.counters.getGroupSeq()}`;

    for (const outer of this.groupStack) {
      if (outer.shown || outer.messageOnly) continue;
      this.pendingGroupNotes.push(outer.row);
      outer.shown = true;
    }

    const item: GroupStackItem = {
      originalName,
      sanitizedName,
      relevant: ownRelevant,
      row,
      shown: false,
    };
    this.groupStack.push(item);

    if (kind.array) {
      this.openCurrentGroup(helpers);
      onTableList(sanitizedName);
      return;
    }

    if (kind.messageOnly) {
      item.messageOnly = true;
      return;
    }

    if (kind.parentOnly) {
      this.pendingGroupNotes.push(row);
      item.shown = true;
    }
  }
}

function relevantOf(row: SurveyRow): string {
  return typeof row.relevant === 'string' ? row.relevant.trim() : '';
}

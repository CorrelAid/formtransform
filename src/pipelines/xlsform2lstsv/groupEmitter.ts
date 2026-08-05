import { SurveyRow } from '../../config/types.js';
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

/** Helpers passed to handleBeginGroup for name resolution + relevance. */
export interface GroupHelpers {
  sanitizeName: (name: string) => string;
  convertRelevance: (relevant?: string) => Promise<string>;
}

/**
 * Emits G (group) rows and the X-row (note) placeholders that parent-only
 * groups become. Owns the group stack, current-group pointer, and pending
 * group-note queue.
 */
export class GroupEmitter {
  private currentGroup: string | null = null;
  private groupStack: GroupStackItem[] = [];
  private pendingGroupNotes: SurveyRow[] = [];

  constructor(
    private configManager: ConfigManager,
    private rowEmitter: RowEmitter,
    private languageHandler: LanguageHandler,
    private counters: GroupCounters,
  ) {}

  clear(): void {
    this.currentGroup = null;
    this.groupStack = [];
    this.pendingGroupNotes = [];
  }

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
    this.rowEmitter.emitForEachLanguage(
      () => ({ class: 'G', name: groupName, text: groupName }),
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

  async addGroup(
    row: SurveyRow,
    sanitizeName: (name: string) => string,
    convertRelevance: (relevant?: string) => Promise<string>,
  ): Promise<void> {
    const groupName =
      row.name && row.name.trim() !== ''
        ? sanitizeName(row.name.trim())
        : `G${this.counters.getGroupSeq()}`;

    this.counters.bumpGroupSeq();
    this.currentGroup = groupName;

    // type/scale is used as a stable group sequence key for LimeSurvey's TSV importer
    // to correctly match group translations across languages.
    const groupSeqKey = String(this.counters.getGroupSeq());
    const relevance = await convertRelevance(row.relevant);

    this.rowEmitter.emitForEachLanguage(
      (lang) => ({
        class: 'G',
        'type/scale': groupSeqKey,
        name: this.languageHandler.renderLabel(row.label, lang, groupName),
        relevance,
        text: this.languageHandler.renderLabel(row.hint, lang),
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
   * Update currentGroup to the most recent emitted parent in the stack.
   * Called on end_group so questions outside the closed group are still
   * attributed to the right G row.
   */
  restoreCurrentGroupFromStack(): void {
    this.currentGroup = null;
    for (let i = this.groupStack.length - 1; i >= 0; i--) {
      if (this.groupStack[i].emittedAsGroup) {
        this.currentGroup = this.groupStack[i].sanitizedName;
        break;
      }
    }
  }

  /**
   * Emit pending parent-only group labels as note questions (type X).
   */
  async emitPendingGroupNotes(
    sanitizeName: (name: string) => string,
    convertRelevance: (relevant?: string) => Promise<string>,
  ): Promise<void> {
    for (const noteRow of this.pendingGroupNotes) {
      const noteName =
        noteRow.name && noteRow.name.trim() !== ''
          ? sanitizeName(noteRow.name.trim())
          : `GN${this.counters.getQuestionSeq()}`;

      this.counters.bumpQuestionSeq();
      const relevance = await convertRelevance(noteRow.relevant);

      this.rowEmitter.emitForEachLanguage((lang) => ({
        class: 'Q',
        'type/scale': 'X',
        name: noteName,
        relevance,
        text: this.languageHandler.renderLabel(noteRow.label, lang, noteName),
        help: this.languageHandler.renderLabel(noteRow.hint, lang),
      }));
    }
    this.pendingGroupNotes = [];
  }

  /**
   * Handle a `begin_group` row. Three cases:
   *
   *   - `table-list` appearance: emit as a LimeSurvey array (F) — the G row
   *     plus an `addTableListHeader` to mark the array.
   *   - `messageOnly` (group contains only a welcome/end note): push to
   *     stack with `emittedAsGroup: false` and skip emission.
   *   - `parentOnly` (group has no direct questions): push, queue a pending
   *     note, do not emit.
   *   - otherwise: push, emit G row, flush pending notes.
   */
  async handleBeginGroup(
    row: SurveyRow,
    isMessageOnly: boolean,
    isParentOnly: boolean,
    helpers: GroupHelpers,
    onTableList: (sanitizedName: string) => Promise<void>,
  ): Promise<void> {
    const { sanitizeName, convertRelevance } = helpers;
    const originalName = (row.name || '').trim();
    const sanitizedName = originalName
      ? sanitizeName(originalName)
      : `G${this.counters.getGroupSeq()}`;

    const groupAppearance =
      typeof row['appearance'] === 'string' ? row['appearance'].trim() : '';

    if (groupAppearance.includes('table-list')) {
      this.groupStack.push({
        originalName,
        sanitizedName,
        emittedAsGroup: true,
      });
      this.rowEmitter.flushGroupContent();
      await this.addGroup(row, sanitizeName, convertRelevance);
      await this.emitPendingGroupNotes(sanitizeName, convertRelevance);
      await onTableList(sanitizedName);
      return;
    }

    if (isMessageOnly) {
      this.groupStack.push({
        originalName,
        sanitizedName,
        emittedAsGroup: false,
      });
      return;
    }

    if (isParentOnly) {
      this.groupStack.push({
        originalName,
        sanitizedName,
        emittedAsGroup: false,
      });
      this.pendingGroupNotes.push(row);
      return;
    }

    this.groupStack.push({
      originalName,
      sanitizedName,
      emittedAsGroup: true,
    });
    this.rowEmitter.flushGroupContent();
    await this.addGroup(row, sanitizeName, convertRelevance);
    await this.emitPendingGroupNotes(sanitizeName, convertRelevance);
  }
}

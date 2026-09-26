import { SurveyRow } from '../../xlsform/types.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { SKIP_TYPES } from './constants.js';
import type { Item, QuestionItem } from '../../instrument/types.js';

export interface GroupInfo {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}

/** Config flags read by {@link isMessageNoteRow} — a narrow shape to avoid coupling. */
interface WelcomeEndFlags {
  convertWelcomeNote?: boolean;
  convertEndNote?: boolean;
}

/** Pure helper: is this row a configured welcome/end note (`type=note` + match name)? */
function isMessageNoteRow(row: SurveyRow, flags: WelcomeEndFlags): boolean {
  if (row.type !== 'note') return false;
  const rowName = (row.name || '').trim().toLowerCase();
  return (
    (Boolean(flags.convertWelcomeNote) && rowName === 'welcome') ||
    (Boolean(flags.convertEndNote) && rowName === 'end')
  );
}

/**
 * Handles group processing for XLSForm to TSV conversion
 */
export class GroupProcessor {
  private messageOnlyGroups = new Set<string>();
  private parentOnlyGroups = new Set<string>();

  constructor(private configManager: ConfigManager) {}

  getMessageOnlyGroups(): Set<string> {
    return this.messageOnlyGroups;
  }

  getParentOnlyGroups(): Set<string> {
    return this.parentOnlyGroups;
  }

  /**
   * Classify every closed group of the Instrument's tree (#69):
   * - message-only: its direct content is only a welcome/end note (suppressed);
   * - parent-only: it has no direct questions, only child groups (flattened).
   * Skipped types (metadata, …) count as no content. Groups the sheet never
   * closed are neither.
   */
  identifyGroups(body: Item[]): void {
    const flags = this.configManager.getConfig();
    const messageOnly = new Set<string>();
    const parentOnly = new Set<string>();
    const visit = (items: Item[]) => {
      for (const item of items) {
        if (item.kind !== 'group') continue;
        visit(item.children);
        if (!item.closed) continue;
        const content = item.children.filter(
          (c): c is QuestionItem =>
            c.kind === 'question' && !SKIP_TYPES.includes(c.type),
        );
        const notes = content.filter((c) =>
          isMessageNoteRow(c.row as SurveyRow, flags),
        );
        if (notes.length > 0 && notes.length === content.length) {
          messageOnly.add(item.name);
        }
        if (content.length === 0) parentOnly.add(item.name);
      }
    };
    visit(body);
    this.messageOnlyGroups = messageOnly;
    this.parentOnlyGroups = parentOnly;
  }
}

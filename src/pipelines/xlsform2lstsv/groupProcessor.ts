import { SurveyRow } from '../../xlsform/types.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { SKIP_TYPES } from './constants.js';

export interface GroupInfo {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}

/** A row whose `type` opens or closes a group, recognised in both forms. */
function isBeginGroup(type: string): boolean {
  return type === 'begin_group' || type === 'begin group';
}

function isEndGroup(type: string): boolean {
  return type === 'end_group' || type === 'end group';
}

/** Map an "open" row to its group name, with the trim applied. */
function beginGroupName(row: SurveyRow): string {
  return (row.name || '').trim();
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

/** Per-group bookkeeping during the message-only prescan. */
interface MessageGroupInfo {
  hasMessageNote: boolean;
  hasOtherContent: boolean;
}

function extractBaseType(row: SurveyRow): string {
  return (row.type || '').trim().split(/\s+/)[0];
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
   * Pre-scan survey data to identify groups whose only direct content is a
   * welcome or end note. These groups are silently suppressed.
   */
  identifyMessageOnlyGroups(surveyData: SurveyRow[]): void {
    const messageOnly = new Set<string>();
    const stack: string[] = [];
    const groupInfo = new Map<string, MessageGroupInfo>();
    const flags = this.configManager.getConfig();

    for (const row of surveyData) {
      const type = (row.type || '').trim();
      if (isBeginGroup(type)) {
        const name = beginGroupName(row);
        stack.push(name);
        groupInfo.set(name, { hasMessageNote: false, hasOtherContent: false });
        continue;
      }
      if (isEndGroup(type)) {
        const name = stack.pop();
        if (name === undefined) continue;
        const info = groupInfo.get(name);
        if (info && info.hasMessageNote && !info.hasOtherContent) {
          messageOnly.add(name);
        }
        continue;
      }
      if (
        !type ||
        stack.length === 0 ||
        SKIP_TYPES.includes(extractBaseType(row))
      )
        continue;
      const info = groupInfo.get(stack[stack.length - 1]);
      if (!info) continue;
      if (isMessageNoteRow(row, flags)) info.hasMessageNote = true;
      else info.hasOtherContent = true;
    }

    this.messageOnlyGroups = messageOnly;
  }

  /**
   * Pre-scan survey data to identify parent-only groups.
   * A parent-only group contains no direct questions — only child groups.
   */
  identifyParentOnlyGroups(surveyData: SurveyRow[]): void {
    const parentOnly = new Set<string>();
    const stack: string[] = [];
    const hasDirectContent = new Map<string, boolean>();

    for (const row of surveyData) {
      const type = (row.type || '').trim();
      if (isBeginGroup(type)) {
        const name = beginGroupName(row);
        stack.push(name);
        hasDirectContent.set(name, false);
        continue;
      }
      if (isEndGroup(type)) {
        const name = stack.pop();
        if (name !== undefined && !hasDirectContent.get(name)) {
          parentOnly.add(name);
        }
        continue;
      }
      if (!type || SKIP_TYPES.includes(extractBaseType(row))) continue;
      if (stack.length > 0) {
        hasDirectContent.set(stack[stack.length - 1], true);
      }
    }

    this.parentOnlyGroups = parentOnly;
  }
}

import { SurveyRow } from '../../config/types.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { SKIP_TYPES } from './constants.js';

export interface GroupInfo {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}

/**
 * Handles group processing for XLSForm to TSV conversion
 */
export class GroupProcessor {
  private messageOnlyGroups = new Set<string>();
  private parentOnlyGroups = new Set<string>();

  constructor(private configManager: ConfigManager) {}

  clear(): void {
    this.messageOnlyGroups.clear();
    this.parentOnlyGroups.clear();
  }

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
    const groupInfo = new Map<
      string,
      { hasMessageNote: boolean; hasOtherContent: boolean }
    >();

    for (const row of surveyData) {
      const type = (row.type || '').trim();
      const baseType = type.split(/\s+/)[0];

      if (type === 'begin_group' || type === 'begin group') {
        const name = (row.name || '').trim();
        stack.push(name);
        groupInfo.set(name, { hasMessageNote: false, hasOtherContent: false });
      } else if (type === 'end_group' || type === 'end group') {
        const name = stack.pop();
        if (name !== undefined) {
          const info = groupInfo.get(name);
          if (info && info.hasMessageNote && !info.hasOtherContent) {
            messageOnly.add(name);
          }
        }
      } else if (type && stack.length > 0 && !SKIP_TYPES.includes(baseType)) {
        const groupName = stack[stack.length - 1];
        const info = groupInfo.get(groupName);
        if (info) {
          const rowName = (row.name || '').trim().toLowerCase();
          const cfg = this.configManager.getConfig();
          const isMessageNote =
            type === 'note' &&
            ((cfg.convertWelcomeNote && rowName === 'welcome') ||
              (cfg.convertEndNote && rowName === 'end'));
          if (isMessageNote) {
            info.hasMessageNote = true;
          } else {
            info.hasOtherContent = true;
          }
        }
      }
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
      const baseType = type.split(/\s+/)[0];

      if (type === 'begin_group' || type === 'begin group') {
        const name = (row.name || '').trim();
        stack.push(name);
        hasDirectContent.set(name, false);
      } else if (type === 'end_group' || type === 'end group') {
        const name = stack.pop();
        if (name !== undefined && !hasDirectContent.get(name)) {
          parentOnly.add(name);
        }
      } else if (type && !SKIP_TYPES.includes(baseType)) {
        if (stack.length > 0) {
          hasDirectContent.set(stack[stack.length - 1], true);
        }
      }
    }

    this.parentOnlyGroups = parentOnly;
  }

  /**
   * Determines if a group should be emitted based on its properties
   */
  shouldEmitGroup(
    groupName: string,
    groupAppearance: string,
  ): { emit: boolean; isTableList: boolean } {
    const isTableList = groupAppearance.includes('table-list');
    const isMessageOnly = this.messageOnlyGroups.has(groupName);
    const isParentOnly = this.parentOnlyGroups.has(groupName);

    return {
      emit: !isMessageOnly && !isParentOnly,
      isTableList,
    };
  }
}

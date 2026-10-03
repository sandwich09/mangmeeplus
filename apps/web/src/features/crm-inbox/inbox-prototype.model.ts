// Pure presentation helpers for the Mangmee CRM Inbox shell.

import type {
  CrmConversationStatus,
  CrmMessageSummary,
  ListCrmConversationsResult,
} from '@watchdog-bms/contracts';
import {
  CONVERSATION_STATUS_META,
  INBOX_STATUS_ORDER,
} from './crm-inbox.logic';

export const INBOX_PAGE_SIZE = 10;

export type InboxChipId = 'all' | 'overdue' | 'unanswered' | 'mine' | 'unassigned' | CrmConversationStatus;
export type InboxChip = { id: InboxChipId; label: string; count: number };

export function buildStatusChips(result: Pick<
  ListCrmConversationsResult,
  'total' | 'statusCounts' | 'overdueCount' | 'unansweredCount' | 'mineCount' | 'unassignedCount'
>): InboxChip[] {
  const counts = result.statusCounts ?? {};
  const all = INBOX_STATUS_ORDER.reduce((sum, st) => sum + (st === 'SPAM' ? 0 : counts[st] ?? 0), 0) || result.total;
  const chips: InboxChip[] = [{ id: 'all', label: 'ทั้งหมด', count: all }];
  if ((result.overdueCount ?? 0) > 0) chips.push({ id: 'overdue', label: '⏱ รอตอบเกินกำหนด', count: result.overdueCount! });
  if ((result.unansweredCount ?? 0) > 0) chips.push({ id: 'unanswered', label: 'ยังไม่ได้ตอบ', count: result.unansweredCount! });
  if ((result.mineCount ?? 0) > 0) chips.push({ id: 'mine', label: '👤 ของฉัน', count: result.mineCount! });
  if ((result.unassignedCount ?? 0) > 0) chips.push({ id: 'unassigned', label: 'ยังไม่มีผู้รับ', count: result.unassignedCount! });
  for (const st of INBOX_STATUS_ORDER) {
    const count = counts[st] ?? 0;
    if (count > 0) chips.push({ id: st, label: CONVERSATION_STATUS_META[st].label, count });
  }
  return chips;
}

export function chipColor(id: InboxChipId): { c: string; bg: string } {
  if (id === 'all') return { c: '#027A48', bg: '#D1FAE5' };
  if (id === 'overdue') return { c: '#DC2626', bg: '#FEE2E2' };
  if (id === 'unanswered') return { c: '#C4320A', bg: '#FFF6ED' };
  if (id === 'mine') return { c: '#2563EB', bg: '#DBEAFE' };
  if (id === 'unassigned') return { c: '#B54708', bg: '#FEF0C7' };
  const meta = CONVERSATION_STATUS_META[id];
  return { c: meta.color, bg: meta.bg };
}

/** The chip a deep link opens: the dashboard cards link to `?overdue=true` and `?unanswered=true`. */
export function chipFromSearch(search: string): InboxChipId {
  const params = new URLSearchParams(search);
  if (params.get('overdue') === 'true') return 'overdue';
  if (params.get('unanswered') === 'true') return 'unanswered';
  return 'all';
}

/** The list a chip asks the API for; its count is that chip's, and the dashboard card's that links to it. */
export function chipListFilter(chip: InboxChipId): {
  status?: CrmConversationStatus; overdue?: true; unanswered?: true; assignee?: 'me' | 'none';
} {
  return {
    status: INBOX_STATUS_ORDER.includes(chip as CrmConversationStatus) ? (chip as CrmConversationStatus) : undefined,
    overdue: chip === 'overdue' ? true : undefined,
    unanswered: chip === 'unanswered' ? true : undefined,
    assignee: chip === 'mine' ? 'me' : chip === 'unassigned' ? 'none' : undefined,
  };
}

export function visibleMessages(messages: CrmMessageSummary[], noteMode: boolean): CrmMessageSummary[] {
  return noteMode ? messages : messages.filter((m) => m.visibility !== 'INTERNAL_NOTE');
}

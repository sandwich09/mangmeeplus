import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CrmMessageSummary, ListCrmConversationsResult } from '@watchdog-bms/contracts';
import { buildStatusChips, chipColor, chipFromSearch, chipListFilter, visibleMessages } from './inbox-prototype.model';
import { listConversations } from './crm-inbox.api';

const result: Pick<ListCrmConversationsResult, 'total' | 'statusCounts' | 'overdueCount' | 'unansweredCount' | 'mineCount' | 'unassignedCount'> = {
  total: 7,
  statusCounts: { NEW: 2, OPEN: 3, RESOLVED: 1, SPAM: 1 },
  overdueCount: 1,
  unansweredCount: 4,
  mineCount: 2,
  unassignedCount: 1,
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const msg = (id: string, visibility: CrmMessageSummary['visibility']): CrmMessageSummary => ({
  id,
  conversationId: 'conv-1',
  direction: 'INBOUND',
  visibility,
  authorType: 'CUSTOMER',
  messageType: 'TEXT',
  contentText: id,
  deliveryStatus: 'SENT',
  createdAt: '2026-07-09T00:00:00.000Z',
});

describe('inbox prototype model', () => {
  it('builds real-data chips without mock-only auto filters', () => {
    const chips = buildStatusChips(result);
    assert.deepEqual(chips.map((c) => c.id), ['all', 'overdue', 'unanswered', 'mine', 'unassigned', 'NEW', 'OPEN', 'RESOLVED', 'SPAM']);
    assert.equal(chips[0]!.count, 6);
  });

  // Browser check 2026-10-03: the dashboard card "ยังไม่ได้ตอบ" opened the whole inbox, so its number never matched the
  // rows. It now links to ?unanswered=true: the inbox opens on its own "ยังไม่ได้ตอบ" chip, whose count is the card's,
  // and asks the API for exactly those chats.
  it('opens the chip a dashboard card links to and asks the API for that list', async () => {
    assert.equal(chipFromSearch('?unanswered=true'), 'unanswered');
    assert.equal(chipFromSearch('?overdue=true'), 'overdue');
    assert.equal(chipFromSearch('?tag=vip'), 'all');
    const chip = buildStatusChips(result).find((c) => c.id === 'unanswered')!;
    assert.deepEqual([chip.label, chip.count], ['ยังไม่ได้ตอบ', 4]);
    assert.deepEqual(chipListFilter('unanswered'), { status: undefined, overdue: undefined, unanswered: true, assignee: undefined });
    assert.deepEqual(chipListFilter('overdue'), { status: undefined, overdue: true, unanswered: undefined, assignee: undefined });
    assert.deepEqual(chipListFilter('mine'), { status: undefined, overdue: undefined, unanswered: undefined, assignee: 'me' });
    assert.deepEqual(chipListFilter('unassigned'), { status: undefined, overdue: undefined, unanswered: undefined, assignee: 'none' });
    assert.deepEqual(chipListFilter('OPEN'), { status: 'OPEN', overdue: undefined, unanswered: undefined, assignee: undefined });
    let url = '';
    globalThis.fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 10 }), { status: 200 });
    };
    await listConversations('co-1', { ...chipListFilter('unanswered'), page: 1, pageSize: 10 });
    assert.match(url, /\/companies\/co-1\/crm\/conversations\?unanswered=true&page=1&pageSize=10$/);
  });

  // Owner report 2026-10-02: the chip and the button said "เกิน 30 นาที", but the minutes are the shop's
  // own setting and the inbox does not hold them. The live inbox words these two itself.
  it('calls late chats "รอตอบเกินกำหนด", with no number of minutes', () => {
    assert.equal(buildStatusChips(result).find((c) => c.id === 'overdue')!.label, '⏱ รอตอบเกินกำหนด');
    const page = readFileSync(new URL('./InboxPrototypePage.tsx', import.meta.url), 'utf8');
    assert.match(page, /ดู \{overdueCount\} แชทด่วนที่รอตอบเกินกำหนด/);
    assert.doesNotMatch(page, /30 นาที/);
  });

  it('has stable chip colors per filter kind', () => {
    assert.deepEqual(chipColor('overdue'), { c: '#DC2626', bg: '#FEE2E2' });
    assert.deepEqual(chipColor('mine'), { c: '#2563EB', bg: '#DBEAFE' });
    assert.deepEqual(chipColor('unanswered'), { c: '#C4320A', bg: '#FFF6ED' });
    assert.deepEqual(chipColor('NEW'), { c: '#DC2626', bg: '#FEE2E2' });
  });

  it('hides internal notes outside note mode', () => {
    const messages = [msg('customer', 'CUSTOMER'), msg('note', 'INTERNAL_NOTE')];
    assert.deepEqual(visibleMessages(messages, false).map((m) => m.id), ['customer']);
    assert.deepEqual(visibleMessages(messages, true).map((m) => m.id), ['customer', 'note']);
  });
});

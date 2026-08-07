import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CrmMessageSummary, ListCrmConversationsResult } from '@watchdog-bms/contracts';
import { buildStatusChips, chipColor, visibleMessages } from './inbox-prototype.model';

const result: Pick<ListCrmConversationsResult, 'total' | 'statusCounts' | 'overdueCount' | 'mineCount' | 'unassignedCount'> = {
  total: 7,
  statusCounts: { NEW: 2, OPEN: 3, RESOLVED: 1, SPAM: 1 },
  overdueCount: 1,
  mineCount: 2,
  unassignedCount: 1,
};

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
    assert.deepEqual(chips.map((c) => c.id), ['all', 'overdue', 'mine', 'unassigned', 'NEW', 'OPEN', 'RESOLVED', 'SPAM']);
    assert.equal(chips[0]!.count, 6);
  });

  it('has stable chip colors per filter kind', () => {
    assert.deepEqual(chipColor('overdue'), { c: '#DC2626', bg: '#FEE2E2' });
    assert.deepEqual(chipColor('mine'), { c: '#2563EB', bg: '#DBEAFE' });
    assert.deepEqual(chipColor('NEW'), { c: '#DC2626', bg: '#FEE2E2' });
  });

  it('hides internal notes outside note mode', () => {
    const messages = [msg('customer', 'CUSTOMER'), msg('note', 'INTERNAL_NOTE')];
    assert.deepEqual(visibleMessages(messages, false).map((m) => m.id), ['customer']);
    assert.deepEqual(visibleMessages(messages, true).map((m) => m.id), ['customer', 'note']);
  });
});

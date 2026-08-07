import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ScanCrmNewConversationsUseCase } from './scan-crm-new-conversations.use-case';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';

function conversation(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', status: 'NEW', priority: 'NORMAL', tags: [],
    assignedToUserId: null, unreadCount: 1, lastMessageAt: new Date(), lastMessagePreview: 'สวัสดีครับ',
    firstResponseDueAt: new Date(), firstRespondedAt: null, slaBreachedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

function makeRepo(
  candidates: any[],
  managers: string[] = ['owner-1', 'mgr-1'],
  erasedCustomerIds: string[] = [],
) {
  return {
    findNewUnassignedConversations: async () => candidates,
    withLiveCustomerDataLock: async (input: any, callback: () => Promise<any>) => (
      erasedCustomerIds.includes(input.customerId) ? null : callback()
    ),
    findInboxManagerUserIds: async () => managers,
    findCustomerDisplayNames: async (_co: string, ids: string[]) => new Map(ids.map((id) => [id, 'คุณฝ้าย'])),
  } as any;
}

function makeNotifier(opts: { skipIds?: string[]; failIds?: string[] } = {}) {
  const calls: any[] = [];
  return {
    calls,
    execute: async (input: any) => {
      if (opts.failIds?.includes(input.sourceId)) throw new Error('notification center down');
      calls.push(input);
      if (opts.skipIds?.includes(input.sourceId)) return { skipped: true, reason: 'cooldown' };
      return { skipped: false };
    },
  } as any;
}

describe('ScanCrmNewConversationsUseCase (A4)', () => {
  it('notifies inbox managers of a new unassigned conversation', async () => {
    const notifier = Object.create(CreateOrUpdateNotificationEventUseCase.prototype) as CreateOrUpdateNotificationEventUseCase;
    const calls: any[] = [];
    mock.method(notifier, 'execute', async (input: any) => {
      calls.push(input);
      return { skipped: false };
    });
    const preview = 'สวัสดีครับ ขอราคาหน่อย';
    const result = await new ScanCrmNewConversationsUseCase(makeRepo([conversation({ lastMessagePreview: preview })]), notifier).execute();
    assert.deepEqual(result, { scanned: 1, notified: 1 });
    assert.equal(calls[0].triggerKey, 'crm_new_conversation');
    assert.equal(calls[0].severity, 'action');
    assert.deepEqual(calls[0].recipientUserIds, ['owner-1', 'mgr-1']);
    assert.match(calls[0].title, /คุณฝ้าย/);
    assert.equal(calls[0].body, 'มีลูกค้าทักเข้ามาใหม่ ยังไม่มีผู้รับผิดชอบ');
    assert.doesNotMatch(calls[0].body, new RegExp(preview));
  });

  it('empty scan is a no-op', async () => {
    const notifier = makeNotifier();
    assert.deepEqual(await new ScanCrmNewConversationsUseCase(makeRepo([]), notifier).execute(), { scanned: 0, notified: 0 });
    assert.equal(notifier.calls.length, 0);
  });

  it('skips companies with no inbox managers', async () => {
    const notifier = makeNotifier();
    const result = await new ScanCrmNewConversationsUseCase(makeRepo([conversation()], []), notifier).execute();
    assert.deepEqual(result, { scanned: 1, notified: 0 });
    assert.equal(notifier.calls.length, 0);
  });

  it('cooldown-skipped notifications are not counted as notified', async () => {
    const notifier = makeNotifier({ skipIds: ['conv-1'] });
    const result = await new ScanCrmNewConversationsUseCase(makeRepo([conversation()]), notifier).execute();
    assert.deepEqual(result, { scanned: 1, notified: 0 });
  });

  it('does not notify when erasure wins after the candidate scan', async () => {
    const notifier = makeNotifier();
    const result = await new ScanCrmNewConversationsUseCase(
      makeRepo([conversation()], ['owner-1'], ['cust-1']),
      notifier,
    ).execute();

    assert.deepEqual(result, { scanned: 1, notified: 0 });
    assert.deepEqual(notifier.calls, []);
  });

  it('a notification failure does not abort the sweep', async () => {
    const notifier = makeNotifier({ failIds: ['conv-1'] });
    const result = await new ScanCrmNewConversationsUseCase(
      makeRepo([conversation(), conversation({ id: 'conv-2', customerId: 'cust-2' })]),
      notifier,
    ).execute();
    // conv-1 throws, conv-2 still notified
    assert.equal(result.scanned, 2);
    assert.equal(result.notified, 1);
  });

  it('records candidate companies on the new-conversation shadow surface', async () => {
    const records: Array<[string, string]> = [];
    let surface = '';
    const shadow = {
      startSweep: (value: string) => {
        surface = value;
        return {
          record: async (companyId: string, featureKey: string) => { records.push([companyId, featureKey]); },
          flush: async () => ({}),
        };
      },
    } as any;

    await new ScanCrmNewConversationsUseCase(makeRepo([conversation()]), makeNotifier(), shadow).execute();

    assert.equal(surface, 'crm.newconv.scan');
    assert.deepEqual(records, [['co-1', 'crm']]);
  });
});

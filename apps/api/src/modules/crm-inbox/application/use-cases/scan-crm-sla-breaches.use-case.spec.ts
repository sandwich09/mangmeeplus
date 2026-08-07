import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScanCrmSlaBreachesUseCase } from './scan-crm-sla-breaches.use-case';

function conversation(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'cust-1', channelIdentityId: 'ident-1',
    status: 'NEW', priority: 'NORMAL', tags: [], assignedToUserId: null, unreadCount: 1,
    lastMessageAt: new Date(), lastInboundAt: new Date(), lastOutboundAt: null,
    lastMessagePreview: 'สวัสดีค่ะ', firstResponseDueAt: new Date('2026-07-06T11:00:00Z'), firstRespondedAt: null,
    slaBreachedAt: null, resolvedAt: null, resolvedByUserId: null, reopenedCount: 0,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

function makeRepo(candidates: any[], options: { racedIds?: string[]; erasedCustomerIds?: string[] } = {}) {
  const marked: string[] = [];
  return {
    marked,
    findSlaBreachCandidates: async () => candidates,
    withLiveCustomerDataLock: async (input: any, callback: () => Promise<any>) => (
      options.erasedCustomerIds?.includes(input.customerId) ? null : callback()
    ),
    markSlaBreached: async (id: string) => {
      if (options.racedIds?.includes(id)) return false;
      marked.push(id);
      return true;
    },
    findInboxManagerUserIds: async () => ['owner-1', 'mgr-1'],
    findCustomerDisplayNames: async (_co: string, ids: string[]) => new Map(ids.map((id) => [id, 'คุณฝ้าย'])),
  } as any;
}

function makeOutbox() {
  const events: any[] = [];
  return { events, append: async (type: string, aggType: string, aggId: string, payload: any) => { events.push({ type, aggId, payload }); } } as any;
}

function makeNotifier(failFor: string[] = []) {
  const calls: any[] = [];
  return {
    calls,
    execute: async (input: any) => {
      if (failFor.includes(input.sourceId)) throw new Error('notification center down');
      calls.push(input);
      return { skipped: false };
    },
  } as any;
}

describe('ScanCrmSlaBreachesUseCase', () => {
  it('marks the breach, emits the outbox event, and notifies managers + assignee (deduped)', async () => {
    const repo = makeRepo([conversation({ assignedToUserId: 'mgr-1' })]);
    const outbox = makeOutbox();
    const notifier = makeNotifier();
    const result = await new ScanCrmSlaBreachesUseCase(repo, outbox, notifier).execute();

    assert.deepEqual(result, { scanned: 1, breached: 1 });
    assert.deepEqual(repo.marked, ['conv-1']);
    assert.equal(outbox.events.length, 1);
    assert.equal(outbox.events[0].type, 'crm.conversation.sla_breached');
    assert.equal(outbox.events[0].payload.data.customerId, 'cust-1');
    assert.equal(notifier.calls.length, 1);
    const call = notifier.calls[0];
    assert.equal(call.triggerKey, 'crm_sla_breach');
    assert.equal(call.severity, 'action');
    assert.match(call.title, /คุณฝ้าย/);
    assert.deepEqual([...call.recipientUserIds].sort(), ['mgr-1', 'owner-1']);
    assert.equal(call.sourceRefs[0].permissionKey, 'crm.inbox.read');
  });

  it('includes an unassigned conversation and adds the assignee for assigned ones', async () => {
    const repo = makeRepo([
      conversation({ id: 'conv-1' }),
      conversation({ id: 'conv-2', customerId: 'cust-2', assignedToUserId: 'sales-9' }),
    ]);
    const notifier = makeNotifier();
    await new ScanCrmSlaBreachesUseCase(repo, makeOutbox(), notifier).execute();
    assert.deepEqual([...notifier.calls[0].recipientUserIds].sort(), ['mgr-1', 'owner-1']);
    assert.deepEqual([...notifier.calls[1].recipientUserIds].sort(), ['mgr-1', 'owner-1', 'sales-9']);
  });

  it('skips rows another pass (or a staff reply) already won', async () => {
    const repo = makeRepo([conversation({ id: 'conv-1' }), conversation({ id: 'conv-2' })], { racedIds: ['conv-1'] });
    const outbox = makeOutbox();
    const notifier = makeNotifier();
    const result = await new ScanCrmSlaBreachesUseCase(repo, outbox, notifier).execute();
    assert.deepEqual(result, { scanned: 2, breached: 1 });
    assert.equal(outbox.events.length, 1);
    assert.equal(outbox.events[0].aggId, 'conv-2');
    assert.equal(notifier.calls.length, 1);
  });

  it('does not mark, emit, or notify when erasure wins after the candidate scan', async () => {
    const repo = makeRepo([conversation()], { erasedCustomerIds: ['cust-1'] });
    const outbox = makeOutbox();
    const notifier = makeNotifier();

    assert.deepEqual(
      await new ScanCrmSlaBreachesUseCase(repo, outbox, notifier).execute(),
      { scanned: 1, breached: 0 },
    );
    assert.deepEqual(repo.marked, []);
    assert.deepEqual(outbox.events, []);
    assert.deepEqual(notifier.calls, []);
  });

  it('awaits the outbox append before creating the notification', async () => {
    let appendFinished = false;
    const outbox = {
      append: async () => {
        await Promise.resolve();
        appendFinished = true;
      },
    } as any;
    const notifier = {
      execute: async () => {
        assert.equal(appendFinished, true);
        return { skipped: false };
      },
    } as any;

    assert.deepEqual(
      await new ScanCrmSlaBreachesUseCase(makeRepo([conversation()]), outbox, notifier).execute(),
      { scanned: 1, breached: 1 },
    );
  });

  it('a notification failure never aborts the rest of the sweep', async () => {
    const repo = makeRepo([conversation({ id: 'conv-1' }), conversation({ id: 'conv-2' })]);
    const notifier = makeNotifier(['conv-1']);
    const result = await new ScanCrmSlaBreachesUseCase(repo, makeOutbox(), notifier).execute();
    assert.deepEqual(result, { scanned: 2, breached: 2 });
    assert.equal(notifier.calls.length, 1);
    assert.equal(notifier.calls[0].sourceId, 'conv-2');
  });

  it('an empty scan does nothing', async () => {
    const repo = makeRepo([]);
    const notifier = makeNotifier();
    const result = await new ScanCrmSlaBreachesUseCase(repo, makeOutbox(), notifier).execute();
    assert.deepEqual(result, { scanned: 0, breached: 0 });
    assert.equal(notifier.calls.length, 0);
  });

  it('records each candidate company before the mutation and flushes the CRM SLA surface', async () => {
    const records: Array<[string, string]> = [];
    let surface = '';
    let flushed = false;
    const shadow = {
      startSweep: (value: string) => {
        surface = value;
        return {
          record: async (companyId: string, featureKey: string) => { records.push([companyId, featureKey]); },
          flush: async () => { flushed = true; return {}; },
        };
      },
    } as any;
    const repo = makeRepo([conversation(), conversation({ id: 'conv-2' })]);

    await new ScanCrmSlaBreachesUseCase(repo, makeOutbox(), makeNotifier(), shadow).execute();

    assert.equal(surface, 'crm.sla.scan');
    assert.deepEqual(records, [['co-1', 'crm']]);
    assert.equal(flushed, true);
  });
});

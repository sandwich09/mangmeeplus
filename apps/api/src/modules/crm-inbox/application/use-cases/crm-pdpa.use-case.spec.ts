import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EraseCrmCustomerUseCase, ProcessCrmErasureRequestsUseCase, PurgeCrmPdpaUseCase } from './crm-pdpa.use-case';
import { PDPA_ERASED_DISPLAY_NAME } from '../../domain/crm-inbox.constants';

function makeAudit() {
  const entries: any[] = [];
  return { entries, log: async (e: any) => { entries.push(e); } } as any;
}

const ctx = { companyId: 'co-1', userId: 'admin-1', requestId: 'req-1' } as any;

describe('PurgeCrmPdpaUseCase', () => {
  it('purges text + media past retention, clears previews, and audits when anything changed', async () => {
    const calls: any = {};
    const repo = {
      purgeExpiredMessageText: async (before: Date, limit: number) => { calls.text = { before, limit }; return 7; },
      clearExpiredConversationPreviews: async (before: Date) => { calls.previews = { before }; return 3; },
      purgeExpiredMedia: async (before: Date, limit: number) => { calls.media = { before, limit }; return 2; },
      purgeExpiredAiData: async (before: Date, limit: number) => { calls.ai = { before, limit }; return { turns: 4, conversations: 1 }; },
    } as any;
    const audit = makeAudit();
    const result = await new PurgeCrmPdpaUseCase(repo, audit, { aiDataRetentionDays: 90 } as any).execute();

    assert.deepEqual(result, { textPurged: 7, mediaPurged: 2, previewsCleared: 3, aiTurnsPurged: 4, aiConversationsPurged: 1 });
    // media cut-off (12mo) is more recent than text cut-off (24mo)
    assert.ok(calls.media.before.getTime() > calls.text.before.getTime());
    // preview clear uses the same 24mo text cut-off
    assert.equal(calls.previews.before.getTime(), calls.text.before.getTime());
    assert.ok(calls.ai.before.getTime() > calls.text.before.getTime());
    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0].action, 'crm.pdpa.purge_sweep');
    assert.equal(audit.entries[0].riskLevel, 'HIGH');
    assert.equal(audit.entries[0].companyId, undefined); // cross-company system sweep
  });

  it('does not audit when nothing was purged', async () => {
    const repo = {
      purgeExpiredMessageText: async () => 0,
      clearExpiredConversationPreviews: async () => 0,
      purgeExpiredMedia: async () => 0,
      purgeExpiredAiData: async () => ({ turns: 0, conversations: 0 }),
    } as any;
    const audit = makeAudit();
    const result = await new PurgeCrmPdpaUseCase(repo, audit, { aiDataRetentionDays: 90 } as any).execute();
    assert.deepEqual(result, { textPurged: 0, mediaPurged: 0, previewsCleared: 0, aiTurnsPurged: 0, aiConversationsPurged: 0 });
    assert.equal(audit.entries.length, 0);
  });
});

describe('EraseCrmCustomerUseCase', () => {
  function makeRepo(overrides: Partial<any> = {}) {
    const captured: any = {};
    return {
      captured,
      eraseCustomerData: async (input: any) => {
        captured.erase = input;
        return {
          customerId: 'cust-1', messagesRedacted: 5, mediaPurged: 1, conversations: 2,
          retainedFinanceAttachments: 2, auditLogId: 'audit-1', evidenceEventKey: 'erase:req-1',
        };
      },
      ...overrides,
    } as any;
  }

  it('passes atomic audit evidence into the erasure transaction and returns its id', async () => {
    const repo = makeRepo();
    const result = await new EraseCrmCustomerUseCase(repo).execute(ctx, 'cust-1', 'customer request');

    assert.equal(repo.captured.erase.erasedDisplayName, PDPA_ERASED_DISPLAY_NAME);
    assert.equal(repo.captured.erase.actorUserId, 'admin-1');
    assert.equal(repo.captured.erase.requestId, 'req-1');
    assert.equal(repo.captured.erase.reason, 'customer request');
    assert.deepEqual(result, { customerId: 'cust-1', messagesRedacted: 5, mediaPurged: 1, retainedFinanceAttachments: 2, auditLogId: 'audit-1' });
  });

  it('throws NotFound when the customer is not in the company', async () => {
    const repo = makeRepo({ eraseCustomerData: async () => { throw new Error('customer_not_found'); } });
    await assert.rejects(() => new EraseCrmCustomerUseCase(repo).execute(ctx, 'ghost'), /not found/i);
  });

  it('handles a customer with no conversations (PII-only scrub)', async () => {
    const repo = makeRepo({
      eraseCustomerData: async (input: any) => {
        repo.captured.erase = input;
        return {
          customerId: 'cust-1', messagesRedacted: 0, mediaPurged: 0, conversations: 0,
          retainedFinanceAttachments: 0, auditLogId: 'audit-1', evidenceEventKey: 'erase:req-1',
        };
      },
    });
    const result = await new EraseCrmCustomerUseCase(repo).execute(ctx, 'cust-1');
    assert.equal(result.mediaPurged, 0);
    assert.equal(repo.captured.erase.reason, undefined);
  });

  it('returns and audits the canonical target when the requested row was already merged', async () => {
    const repo = makeRepo({
      eraseCustomerData: async () => ({
        customerId: 'cust-primary', messagesRedacted: 3, mediaPurged: 0,
        conversations: 1, retainedFinanceAttachments: 0, auditLogId: 'audit-primary', evidenceEventKey: 'erase:req-1',
      }),
    });

    const result = await new EraseCrmCustomerUseCase(repo).execute(ctx, 'cust-secondary');

    assert.equal(result.customerId, 'cust-primary');
    assert.equal(result.auditLogId, 'audit-primary');
  });
});

describe('ProcessCrmErasureRequestsUseCase', () => {
  const requestCase = {
    id: 'case-1', companyId: 'co-1', customerId: 'cust-1', status: 'PROCESSING',
    requestedAt: new Date(), dueAt: new Date(), attemptCount: 1, notificationStatus: 'PENDING',
  };

  it('runs the canonical erase as CRM_CUSTOMER, notifies staff, and completes the durable case', async () => {
    const completed: any[] = [];
    let claimed = false;
    const selfService = {
      claimNextErasureCase: async () => claimed ? null : (claimed = true, requestCase),
      completeErasureCase: async (...args: any[]) => { completed.push(args); },
      failErasureCase: async () => assert.fail('must not fail'),
    } as any;
    const captured: any = {};
    const inbox = {
      eraseCustomerData: async (input: any) => {
        captured.erase = input;
        return {
          customerId: 'cust-1', messagesRedacted: 3, mediaPurged: 1, retainedFinanceAttachments: 2,
          auditLogId: 'audit-1',
        };
      },
    } as any;
    const prisma = { client: { companyMembership: { findMany: async () => [{ userId: 'owner-1' }] } } } as any;
    const notifications = { execute: async (input: any) => { captured.notification = input; } } as any;

    const result = await new ProcessCrmErasureRequestsUseCase(
      selfService, inbox, prisma, notifications, { log: async () => undefined } as any,
    ).execute();

    assert.deepEqual(result, { processed: 1, completed: 1, failed: 0 });
    assert.equal(captured.erase.actorType, 'CRM_CUSTOMER');
    assert.equal(captured.erase.actorRefId, 'cust-1');
    assert.equal(captured.erase.actorUserId, undefined);
    assert.deepEqual(captured.notification.recipientUserIds, ['owner-1']);
    assert.equal(completed[0][1], 'COMPLETED_WITH_EXCEPTION');
  });

  it('records retryable failure and stops claiming the same case in this pass', async () => {
    let claimed = false;
    const failed: any[] = [];
    const selfService = {
      claimNextErasureCase: async () => claimed ? null : (claimed = true, requestCase),
      failErasureCase: async (...args: any[]) => { failed.push(args); },
    } as any;
    const useCase = new ProcessCrmErasureRequestsUseCase(
      selfService,
      { eraseCustomerData: async () => { throw new Error('provider_unavailable'); } } as any,
      {} as any,
      {} as any,
      { log: async (input: any) => { failed.push(input); } } as any,
    );
    assert.deepEqual(await useCase.execute(), { processed: 1, completed: 0, failed: 0 });
    assert.equal(failed[0][0], 'case-1');
    assert.equal(failed[0][2], 'provider_unavailable');
    assert.equal(failed[1].action, 'crm.pdpa.erasure.failed');
    assert.equal(failed[1].riskLevel, 'HIGH');
  });

  it('requeues completed tombstones after a restore and re-erases them idempotently', async () => {
    let claimed = false;
    let replayedAt: Date | undefined;
    const selfService = {
      requeueCompletedErasureCasesBefore: async (at: Date) => { replayedAt = at; return 1; },
      claimNextErasureCase: async () => claimed ? null : (claimed = true, requestCase),
      completeErasureCase: async () => undefined,
      failErasureCase: async () => assert.fail('must not fail'),
    } as any;
    const useCase = new ProcessCrmErasureRequestsUseCase(
      selfService,
      { eraseCustomerData: async () => ({
        customerId: 'cust-1', messagesRedacted: 0, mediaPurged: 0,
        retainedFinanceAttachments: 0, auditLogId: 'audit-replay',
      }) } as any,
      { client: { companyMembership: { findMany: async () => [{ userId: 'owner-1' }] } } } as any,
      { execute: async () => undefined } as any,
      { log: async () => undefined } as any,
    );
    const restoredSnapshotAt = new Date('2026-07-27T00:00:00.000Z');
    assert.deepEqual(await useCase.replayAfterRestore(restoredSnapshotAt), {
      requeued: 1, processed: 1, completed: 1, failed: 0,
    });
    assert.equal(replayedAt?.toISOString(), restoredSnapshotAt.toISOString());
  });
});

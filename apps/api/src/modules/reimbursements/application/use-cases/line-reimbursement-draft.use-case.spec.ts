import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { LineReimbursementDraftUseCase } from './line-reimbursement-draft.use-case';
import type { ReimbursementDraftActionOwner, ReimbursementDraftActionRecord } from '../../domain/models/reimbursement.model';

const actionId = '018fbad0-4d4e-7cc7-8e43-0123456789ac';
const taskId = '018fbad0-4d4e-7cc7-8e43-0123456789ab';
const owner: ReimbursementDraftActionOwner = { companyId: 'c1', actorUserId: 'u1', membershipId: 'm1', channel: 'line',
  channelKind: 'USER', messagingChannelId: 'oa1', chatKeyHash: 'a'.repeat(64), ownerEpoch: 2 };
const ctx = (permissions: string[]): RequestContext => ({ requestId: 'req1', authSubject: 'u1', authProvider: 'line', companyId: 'c1', userId: 'u1', membershipId: 'm1', roles: [], permissions, scopes: {} });
const config = { lineAiReimbursementDraftWriteEnabled: true, reimbursementWriteQuiesce: false, lineMessagingChannelId: 'oa1' } as any;
const sourceProof = { schemaVersion: 1, receipts: [{ fieldPath: 'requesterUserId', valueDigest: 'd'.repeat(64),
  proof: { kind: 'SERVER_DEFAULT', key: 'ACTOR_AS_REQUESTER' }, validatedAt: '2026-09-27T04:00:00.000Z' }] };

function collecting(): ReimbursementDraftActionRecord {
  const now = new Date('2026-09-27T04:00:00.000Z');
  return { ...owner, id: actionId, taskId, actionOrdinal: 1, intentKeyHash: 'b'.repeat(64), operation: 'CREATE', status: 'COLLECTING',
    previewRevision: 0, expiresAt: new Date(now.getTime() + 120_000), createdAt: now, updatedAt: now };
}

describe('LineReimbursementDraftUseCase', () => {
  it('previews through the reimbursement domain without financial mutation and replays an identical retry unchanged', async () => {
    let action = collecting();
    let previewSaves = 0;
    const repo = {
      isDraftActionOwnerCurrent: async () => true,
      findOrCreateDraftAction: async () => action,
      resolveCreateBranchId: async () => 'br1',
      assertReimbursementRequester: async () => ({ displayName: 'Owner' }),
      findPolicy: async () => null,
      resolveSourceLines: async (_company: string, _requester: string, _branch: string, _currency: string, lines: unknown) => lines,
      saveDraftActionPreview: async (input: any) => {
        previewSaves += 1;
        action = { ...action, status: 'PREVIEW', previewRevision: input.previewRevision, commandJson: input.commandJson,
          previewJson: input.previewJson, sourceProofJson: input.sourceProofJson, confirmationDigest: input.confirmationDigest,
          expiresAt: input.expiresAt, updatedAt: new Date(action.updatedAt.getTime() + 1) };
        return action;
      },
    } as any;
    const useCase = new LineReimbursementDraftUseCase(repo, { validate: async () => undefined } as any, config);
    const input = { ctx: ctx(['line.ai.query', 'ai.tool.invoke', 'reimbursement.create']), owner,
      key: { actionId, taskId, actionOrdinal: 1, operation: 'CREATE' as const }, operation: 'CREATE' as const,
      sourceProof, request: { reason: 'customer visit', branchId: 'br1', lines: [{ lineNo: 1,
        incurredDate: '2026-09-20', description: 'taxi', categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '120' }] } };
    const first = await useCase.preview(input, new Date('2026-09-27T04:00:00.000Z'));
    const second = await useCase.preview(input, new Date('2026-09-27T04:01:00.000Z'));
    assert.equal(first.status, 'preview'); assert.deepEqual(second, first);
    assert.equal(previewSaves, 1, 'retry neither bumps revision nor extends expiry');
    assert.equal((first as any).preview.after.amount, '120.0000');
    assert.equal((first as any).preview.after.lines[0].amount, '120.0000');
    assert.equal((repo as any).createRequest, undefined, 'preview has no financial write method');
  });

  it('keeps an APPLIED receipt readable while the writer flag is off, but still requires current read authority', async () => {
    const applied = { ...collecting(), status: 'APPLIED' as const, previewRevision: 1, requestId: actionId,
      confirmationDigest: 'c'.repeat(64), appliedAt: new Date(), appliedRequestUpdatedAt: new Date(),
      resultJson: { schemaVersion: 1, requestId: actionId, committedState: 'DRAFT' } };
    const request = { id: actionId, companyId: 'c1', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'Owner', reason: 'visit',
      categoryKey: 'travel', amount: '120.0000', currency: 'THB', incurredDate: new Date(), financeReviewStatus: 'NOT_REQUIRED', status: 'DRAFT',
      paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NOT_CHECKED', receiptRequirementStatus: 'REQUIRED', postingStatus: 'not_required',
      paymentTotalAmount: '0.0000', outstandingAmount: '120.0000', createdByUserId: 'u1', createdAt: new Date(), updatedAt: new Date() } as any;
    const repo = { findDraftAction: async () => applied, isDraftActionOwnerCurrent: async () => true, findRequestById: async () => request } as any;
    const useCase = new LineReimbursementDraftUseCase(repo, {} as any, { ...config, lineAiReimbursementDraftWriteEnabled: false } as any);
    const allowed = await useCase.confirm({ ctx: ctx(['reimbursement.read_own']), owner, actionId, previewRevision: 1, confirmationDigest: 'c'.repeat(64) });
    assert.equal(allowed.status, 'applied');
    assert.equal((allowed as any).receipt.currentState, 'DRAFT');
    assert.deepEqual(await useCase.replay(ctx([]), owner, actionId), { status: 'blocked', errorCode: 'forbidden' });
  });

  it('uses the existing preview limiter family without consuming or cancelling accepted action facts', async () => {
    const action = collecting();
    let writes = 0;
    const repo = { isDraftActionOwnerCurrent: async () => true, findOrCreateDraftAction: async () => action,
      saveDraftActionPreview: async () => { writes += 1; return null; } } as any;
    const useCase = new LineReimbursementDraftUseCase(repo, {} as any, config,
      { consume: async (...args: unknown[]) => {
        assert.deepEqual(args.slice(0, 4), ['line-draft-preview-user', 'c1:u1', 20, 300]);
        return { allowed: false };
      } } as any);
    const result = await useCase.preview({ ctx: ctx(['line.ai.query', 'ai.tool.invoke', 'reimbursement.create']), owner,
      key: { actionId, taskId, actionOrdinal: 1, operation: 'CREATE' }, operation: 'CREATE', sourceProof,
      request: { reason: 'visit', lines: [{ lineNo: 1, incurredDate: '2026-09-20', description: 'taxi', categoryKey: 'travel', amount: '10' }] } },
    new Date('2026-09-27T04:00:00.000Z'));
    assert.deepEqual(result, { status: 'blocked', errorCode: 'rate_limited', retryAfter: 300 });
    assert.equal(writes, 0); assert.equal(action.status, 'COLLECTING');
  });

  it('requires explicit cancellation before replacing another active financial action', async () => {
    const repo = { isDraftActionOwnerCurrent: async () => true,
      findOrCreateDraftAction: async () => { throw new (await import('@nestjs/common')).ConflictException('reimbursement_active_action_exists'); } } as any;
    const useCase = new LineReimbursementDraftUseCase(repo, {} as any, config);
    const result = await useCase.open(ctx(['line.ai.query', 'ai.tool.invoke', 'reimbursement.create']), owner,
      { actionId, taskId, actionOrdinal: 2, operation: 'CREATE' });
    assert.deepEqual(result, { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['activeAction'] });
  });
});

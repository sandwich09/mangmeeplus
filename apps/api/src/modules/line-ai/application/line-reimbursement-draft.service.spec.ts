import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReimbursementDraftService, parseLineReimbursementDraftControl } from './line-reimbursement-draft.service';

const actionId = '018fbad0-4d4e-7cc7-8e43-0123456789ac';
const digest = 'a'.repeat(64);
const owner = { companyId: 'c1', userId: 'u1', membershipId: 'm1', channel: 'line' as const,
  channelKind: 'USER' as const, messagingChannelId: 'oa1', chatKeyHash: 'b'.repeat(64) };
const ctx = { companyId: 'c1', userId: 'u1', membershipId: 'm1', permissions: [], requestId: 'r1' } as any;

describe('LineReimbursementDraftService', () => {
  it('parses only the exact postback control and never treats free text as confirmation', () => {
    const encoded = `action=reimbursement_draft_confirm&actionId=${actionId}&previewRevision=2&confirmationDigest=${digest}`;
    assert.deepEqual(parseLineReimbursementDraftControl(encoded), {
      action: 'reimbursement_draft_confirm', actionId, previewRevision: 2, confirmationDigest: digest,
    });
    assert.equal(parseLineReimbursementDraftControl('ยืนยัน'), null);
    assert.equal(parseLineReimbursementDraftControl(`${encoded}&requestId=injected`), null);
    assert.equal(parseLineReimbursementDraftControl(`${encoded}&previewRevision=3`), null);
  });

  it('requires a fully accepted delivery proof before calling the financial confirmer', async () => {
    let confirmed = 0;
    const drafts = {
      markLineDelivered: async () => false,
      confirm: async () => { confirmed += 1; return { status: 'applied', receipt: {} }; },
    } as any;
    const service = new LineReimbursementDraftService(drafts);
    const result = await service.confirm({ ctx, owner, ownerEpoch: 4, control: {
      action: 'reimbursement_draft_confirm', actionId, previewRevision: 1, confirmationDigest: digest,
    }, deliveryPlanId: 'plan-1' });
    assert.deepEqual(result, { status: 'blocked', errorCode: 'preview_not_fully_delivered' });
    assert.equal(confirmed, 0);
  });

  it('binds proposal and both cancellation paths to the server-supplied conversation epoch', async () => {
    const seen: any[] = [];
    const drafts = {
      collect: async (value: unknown) => { seen.push(value); return { status: 'needs_fields', actionId, fieldPaths: ['reason'], actionRevision: 0 }; },
      cancel: async (value: unknown) => { seen.push(value); return { status: 'cancelled', actionId }; },
      cancelCollection: async (value: unknown) => { seen.push(value); return { status: 'cancelled', actionId }; },
    } as any;
    const service = new LineReimbursementDraftService(drafts);
    await service.propose({ ctx, owner, ownerEpoch: 7, proposal: {
      status: 'needs_fields', key: { actionId, taskId: '018fbad0-4d4e-7cc7-8e43-0123456789ab', actionOrdinal: 1, operation: 'CREATE' },
      accepted: { reason: 'taxi' }, sourceProof: {}, fieldPaths: ['lines.0.amount'],
    } });
    await service.cancel({ ctx, owner, ownerEpoch: 7, control: {
      action: 'reimbursement_draft_cancel', actionId, previewRevision: 1, confirmationDigest: digest,
    } });
    await service.cancelCollection({ ctx, owner, ownerEpoch: 7, actionId });
    assert.equal(seen.length, 3);
    assert.equal(seen[0].owner.ownerEpoch, 7);
    assert.equal(seen[0].owner.actorUserId, 'u1');
    assert.equal(seen[1].owner.messagingChannelId, 'oa1');
    assert.equal(seen[2].owner.ownerEpoch, 7);
  });
});

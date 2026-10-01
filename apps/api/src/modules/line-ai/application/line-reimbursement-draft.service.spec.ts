import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReimbursementDraftService, parseLineReimbursementDraftControl } from './line-reimbursement-draft.service';
import { LineReimbursementDraftAdapterService } from './line-reimbursement-draft-adapter.service';

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

// NAT04 (2026-09-30): the bill list never reached the chat — re-checking a bill that cannot be claimed always
// failed, and that failure hid every claimable bill with it.
describe('LineReimbursementDraftAdapterService display options', () => {
  it('prints the claimable bills even when the options also hold bills that cannot be claimed', async () => {
    const source = (id: string, eligible: boolean) => ({ choiceId: id.repeat(64), kind: 'SOURCE', label: `bill-${id}`, revision: `rev-${id}`,
      details: { eligible }, raw: { expenseId: `expense-${id}`, branchId: 'branch', requesterUserId: 'u1' } });
    const options = { schemaVersion: 1, actionId, taskId: actionId, taskRevision: 0, operation: 'CREATE', revision: 'x',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), selected: {}, pages: {},
      choices: [source('a', true), source('b', false), source('c', true)] };
    const active = { id: actionId, taskId: actionId, status: 'COLLECTING',
      commandJson: { schemaVersion: 1, kind: 'COLLECTION', accepted: { schemaVersion: 1, options } } };
    const repo = { listReimbursementSources: async (_company: string, _branch: string, _user: string, _query: string, expenseId: string) =>
      [{ expenseId, eligible: expenseId !== 'expense-b', updatedAt: `rev-${expenseId.slice(-1)}` }] };
    const adapter = new LineReimbursementDraftAdapterService({} as any, repo as any, {} as any, {} as any, { active: async () => active } as any);
    const shown = await adapter.readDisplayOptions({ ctx, owner, ownerEpoch: 1, actionId });
    assert.deepEqual(shown?.choices.map(choice => choice.label), ['bill-a', 'bill-c']);
    assert.equal(shown?.choices.some(choice => 'raw' in choice), false);
  });
});

// Hotfix 2026-10-01: the default-branch pick stamped a fresh LINE receipt photo with the member's default branch,
// so naming another branch hid the photo and the claim could be saved without its receipt.
describe('LineReimbursementDraftAdapterService staged LINE photos', () => {
  it('lets an unused staged photo follow the branch the user names, never rewrites it in place, never moves a claimed one', async () => {
    const updatedAt = new Date('2026-10-01T00:00:00.000Z');
    const branches = ['branch-a', 'branch-b'].map(id => ({ id, name: id, code: id, type: 'BRANCH', updatedAt }));
    const photos: Array<{ id: string; branchId: string | null }> = [{ id: 'photo-new', branchId: null }, { id: 'photo-claimed', branchId: 'branch-a' }];
    const matches = (photo: { id: string; branchId: string | null }, where: any) => (where.id?.in ?? [photo.id]).includes(photo.id)
      && ('branchId' in where ? photo.branchId === where.branchId
        : where.OR.some((item: any) => item.branchId === null ? photo.branchId === null : photo.branchId !== null && photo.branchId !== item.branchId.not));
    const writes: any[] = [], moved: string[] = [];
    const client = {
      branch: { findMany: async () => branches, findFirst: async ({ where }: any) => branches.find(row => row.id === where.id.equals) },
      companyMembership: { findUnique: async () => ({ defaultBranchId: 'branch-a' }) },
      attachmentObject: {
        findMany: async ({ where, select }: any) => photos.filter(photo => matches(photo, where)).map(photo => select.originalFileName
          ? { ...photo, originalFileName: photo.id, mimeType: 'image/jpeg', checksumSha256: photo.id, uploadedByUserId: 'u1', updatedAt } : { id: photo.id }),
        updateMany: async ({ where, data }: any) => {
          writes.push(where);
          const hit = photos.filter(photo => matches(photo, where));
          for (const photo of hit) { photo.branchId = data.branchId; moved.push(photo.id); }
          return { count: hit.length };
        },
      },
      reimbursementLine: { findMany: async ({ where }: any) => where.attachmentId.in.filter((id: string) => id === 'photo-claimed').map((attachmentId: string) => ({ attachmentId })) },
    };
    const repo = { listReimbursementRequesters: async () => [{ userId: 'u1', displayName: 'Me' }], listReimbursementSources: async () => [] };
    const adapter = new LineReimbursementDraftAdapterService({ client } as any, repo as any, {} as any, {} as any, {} as any);
    const build = (input: object, previous?: unknown) => (adapter as any).buildOptions({ ...ctx, scopes: {} },
      { actionId, taskId: actionId, actionOrdinal: 1, operation: 'CREATE' }, 0, { operation: 'CREATE', subrequestIndex: 0, ...input }, previous, undefined, { owner, epoch: 1 });
    const offered = (options: any) => options.choices.filter((choice: any) => choice.kind === 'ATTACHMENT').map((choice: any) => choice.label);

    const defaulted = await build({});
    assert.deepEqual(offered(defaulted), ['photo-new', 'photo-claimed']);
    const named = await build({ branchChoiceId: defaulted.choices.find((choice: any) => choice.kind === 'BRANCH' && choice.raw.id === 'branch-b').choiceId }, defaulted);
    assert.deepEqual(offered(named), ['photo-new'], 'the unused photo follows the branch the user names');
    await build({}, named);
    assert.deepEqual(moved, ['photo-new', 'photo-new'], 'a photo already on the chosen branch is not rewritten');
    assert.equal(photos[1]!.branchId, 'branch-a', 'a photo saved on a claim line never moves');
    for (const { OR: _or, branchId: _branchId, id: _id, ...guards } of writes) assert.deepEqual(guards, { companyId: 'c1', uploadedByUserId: 'u1', status: 'ACTIVE',
      AND: [{ metadataJson: { path: ['lineReimbursementOwner'], equals: owner } }, { metadataJson: { path: ['lineReimbursementEpoch'], equals: 1 } }],
      links: { none: {} }, captureFiles: { none: {} } });
  });
});

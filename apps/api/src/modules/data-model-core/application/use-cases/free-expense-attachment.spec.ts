import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateUploadIntentUseCase } from './create-upload-intent.use-case';
import { CreateDownloadUrlUseCase } from './create-download-url.use-case';

function fixture() {
  const ctx = { companyId: 'co', userId: 'u', membershipId: 'm', requestId: 'req', roles: [], scopes: {}, authProvider: 'watchdog',
    permissions: ['attachment.create', 'attachment.read', 'expense.receipt.upload', 'expense.read_own'] } as any;
  const state = { owner: 'u', status: 'DRAFT', branchId: null, linked: false, used: 0, pending: 0, writes: [] as any[], signed: 0 };
  const db = {
    company: { findUnique: async () => ({ status: 'DISABLED', disabledAt: new Date(0), archivedAt: null,
      planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), termDisabledAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null } }) },
    auditLog: { findFirst: async () => ({ actorUserId: null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } }) },
    billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
    packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
    expenseRecord: { findFirst: async ({ where }: any) => where.companyId === 'co' && where.id === 'ex' ? ({ id: 'ex', createdByUserId: state.owner, branchId: state.branchId, status: state.status, captureSource: 'WEB_UPLOAD' }) : null },
    companyMembership: { findFirst: async () => ({ branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [] }) },
    companyOcrUsageEvent: { findMany: async () => Array.from({ length: state.used }, () => ({ succeededAt: new Date() })) }, attachmentObject: { count: async () => state.pending },
    attachmentLink: { findFirst: async () => state.linked ? { targetId: 'ex' } : null }, expenseCaptureFile: { findFirst: async () => null },
  } as any;
  const repo = { commercialAccessDb: db, sumPendingBytes: async () => 0,
    createPending: async (input: any) => { state.writes.push(input); return { id: 'attachment' }; },
    findById: async () => ({ id: 'attachment', companyId: 'co', status: 'ACTIVE', uploadedByUserId: 'u', branchId: state.branchId, metadataJson: {}, bucket: 'b', objectKey: 'key', mimeType: 'application/pdf', originalFileName: 'file.pdf' }),
    isDisbursementVoucherFile: async () => false, isReimbursementPaymentSlip: async () => false,
    isSubstituteRawSignature: async () => false, findSignatureAssetOwner: async () => null } as any;
  const storage = { createUploadIntent: async (input: any) => { state.signed++; return { ...input, bucket: 'b', storageProvider: 'local', uploadUrl: 'signed', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() }; },
    createDownloadUrl: async () => { state.signed++; return { url: 'signed', expiresAt: new Date() }; } } as any;
  const audit = { log: async () => undefined } as any;
  const upload = new CreateUploadIntentUseCase(repo, storage, audit, { uploadMaxBytes: 100000, uploadPendingMaxBytesPerCompany: 100000, signedUrlTtlSeconds: 300 } as any);
  const download = new CreateDownloadUrlUseCase(repo, storage, audit);
  const cmd = { originalFileName: 'file.pdf', mimeType: 'application/pdf', byteSize: 100, metadataJson: { expenseReceiptExpenseId: 'ex', freeExpenseSource: { kind: 'EXPENSE', id: 'forged' } } };
  return { ctx, state, upload, download, cmd };
}

describe('free attachment source custody', () => {
  it('derives provenance from an owned mutable source instead of accepting client metadata', async () => {
    const { ctx, state, upload, cmd } = fixture();
    await upload.execute(ctx, cmd);
    assert.deepEqual(state.writes[0].metadataJson.freeExpenseSource, { kind: 'EXPENSE', id: 'ex' });
    assert.equal(state.writes[0].metadataJson.lineReceiptExpenseId, 'ex');
    assert.equal(state.writes[0].visibility, 'INTERNAL');
  });
  it('rejects unknown, foreign, final-state or unbound upload sources before signing', async () => {
    for (const kind of ['unknown', 'foreign', 'confirmed', 'unbound']) {
      const { ctx, state, upload, cmd } = fixture();
      if (kind === 'unknown') cmd.metadataJson.expenseReceiptExpenseId = 'foreign-company-ex';
      if (kind === 'foreign') state.owner = 'other';
      if (kind === 'confirmed') state.status = 'CONFIRMED';
      if (kind === 'unbound') cmd.metadataJson = {} as any;
      await assert.rejects(() => upload.execute(ctx, cmd));
      assert.equal(state.signed, 0); assert.equal(state.writes.length, 0);
    }
  });
  it('rejects exhausted allowance and bounded pending intake without claiming files were saved', async () => {
    for (const kind of ['used', 'pending'] as const) {
      const { ctx, state, upload, cmd } = fixture(); state[kind] = 3;
      await assert.rejects(() => upload.execute(ctx, cmd), (error: any) => error.getResponse().code === (kind === 'used' ? 'FREE_DOCUMENT_LIMIT_REACHED' : 'FREE_DOCUMENTS_IN_FLIGHT'));
      assert.equal(state.signed, 0); assert.equal(state.writes.length, 0);
    }
  });
  it('downloads only source-bound evidence with current source ownership and state', async () => {
    const { ctx, state, download } = fixture();
    await assert.rejects(() => download.execute(ctx, { attachmentId: 'attachment' }));
    assert.equal(state.signed, 0);
    state.linked = true;
    assert.equal((await download.execute(ctx, { attachmentId: 'attachment' })).downloadUrl, 'signed');
    state.owner = 'other';
    await assert.rejects(() => download.execute(ctx, { attachmentId: 'attachment' }));
    state.owner = 'u'; state.status = 'CONFIRMED';
    await assert.rejects(() => download.execute(ctx, { attachmentId: 'attachment' }));
    assert.equal(state.signed, 1);
  });
});

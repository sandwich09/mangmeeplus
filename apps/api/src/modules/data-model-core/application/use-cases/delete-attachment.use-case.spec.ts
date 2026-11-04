import { freeExpenseDraftPermissions } from '../../../system-partner-management/application/free-expense-access';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { DeleteAttachmentUseCase } from './delete-attachment.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'sub-1', userId: 'user-1', companyId: 'co-1', membershipId: 'member-1',
  roles: [], permissions: ['attachment.delete'], scopes: {}, authProvider: 'dev',
};

const attachment = {
  id: 'att-1', companyId: 'co-1', storageProvider: 'db', bucket: 'attachments', objectKey: 'att-1',
  originalFileName: 'evidence.html', mimeType: 'text/html', byteSize: 100, visibility: 'ACCOUNTING',
  status: 'ACTIVE', uploadedByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(),
};

function makeUseCase(retentionHold: 'SUBSTITUTE_ARTIFACT' | 'SUBSTITUTE_SOURCE' | null, paymentSlip = false) {
  const attachments = {
    findById: mock.fn(async () => attachment),
    findSubstituteEvidenceRetentionHold: mock.fn(async () => retentionHold),
    isReimbursementPaymentSlip: mock.fn(async () => paymentSlip),
    isDisbursementVoucherFile: mock.fn(async () => false),
    markDeleted: mock.fn(async () => ({ ...attachment, status: 'DELETED' })),
  };
  const audit = { log: mock.fn(async () => {}) };
  return { useCase: new DeleteAttachmentUseCase(attachments as any, audit as any), attachments, audit };
}

describe('DeleteAttachmentUseCase substitute-evidence retention', () => {
  it('refuses both document file kinds on the general delete route', async () => {
    const { useCase, attachments } = makeUseCase(null);
    attachments.isDisbursementVoucherFile = mock.fn(async () => true);
    await assert.rejects(() => useCase.execute(ctx, { attachmentId: 'att-1' }), (e: any) => e.getResponse().code === 'disbursement_file_retained');
    assert.equal(attachments.markDeleted.mock.calls.length, 0);
  });
  it('rejects deletion of an issued artifact and records the denied mutation', async () => {
    const { useCase, attachments, audit } = makeUseCase('SUBSTITUTE_ARTIFACT');

    await assert.rejects(
      () => useCase.execute(ctx, { attachmentId: 'att-1' }),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
    );
    assert.equal((attachments.markDeleted.mock.calls as any[]).length, 0);
    assert.equal((audit.log.mock.calls as any[])[0]?.arguments[0].result, 'DENIED');
  });

  it('rejects deletion of original/supporting evidence', async () => {
    const { useCase, attachments } = makeUseCase('SUBSTITUTE_SOURCE');

    await assert.rejects(() => useCase.execute(ctx, { attachmentId: 'att-1' }), ConflictException);
    assert.equal((attachments.markDeleted.mock.calls as any[]).length, 0);
  });

  it('keeps normal attachment deletion unchanged when there is no retention hold', async () => {
    const { useCase, attachments } = makeUseCase(null);

    const result = await useCase.execute(ctx, { attachmentId: 'att-1' });
    assert.equal(result.status, 'DELETED');
    assert.equal((attachments.markDeleted.mock.calls as any[]).length, 1);
  });
});

// Spec §12.5: payment evidence is add-only. The claim page has no remove control, and the one
// generic way to delete a file must not be a way around that.
describe('DeleteAttachmentUseCase reimbursement payment slips', () => {
  it('refuses to delete a file that is a payment slip and records the denied attempt', async () => {
    const { useCase, attachments, audit } = makeUseCase(null, true);

    await assert.rejects(
      () => useCase.execute(ctx, { attachmentId: 'att-1' }),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'reimbursement_payment_slip_retained',
    );
    assert.equal((attachments.markDeleted.mock.calls as any[]).length, 0);
    assert.deepEqual((attachments.isReimbursementPaymentSlip.mock.calls as any[])[0]?.arguments[0], { id: 'att-1', companyId: 'co-1' });
    const denied = (audit.log.mock.calls as any[]).map((call) => call.arguments[0]);
    assert.deepEqual(denied.map((entry) => [entry.result, entry.riskLevel, entry.metadataJson]), [
      ['DENIED', 'HIGH', { reason: 'reimbursement_payment_slip_retained' }],
    ]);
  });
});

it('WHT-OUTSIDE-2 generic deletion cannot erase external certificate history files', async () => {
  const h = makeUseCase(null);
  h.attachments.findById = mock.fn(async () => ({ ...attachment, metadataJson: { generatedFor: 'wht.external_certificate' } }));
  await assert.rejects(() => h.useCase.execute(ctx, { attachmentId: 'att-1' }), (error: any) => error.getResponse().code === 'wht_external_file_retained');
  assert.equal(h.attachments.markDeleted.mock.callCount(), 0);
});


it('R2 delete checks branch before retention and mutation', async () => {
  for (const retention of [null, 'SUBSTITUTE_SOURCE', 'WHT'] as const) {
    const h = makeUseCase(retention === 'WHT' ? null : retention);
    h.attachments.findById = mock.fn(async () => ({ ...attachment, branchId: 'branch-b', ...(retention === 'WHT' ? { metadataJson: { generatedFor: 'wht.external_certificate' } } : {}) }));
    await assert.rejects(() => h.useCase.execute({ ...ctx, scopes: { branchIds: ['branch-a'] } }, { attachmentId: 'att-1' }),
      (error: any) => error.getStatus() === 403);
    for (const spy of [h.attachments.findSubstituteEvidenceRetentionHold, h.attachments.isDisbursementVoucherFile,
      h.attachments.isReimbursementPaymentSlip, h.attachments.markDeleted]) assert.equal(spy.mock.callCount(), 0);
    assert.equal((h.audit.log.mock.calls as any[])[0]?.arguments[0]?.result, 'DENIED');
    assert.equal((h.audit.log.mock.calls as any[])[0]?.arguments[0]?.metadataJson, undefined);
  }
  for (const branchId of ['branch-a', undefined]) {
    const h = makeUseCase(null);
    h.attachments.findById = mock.fn(async () => ({ ...attachment, branchId, uploadedByUserId: 'another-uploader' }));
    assert.equal((await h.useCase.execute({ ...ctx, scopes: { branchIds: ['branch-a'] } }, { attachmentId: 'att-1' })).status, 'DELETED');
  }
  const free = makeUseCase(null);
  await assert.rejects(() => free.useCase.execute({ ...ctx, freeExpenseDrafts: true,
    permissions: freeExpenseDraftPermissions(ctx.permissions) }, { attachmentId: 'att-1' }), (error: any) => error.getStatus() === 403);
  assert.equal(free.attachments.findById.mock.callCount(), 0);
  assert.equal(free.attachments.markDeleted.mock.callCount(), 0);
  const missing = makeUseCase(null);
  missing.attachments.findById = mock.fn(async () => null as any);
  await assert.rejects(() => missing.useCase.execute({ ...ctx, companyId: 'other-company' }, { attachmentId: 'att-1' }), (error: any) => error.getStatus() === 404);
});

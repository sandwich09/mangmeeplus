import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreateDownloadUrlUseCase } from './create-download-url.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import type { AttachmentRecord } from '../../domain/models/attachment.model';

const makeCtx = (permissions: string[] = []): RequestContext => ({
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: [],
  permissions,
  scopes: {},
  authProvider: 'dev',
});

const makeAttachment = (status: AttachmentRecord['status'] = 'ACTIVE'): AttachmentRecord => ({
  id: 'att-1', companyId: 'co-1', storageProvider: 'local', bucket: 'local-attachments',
  objectKey: 'co-1/123_file.pdf', objectVersionId: 'version-1', originalFileName: 'file.pdf', mimeType: 'application/pdf',
  byteSize: 1024, visibility: 'INTERNAL', status, uploadedByUserId: 'user-1',
  createdAt: new Date(), updatedAt: new Date(),
});

const makeRepo = (record: AttachmentRecord | null = makeAttachment()) => ({
  findById: mock.fn(async () => record),
  isSubstituteRawSignature: mock.fn(async () => false),
  isReimbursementPaymentSlip: mock.fn(async () => false),
  isDisbursementVoucherFile: mock.fn(async () => false),
  findSignatureAssetOwner: mock.fn(async (): Promise<{ ownerUserId: string | null } | null> => null),
  createPending: mock.fn(async () => { throw new Error('not used'); }),
  markActive: mock.fn(async () => { throw new Error('not used'); }),
  markDeleted: mock.fn(async () => { throw new Error('not used'); }),
  linkToTarget: mock.fn(async () => { throw new Error('not used'); }),
});

const makeStorage = () => ({
  createDownloadUrl: mock.fn(async () => ({
    url: '/local-storage/download/opaque-token',
    expiresAt: new Date(Date.now() + 900_000),
  })),
  createUploadIntent: mock.fn(async () => { throw new Error('not used'); }),
  getObjectMetadata: mock.fn(async () => ({ byteSize: 0, exists: true })),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

describe('CreateDownloadUrlUseCase', () => {
  it('refuses both document file kinds on the general route, including an unlinked slip upload', async () => {
    for (const metadataJson of [{ generatedFor: 'disbursement_voucher_slip' }, { generatedBy: 'disbursement_voucher' }, undefined]) {
      const repo = makeRepo({ ...makeAttachment(), metadataJson });
      repo.isDisbursementVoucherFile = mock.fn(async () => metadataJson === undefined);
      const storage = makeStorage();
      await assert.rejects(() => new CreateDownloadUrlUseCase(repo as any, storage as any, makeAudit() as any).execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }),
        (e: any) => e.getResponse().code === 'disbursement_file_general_download_denied');
      assert.equal(storage.createDownloadUrl.mock.calls.length, 0);
    }
  });
  it('throws ForbiddenException when ctx lacks attachment.read', async () => {
    const storage = makeStorage();
    const uc = new CreateDownloadUrlUseCase(makeRepo() as any, storage as any, makeAudit() as any);
    await assert.rejects(() => uc.execute(makeCtx([]), { attachmentId: 'att-1' }), ForbiddenException);
  });

  it('throws NotFoundException when attachment does not exist', async () => {
    const uc = new CreateDownloadUrlUseCase(makeRepo(null) as any, makeStorage() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }),
      NotFoundException,
    );
  });

  it('throws ForbiddenException when attachment is DELETED', async () => {
    const uc = new CreateDownloadUrlUseCase(
      makeRepo(makeAttachment('DELETED')) as any,
      makeStorage() as any,
      makeAudit() as any,
    );
    await assert.rejects(
      () => uc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }),
      ForbiddenException,
    );
  });

  it('blocks cross-branch downloads and raw substitute signatures', async () => {
    const branchRecord = { ...makeAttachment(), branchId: 'b-2' };
    const branchRepo = makeRepo(branchRecord);
    const branchUc = new CreateDownloadUrlUseCase(branchRepo as any, makeStorage() as any, makeAudit() as any);
    await assert.rejects(
      () => branchUc.execute({ ...makeCtx(['attachment.read']), scopes: { branchIds: ['b-1'] } }, { attachmentId: 'att-1' }),
      ForbiddenException,
    );

    const signatureRepo = makeRepo();
    signatureRepo.isSubstituteRawSignature = mock.fn(async () => true);
    const signatureUc = new CreateDownloadUrlUseCase(signatureRepo as any, makeStorage() as any, makeAudit() as any);
    await assert.rejects(
      () => signatureUc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }),
      ForbiddenException,
    );
  });

  /**
   * The two-call attack the personal-signature model has to close: a housekeeping holder lists
   * signatures, lifts an attachment id off somebody else's row, and asks the generic download
   * endpoint for it. `isSubstituteRawSignature` above only matches images a certificate already
   * RECORDED, so a library asset used to sail straight through — HTTP 200, valid PNG — for every
   * stock role that holds `expense.signature.manage`, all of which also hold `attachment.read`.
   */
  it('refuses another person’s signature image and still serves the owner their own', async () => {
    const theirs = makeRepo();
    theirs.findSignatureAssetOwner = mock.fn(async () => ({ ownerUserId: 'someone-else' }));
    const audit = makeAudit();
    const storage = makeStorage();
    const attacker = new CreateDownloadUrlUseCase(theirs as any, storage as any, audit as any);
    await assert.rejects(
      // `attachment.read` plus housekeeping is the DEFAULT owner/admin/finance persona, not a
      // contrived one — which is exactly why the id must not be reachable.
      () => attacker.execute(makeCtx(['attachment.read', 'expense.signature.manage']), { attachmentId: 'att-1' }),
      ForbiddenException,
    );
    assert.equal(storage.createDownloadUrl.mock.calls.length, 0, 'no URL is ever minted');
    const denied = (audit.log.mock.calls as any[]).map((call) => call.arguments[0]).find((entry) => entry.result === 'DENIED');
    assert.equal(denied?.metadataJson?.reason, 'personal_signature_not_owned');

    // The person whose signature it is keeps every legitimate self-download.
    const mine = makeRepo();
    mine.findSignatureAssetOwner = mock.fn(async () => ({ ownerUserId: 'user-1' }));
    const owner = new CreateDownloadUrlUseCase(mine as any, makeStorage() as any, makeAudit() as any);
    const result = await owner.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' });
    assert.ok(result.downloadUrl.startsWith('/local-storage/download/'));

    // A link that outlived its asset row resolves to nobody, which must fail closed, not open.
    const orphaned = makeRepo();
    orphaned.findSignatureAssetOwner = mock.fn(async () => ({ ownerUserId: null }));
    const orphanUc = new CreateDownloadUrlUseCase(orphaned as any, makeStorage() as any, makeAudit() as any);
    await assert.rejects(
      () => orphanUc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }),
      ForbiddenException,
    );
  });

  /**
   * A reimbursement payment slip is opened through its claim, where the readers are decided per
   * claim (owner decision 2026-10-01). Every reader of a claim holds `attachment.read` and can see
   * the slip's attachment id in the claim detail, so this generic path must serve it to nobody —
   * including the people the slip endpoint would serve.
   */
  it('never serves a reimbursement payment slip, linked to a payment or still only uploaded as one', async () => {
    const linked = makeRepo();
    linked.isReimbursementPaymentSlip = mock.fn(async () => true);
    const uploadedOnly = makeRepo({ ...makeAttachment(), metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-1' } });
    for (const repo of [linked, uploadedOnly]) {
      const storage = makeStorage();
      const audit = makeAudit();
      const uc = new CreateDownloadUrlUseCase(repo as any, storage as any, audit as any);
      await assert.rejects(
        // The uploader, with every attachment and reimbursement right: still refused here.
        () => uc.execute(makeCtx(['attachment.read', 'reimbursement.read', 'reimbursement.payment.record', 'reimbursement.finance_review']), { attachmentId: 'att-1' }),
        ForbiddenException,
      );
      assert.equal(storage.createDownloadUrl.mock.calls.length, 0, 'no URL is ever minted');
      const denied = (audit.log.mock.calls as any[]).map((call) => call.arguments[0]).find((entry) => entry.result === 'DENIED');
      assert.equal(denied?.metadataJson?.reason, 'reimbursement_payment_slip');
    }
    assert.deepEqual((linked.isReimbursementPaymentSlip.mock.calls as any[])[0]?.arguments[0], { id: 'att-1', companyId: 'co-1' });

    // Narrow on purpose: a file tagged for something else, and every ordinary file, is served as before.
    const signatureTagged = makeRepo({ ...makeAttachment(), metadataJson: { generatedFor: 'reimbursement_claim_signature' } });
    const served = await new CreateDownloadUrlUseCase(signatureTagged as any, makeStorage() as any, makeAudit() as any)
      .execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' });
    assert.ok(served.downloadUrl);
  });

  it('returns downloadUrl (not objectKey) on success', async () => {
    const storage = makeStorage();
    const uc = new CreateDownloadUrlUseCase(makeRepo() as any, storage as any, makeAudit() as any);
    const result = await uc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' });
    assert.ok(result.downloadUrl.startsWith('/local-storage/download/'));
    assert.equal(result.downloadUrl.includes('co-1/123_file.pdf'), false);
    assert.equal('objectKey' in result, false);
    assert.ok(result.expiresAt instanceof Date);
    assert.equal((storage.createDownloadUrl.mock.calls as any[])[0]?.arguments[0].objectVersionId, 'version-1');
    // Download stays the default: no caller that omits it can be turned into a preview link.
    assert.equal('disposition' in (storage.createDownloadUrl.mock.calls as any[])[0]?.arguments[0], false);
  });

  // BUG-4: previews are <img> loads, which Chrome's ORB refuses against an attachment response.
  // The mime-type gate lives in the storage layer; the use case only carries the ask.
  it('passes an inline preview ask through to storage', async () => {
    const storage = makeStorage();
    const uc = new CreateDownloadUrlUseCase(makeRepo() as any, storage as any, makeAudit() as any);
    await uc.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1', disposition: 'inline' });
    assert.equal((storage.createDownloadUrl.mock.calls as any[])[0]?.arguments[0].disposition, 'inline');
  });
});

describe('attachment bytes for evidence bundles', () => {
  it('uses the single-download permission, tenant, branch, privacy and clean-state checks without minting a URL', async () => {
    const repo = makeRepo();
    const storage = { ...makeStorage(), getObject: mock.fn(async () => ({ bytes: Buffer.from('file') })) };
    const useCase = new CreateDownloadUrlUseCase(repo as any, storage as any, makeAudit() as any);
    const reader = makeCtx(['attachment.read']);
    assert.equal((await useCase.readBytes(reader, { attachmentId: 'att-1' })).toString(), 'file');
    assert.deepEqual(repo.findById.mock.calls[0]!.arguments, [{ id: 'att-1', companyId: 'co-1' }]);
    assert.deepEqual(storage.getObject.mock.calls[0]!.arguments, [{ bucket: 'local-attachments', objectKey: 'co-1/123_file.pdf', objectVersionId: 'version-1' }]);
    assert.equal(storage.createDownloadUrl.mock.callCount(), 0);
    await assert.rejects(() => useCase.readBytes(makeCtx(), { attachmentId: 'att-1' }), ForbiddenException);
    for (const status of ['PENDING_UPLOAD', 'QUARANTINED', 'DELETED'] as const) {
      await assert.rejects(() => new CreateDownloadUrlUseCase(makeRepo(makeAttachment(status)) as any, storage as any, makeAudit() as any).readBytes(reader, { attachmentId: 'att-1' }), ForbiddenException);
    }
    await assert.rejects(() => new CreateDownloadUrlUseCase(makeRepo(null) as any, storage as any, makeAudit() as any).readBytes(reader, { attachmentId: 'missing' }), NotFoundException);
    await assert.rejects(() => new CreateDownloadUrlUseCase(makeRepo({ ...makeAttachment(), branchId: 'other' }) as any, storage as any, makeAudit() as any).readBytes({ ...reader, scopes: { branchIds: ['mine'] } }, { attachmentId: 'att-1' }), ForbiddenException);
    repo.isSubstituteRawSignature.mock.mockImplementation(async () => true);
    await assert.rejects(() => useCase.readBytes(reader, { attachmentId: 'att-1' }), ForbiddenException);
    assert.equal(storage.getObject.mock.callCount(), 1, 'every refusal occurs before object storage');
  });
});

it('WHT-OUTSIDE-2 generic downloads never bypass the external certificate handoff boundary', async () => {
  const storage = makeStorage();
  const repo = makeRepo({ ...makeAttachment(), metadataJson: { generatedFor: 'wht.external_certificate' } });
  const useCase = new CreateDownloadUrlUseCase(repo as any, storage as any, makeAudit() as any);
  await assert.rejects(() => useCase.execute(makeCtx(['attachment.read']), { attachmentId: 'att-1' }), (error: any) => error.getResponse().code === 'wht_external_file_read_denied');
  assert.equal(storage.createDownloadUrl.mock.callCount(), 0);
});

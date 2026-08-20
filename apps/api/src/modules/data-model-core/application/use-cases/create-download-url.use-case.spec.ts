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

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CompleteAttachmentUploadUseCase, computeImagePerceptualHash } from './complete-attachment-upload.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import type { AttachmentRecord } from '../../domain/models/attachment.model';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: [],
  permissions: ['attachment.create'],
  scopes: {},
  authProvider: 'dev',
};

const attachment: AttachmentRecord = {
  id: 'att-1',
  companyId: 'co-1',
  storageProvider: 'local',
  bucket: 'local-attachments',
  objectKey: 'co-1/123_file.pdf',
  originalFileName: 'file.pdf',
  mimeType: 'application/pdf',
  byteSize: 1024,
  visibility: 'INTERNAL',
  status: 'PENDING_UPLOAD',
  uploadedByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeRepo = () => ({
  findById: mock.fn(async () => attachment),
  markActive: mock.fn(async (input: any) => ({
    ...attachment,
    objectKey: input.objectKey,
    objectVersionId: input.objectVersionId,
    checksumSha256: input.checksumSha256,
    status: 'ACTIVE',
    uploadedAt: new Date(),
  })),
  markQuarantined: mock.fn(async () => undefined),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });
const makeLogger = () => ({ warn: mock.fn() });
const makeCleanup = () => ({ enqueue: mock.fn(async () => true) });
const cleanScanner = { assertClean: mock.fn(async () => undefined) };
const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 - 9)]);
const checksumSha256 = createHash('sha256').update(bytes).digest('hex');

const makeStorage = (overrides: Record<string, unknown> = {}) => ({
  getObjectMetadata: mock.fn(async () => ({
    exists: true,
    byteSize: 1024,
    mimeType: 'application/pdf',
    objectVersionId: 'pending-version-1',
  })),
  getObject: mock.fn(async () => ({ bytes, mimeType: 'application/pdf' })),
  putObject: mock.fn(async (input: any) => ({
    bucket: 'local-attachments',
    objectKey: input.objectKey,
    storageProvider: 'local',
    byteSize: input.bytes.byteLength,
    checksumSha256,
    objectVersionId: checksumSha256,
  })),
  deleteObject: mock.fn(async () => undefined),
  ...overrides,
});

describe('CompleteAttachmentUploadUseCase', () => {
  it('keeps a close perceptual hash when the same pixels are re-encoded by LINE', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        raw[offset] = x * 4;
        raw[offset + 1] = y * 4;
        raw[offset + 2] = (x + y) * 2;
      }
    }
    const image = sharp(raw, { raw: { width, height, channels: 3 } });
    const png = await image.clone().png().toBuffer();
    const jpeg = await image.clone().jpeg({ quality: 65 }).toBuffer();
    const pngHash = await computeImagePerceptualHash(png, 'image/png');
    const jpegHash = await computeImagePerceptualHash(jpeg, 'image/jpeg');

    assert.match(pngHash ?? '', /^[0-9a-f]{16}$/);
    assert.match(jpegHash ?? '', /^[0-9a-f]{16}$/);
    let bits = BigInt(`0x${pngHash}`) ^ BigInt(`0x${jpegHash}`);
    let distance = 0;
    while (bits > 0n) {
      bits &= bits - 1n;
      distance += 1;
    }
    assert.ok(distance <= 6, `expected re-encoded image distance <= 6, got ${distance}`);
  });

  it('rejects completion when storage object is missing', async () => {
    const storage = makeStorage({ getObjectMetadata: mock.fn(async () => ({ exists: false, byteSize: 0 })) });
    const uc = new CompleteAttachmentUploadUseCase(makeRepo() as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any, makeCleanup() as any);
    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), BadRequestException);
  });

  it('rejects completion when storage byte size mismatches expected metadata', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const logger = makeLogger();
    const storage = makeStorage({ getObjectMetadata: mock.fn(async () => ({ exists: true, byteSize: 2048 })) });
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, audit as any, cleanScanner as any, logger as any, makeCleanup() as any);
    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), BadRequestException);
    assert.equal(repo.markQuarantined.mock.callCount(), 1);
    const rejectionAudit = (audit.log.mock.calls as any[])[0]?.arguments[0];
    assert.equal(rejectionAudit.action, 'attachment.upload.rejected');
    assert.equal(rejectionAudit.riskLevel, 'HIGH');
    assert.deepEqual(logger.warn.mock.calls[0]?.arguments, [{
      msg: 'attachment.upload.rejected',
      riskLevel: 'HIGH',
      companyId: 'co-1',
      attachmentId: 'att-1',
      actorUserId: 'user-1',
      requestId: 'req-1',
    }]);
  });

  it('hashes provider bytes, writes an immutable final key, and pins its object version', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any, makeCleanup() as any);
    const result = await uc.execute(ctx, {
      attachmentId: 'att-1',
      checksumSha256: '0'.repeat(64),
      byteSize: 1,
    });
    assert.equal(result.status, 'ACTIVE');
    assert.equal(result.checksumSha256, checksumSha256);
    assert.equal(result.objectVersionId, checksumSha256);
    const getInput = (storage.getObject.mock.calls as any[])[0]?.arguments[0];
    assert.equal(getInput.objectVersionId, 'pending-version-1');
    const activeInput = (repo.markActive.mock.calls as any[])[0]?.arguments[0];
    assert.match(activeInput.objectKey, new RegExp(`^evidence/co-1/${checksumSha256}/`));
    assert.equal(activeInput.checksumSha256, checksumSha256);
    assert.equal(activeInput.byteSize, 1024);
    assert.equal((repo.markActive.mock.calls as any[]).length, 1);
  });

  it('quarantines when the provider checksum does not match the bytes read by the server', async () => {
    const repo = makeRepo();
    const storage = makeStorage({
      getObjectMetadata: mock.fn(async () => ({
        exists: true,
        byteSize: 1024,
        mimeType: 'application/pdf',
        checksumSha256: 'f'.repeat(64),
        objectVersionId: 'pending-version-1',
      })),
    });
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any, makeCleanup() as any);

    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), /checksum/i);
    assert.equal(repo.markQuarantined.mock.callCount(), 1);
    assert.equal((storage.putObject as any).mock.callCount(), 0);
  });

  it('rejects reuse after an attachment has already become active', async () => {
    const repo = makeRepo();
    repo.findById = mock.fn(async () => ({ ...attachment, status: 'ACTIVE' }));
    const storage = makeStorage();
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any, makeCleanup() as any);

    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), BadRequestException);
    assert.equal((storage.getObjectMetadata as any).mock.callCount(), 0);
  });

  it('durably queues the exact final object version when activation fails and preserves the primary error', async () => {
    const primary = new Error('attachment activation lost race');
    const repo = makeRepo();
    repo.markActive = mock.fn(async () => { throw primary; });
    const storage = makeStorage();
    const cleanup = makeCleanup();
    const uc = new CompleteAttachmentUploadUseCase(
      repo as any,
      storage as any,
      makeAudit() as any,
      cleanScanner as any,
      makeLogger() as any,
      cleanup as any,
    );

    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), (error) => error === primary);
    const writtenPath = (storage.putObject.mock.calls as any[])[0].arguments[0].objectKey;
    assert.deepEqual((cleanup.enqueue.mock.calls as any[])[0]?.arguments[0], {
      companyId: 'co-1',
      bucket: 'local-attachments',
      objectPath: writtenPath,
      expectedVersion: checksumSha256,
      source: 'ATTACHMENT_FINALIZATION',
    });
    assert.equal(storage.deleteObject.mock.callCount(), 0, 'the API must not delete an S3 version directly');
  });
});


it('R1 only the in-scope uploader can complete', async () => {
  for (const freeExpenseDrafts of [false, true]) for (const status of ['PENDING_UPLOAD', 'ACTIVE'] as const) {
    for (const denied of [{ userId: 'other-user' }, { scopes: { branchIds: ['branch-b'] } }, { companyId: 'other-company' }, { permissions: [] }]) {
      const repo = makeRepo();
      repo.findById = mock.fn(async (input?: any) => input.companyId === attachment.companyId ? { ...attachment, branchId: 'branch-a', status } : null as any);
      const storage = makeStorage();
      const audit = makeAudit();
      const scanner = { assertClean: mock.fn(async () => {}) };
      const cleanup = makeCleanup();
      const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, audit as any, scanner as any, makeLogger() as any, cleanup as any);
      await assert.rejects(() => uc.execute({ ...ctx, freeExpenseDrafts, ...denied }, { attachmentId: attachment.id }),
        (error: any) => error.getStatus() === ('companyId' in denied ? 404 : 403));
      for (const spy of [storage.getObjectMetadata, storage.getObject, storage.putObject, repo.markActive, repo.markQuarantined, scanner.assertClean, cleanup.enqueue]) assert.equal(spy.mock.callCount(), 0);
      if (!('companyId' in denied)) assert.equal((audit.log.mock.calls as any[])[0]?.arguments[0].result, 'DENIED');
    }
  }
  for (const freeExpenseDrafts of [false, true]) for (const [branchId, scopes] of [['branch-a', { branchIds: ['branch-a'] }], [undefined, { branchIds: [] }], ['branch-b', undefined]] as const) {
    const repo = makeRepo();
    repo.findById = mock.fn(async () => ({ ...attachment, branchId }));
    const uc = new CompleteAttachmentUploadUseCase(repo as any, makeStorage() as any, makeAudit() as any, cleanScanner as any, makeLogger() as any, makeCleanup() as any);
    assert.equal((await uc.execute({ ...ctx, freeExpenseDrafts, scopes: scopes as any }, { attachmentId: attachment.id })).status, 'ACTIVE');
  }
});


it('R4 inspection failures have truthful severity', async () => {
  for (const freeExpenseDrafts of [false, true]) for (const scenario of ['uninspectable', 'embedded', 'active', 'scanner-unavailable', 'malware'] as const) {
    const content = Buffer.from('%PDF-1.7\n' + (scenario === 'embedded' ? '<< /Type /EmbeddedFile >>' : scenario === 'active' ? '<< /OpenAction /JavaScript >>' : scenario === 'uninspectable' ? '<< /J#61vaScript 1 >>' : '<< /Type /Catalog >>'));
    const repo = makeRepo();
    repo.findById = mock.fn(async () => ({ ...attachment, byteSize: content.length }));
    const storage = makeStorage({ getObjectMetadata: mock.fn(async () => ({ exists: true, byteSize: content.length })), getObject: mock.fn(async () => ({ bytes: content })) });
    const audit = makeAudit();
    const logger = makeLogger();
    const scanner = { assertClean: async () => {
      if (scenario === 'scanner-unavailable') throw new Error('scanner offline');
      if (scenario === 'malware') throw new Error('MALWARE_DETECTED');
    } };
    const useCase = new CompleteAttachmentUploadUseCase(repo as any, storage as any, audit as any, scanner as any, logger as any, makeCleanup() as any);
    await assert.rejects(() => useCase.execute({ ...ctx, freeExpenseDrafts }, { attachmentId: attachment.id }), (error: any) => {
      if (scenario === 'uninspectable' || scenario === 'scanner-unavailable') return error.getResponse().code === 'CONTENT_UNINSPECTABLE';
      if (scenario === 'embedded') return error.getResponse().code === 'EMBEDDED_FILE_REJECTED';
      return error.getStatus() === 400;
    });
    const high = scenario === 'active' || scenario === 'malware';
    assert.equal((audit.log.mock.calls as any[])[0].arguments[0].riskLevel, high ? 'HIGH' : 'MEDIUM');
    assert.equal(logger.warn.mock.callCount(), high ? 1 : 0);
    assert.equal(repo.markQuarantined.mock.callCount(), 1);
    assert.equal(repo.markActive.mock.callCount(), 0);
    assert.equal((storage.putObject as any).mock.callCount(), 0);
  }
});

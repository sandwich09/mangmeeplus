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
    const uc = new CompleteAttachmentUploadUseCase(makeRepo() as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any);
    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), BadRequestException);
  });

  it('rejects completion when storage byte size mismatches expected metadata', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const logger = makeLogger();
    const storage = makeStorage({ getObjectMetadata: mock.fn(async () => ({ exists: true, byteSize: 2048 })) });
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, audit as any, cleanScanner as any, logger as any);
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
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any);
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
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any);

    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), /checksum/i);
    assert.equal(repo.markQuarantined.mock.callCount(), 1);
    assert.equal((storage.putObject as any).mock.callCount(), 0);
  });

  it('rejects reuse after an attachment has already become active', async () => {
    const repo = makeRepo();
    repo.findById = mock.fn(async () => ({ ...attachment, status: 'ACTIVE' }));
    const storage = makeStorage();
    const uc = new CompleteAttachmentUploadUseCase(repo as any, storage as any, makeAudit() as any, cleanScanner as any, makeLogger() as any);

    await assert.rejects(() => uc.execute(ctx, { attachmentId: 'att-1' }), BadRequestException);
    assert.equal((storage.getObjectMetadata as any).mock.callCount(), 0);
  });
});

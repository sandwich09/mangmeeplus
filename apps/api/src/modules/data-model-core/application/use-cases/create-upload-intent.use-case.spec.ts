import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CreateUploadIntentUseCase } from './create-upload-intent.use-case';
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

const stubRecord: AttachmentRecord = {
  id: 'att-1', companyId: 'co-1', storageProvider: 'local', bucket: 'local-attachments',
  objectKey: 'co-1/123_file.pdf', originalFileName: 'file.pdf', mimeType: 'application/pdf',
  byteSize: 1024, visibility: 'INTERNAL', status: 'PENDING_UPLOAD', uploadedByUserId: 'user-1',
  createdAt: new Date(), updatedAt: new Date(),
};

const makeRepo = (overrides: any = {}) => ({
  createPending: mock.fn(async () => stubRecord),
  markActive: mock.fn(async () => stubRecord),
  markDeleted: mock.fn(async () => stubRecord),
  linkToTarget: mock.fn(async () => ({})),
  findById: mock.fn(async () => null),
  sumPendingBytes: mock.fn(async () => 0),
  ...overrides,
});

const makeStorage = () => ({
  createUploadIntent: mock.fn(async (input: any) => ({
    uploadUrl: '/local-storage/upload/opaque-token',
    uploadMethod: 'PUT',
    uploadHeaders: { 'Content-Type': input.mimeType, 'If-None-Match': '*' },
    objectKey: input.objectKey,
    bucket: 'local-attachments',
    storageProvider: 'local',
    expiresAt: new Date(Date.now() + 3600_000),
  })),
  createDownloadUrl: mock.fn(async () => ({ url: '/local-storage/download/x', expiresAt: new Date() })),
  getObjectMetadata: mock.fn(async () => ({ byteSize: 0, exists: true })),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });
const config = { uploadMaxBytes: 10_000_000, uploadPendingMaxBytesPerCompany: 100_000_000, signedUrlTtlSeconds: 300 };

const validCmd = { originalFileName: 'file.pdf', mimeType: 'application/pdf', byteSize: 1024 };

describe('CreateUploadIntentUseCase', () => {
  it('throws ForbiddenException when ctx lacks attachment.create', async () => {
    const uc = new CreateUploadIntentUseCase(makeRepo() as any, makeStorage() as any, makeAudit() as any, config as any);
    await assert.rejects(() => uc.execute(makeCtx([]), validCmd), ForbiddenException);
  });

  it('throws BadRequestException when mime type is invalid', async () => {
    const uc = new CreateUploadIntentUseCase(makeRepo() as any, makeStorage() as any, makeAudit() as any, config as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['attachment.create']), { ...validCmd, mimeType: 'application/exe' }),
      BadRequestException,
    );
  });

  it('rejects a filename extension that does not match the declared MIME before creating an intent', async () => {
    const storage = makeStorage();
    const uc = new CreateUploadIntentUseCase(makeRepo() as any, storage as any, makeAudit() as any, config as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['attachment.create']), { ...validCmd, originalFileName: 'file.jpg' }),
      BadRequestException,
    );
    assert.equal(storage.createUploadIntent.mock.calls.length, 0);
  });

  it('returns attachmentId and uploadUrl (no objectKey) on success', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const uc = new CreateUploadIntentUseCase(repo as any, storage as any, makeAudit() as any, config as any);
    const result = await uc.execute(makeCtx(['attachment.create']), validCmd);
    assert.equal(result.attachmentId, 'att-1');
    assert.ok(result.uploadUrl.startsWith('/local-storage/upload/'));
    assert.equal(result.uploadUrl.includes(stubRecord.objectKey), false);
    assert.equal('objectKey' in result, false);
    assert.deepEqual(result.uploadHeaders, { 'Content-Type': 'application/pdf', 'If-None-Match': '*' });
    assert.equal((storage.createUploadIntent.mock.calls as any[])[0]?.arguments[0].expiresInSeconds, 300);
    assert.equal((repo.createPending.mock.calls as any[]).length, 1);
  });

  it('rejects an upload when active pending intents exceed the tenant byte quota', async () => {
    const repo = makeRepo({ sumPendingBytes: mock.fn(async () => 99_999_500) });
    const uc = new CreateUploadIntentUseCase(repo as any, makeStorage() as any, makeAudit() as any, config as any);

    await assert.rejects(
      () => uc.execute(makeCtx(['attachment.create']), validCmd),
      (error: any) => error?.getStatus?.() === 429,
    );
  });
});

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

function makeUseCase(retentionHold: 'SUBSTITUTE_ARTIFACT' | 'SUBSTITUTE_SOURCE' | null) {
  const attachments = {
    findById: mock.fn(async () => attachment),
    findSubstituteEvidenceRetentionHold: mock.fn(async () => retentionHold),
    markDeleted: mock.fn(async () => ({ ...attachment, status: 'DELETED' })),
  };
  const audit = { log: mock.fn(async () => {}) };
  return { useCase: new DeleteAttachmentUseCase(attachments as any, audit as any), attachments, audit };
}

describe('DeleteAttachmentUseCase substitute-evidence retention', () => {
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

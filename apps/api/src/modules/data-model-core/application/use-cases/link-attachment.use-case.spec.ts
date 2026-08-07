import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { LinkAttachmentUseCase } from './link-attachment.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

const context = (permissions: string[]): RequestContext => ({
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

const attachment = {
  id: 'att-1',
  companyId: 'co-1',
  status: 'ACTIVE',
};

function setup() {
  const repository = {
    findById: mock.fn(async () => attachment),
    linkToTarget: mock.fn(async (input: any) => ({ id: 'link-1', ...input, createdAt: new Date() })),
  };
  const audit = { log: mock.fn(async () => undefined) };
  return { useCase: new LinkAttachmentUseCase(repository as any, audit as any), repository, audit };
}

describe('LinkAttachmentUseCase', () => {
  it('rejects arbitrary target types and purposes before repository access', async () => {
    const { useCase, repository } = setup();
    await assert.rejects(
      () => useCase.execute(context(['attachment.create', 'expense.update']), {
        attachmentId: 'att-1',
        targetType: 'company',
        targetId: 'co-2',
        purpose: 'admin',
      }),
      ForbiddenException,
    );
    assert.equal(repository.findById.mock.callCount(), 0);
    assert.equal(repository.linkToTarget.mock.callCount(), 0);
  });

  it('requires a target-domain mutation permission', async () => {
    const { useCase, repository } = setup();
    await assert.rejects(
      () => useCase.execute(context(['attachment.create', 'expense.read']), {
        attachmentId: 'att-1',
        targetType: 'expense.record',
        targetId: 'expense-1',
        purpose: 'expense.receipt.supporting',
      }),
      ForbiddenException,
    );
    assert.equal(repository.linkToTarget.mock.callCount(), 0);
  });

  it('scopes self-service expense links to records owned by the caller', async () => {
    const { useCase, repository } = setup();
    await useCase.execute(context(['attachment.create', 'expense.update']), {
      attachmentId: 'att-1',
      targetType: 'expense.record',
      targetId: 'expense-1',
      purpose: 'expense.receipt.supporting',
    });
    const input = (repository.linkToTarget.mock.calls as any[])[0]?.arguments[0];
    assert.equal(input.companyId, 'co-1');
    assert.equal(input.targetOwnerUserId, 'user-1');
  });

  it('lets expense reviewers link an allowed purpose across owners in the same tenant', async () => {
    const { useCase, repository } = setup();
    await useCase.execute(context(['attachment.create', 'expense.review']), {
      attachmentId: 'att-1',
      targetType: 'expense.record',
      targetId: 'expense-1',
      purpose: 'expense.review.evidence',
    });
    const input = (repository.linkToTarget.mock.calls as any[])[0]?.arguments[0];
    assert.equal(input.targetOwnerUserId, undefined);
  });
});

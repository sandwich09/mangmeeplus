import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { ListDocumentSequencesUseCase } from './list-document-sequences.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

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

const makeRepo = () => ({
  list: mock.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  upsertConfig: mock.fn(),
  reserveNumber: mock.fn(),
  commitNumber: mock.fn(),
  cancelReservation: mock.fn(),
});

describe('ListDocumentSequencesUseCase', () => {
  it('throws ForbiddenException when ctx lacks document.sequence.read', async () => {
    const repo = makeRepo();
    const uc = new ListDocumentSequencesUseCase(repo as any);
    await assert.rejects(() => uc.execute(makeCtx([]), {}), ForbiddenException);
  });

  it('calls list with companyId from ctx', async () => {
    const repo = makeRepo();
    const uc = new ListDocumentSequencesUseCase(repo as any);
    await uc.execute(makeCtx(['document.sequence.read']), { documentType: 'invoice' });
    assert.equal(((repo.list.mock.calls as any[])[0]?.arguments[0] as any).companyId, 'co-1');
    assert.equal(((repo.list.mock.calls as any[])[0]?.arguments[0] as any).documentType, 'invoice');
  });
});

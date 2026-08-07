import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { UpsertDocumentSequenceUseCase } from './upsert-document-sequence.use-case';
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

const fakeRecord = { id: 'seq-1', companyId: 'co-1', documentType: 'invoice' };

const makeRepo = () => ({
  upsertConfig: mock.fn(async () => fakeRecord),
  list: mock.fn(),
  reserveNumber: mock.fn(),
  commitNumber: mock.fn(),
  cancelReservation: mock.fn(),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

const validCmd = {
  documentType: 'invoice',
  periodKey: 'ALL',
  prefixTemplate: 'INV-{SEQ}',
};

describe('UpsertDocumentSequenceUseCase', () => {
  it('throws ForbiddenException when ctx lacks document.sequence.manage', async () => {
    const uc = new UpsertDocumentSequenceUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(() => uc.execute(makeCtx([]), validCmd), ForbiddenException);
  });

  it('throws BadRequestException when prefixTemplate is invalid (missing {SEQ})', async () => {
    const uc = new UpsertDocumentSequenceUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['document.sequence.manage']), { ...validCmd, prefixTemplate: 'INV-{YYYY}' }),
      BadRequestException,
    );
  });

  it('throws BadRequestException when prefixTemplate has unknown placeholder', async () => {
    const uc = new UpsertDocumentSequenceUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['document.sequence.manage']), { ...validCmd, prefixTemplate: 'INV-{FOO}-{SEQ}' }),
      BadRequestException,
    );
  });

  it('calls audit with HIGH riskLevel on success', async () => {
    const audit = makeAudit();
    const uc = new UpsertDocumentSequenceUseCase(makeRepo() as any, audit as any);
    await uc.execute(makeCtx(['document.sequence.manage']), validCmd);
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    const logArg = ((audit.log.mock.calls as any[])[0]?.arguments[0] as any);
    assert.equal(logArg.riskLevel, 'HIGH');
    assert.equal(logArg.result, 'SUCCESS');
  });
});

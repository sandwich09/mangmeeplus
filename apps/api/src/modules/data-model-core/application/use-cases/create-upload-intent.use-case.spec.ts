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

describe('CreateUploadIntentUseCase receipt resume', () => {
  it('reuses bytes from a lost upload response and re-signs only the original missing object', async () => {
    for (const exists of [true, false]) {
      const repo = makeRepo({ findById: async ({ companyId }: any) => companyId === 'co-1' ? stubRecord : null });
      const storage = makeStorage();
      storage.getObjectMetadata = mock.fn(async () => ({ byteSize: 1024, exists }));
      const uc = new CreateUploadIntentUseCase(repo as any, storage as any, makeAudit() as any, config as any);
      const result = await uc.resume(makeCtx(['attachment.create']), 'att-1');
      assert.equal(result.attachmentId, 'att-1');
      assert.equal(result.uploadRequired, !exists);
      assert.equal(repo.createPending.mock.calls.length, 0);
      assert.equal(storage.createUploadIntent.mock.calls.length, exists ? 0 : 1);
      if (!exists) assert.equal((storage.createUploadIntent.mock.calls as any[])[0].arguments[0].objectKey, stubRecord.objectKey);
    }
  });

  it('requires the same uploader, company and branch, including ACTIVE attachment recovery', async () => {
    const repo = makeRepo({ findById: async ({ companyId }: any) => companyId === 'co-1' ? { ...stubRecord, branchId: 'branch-a', status: 'ACTIVE' } : null });
    const storage = makeStorage();
    const uc = new CreateUploadIntentUseCase(repo as any, storage as any, makeAudit() as any, config as any);
    const owner = makeCtx(['attachment.create']);
    assert.equal((await uc.resume(owner, 'att-1')).uploadRequired, false);
    assert.equal(storage.createUploadIntent.mock.calls.length, 0, 'ACTIVE immutable bytes are never overwritten');
    await assert.rejects(() => uc.resume({ ...owner, userId: 'someone-else' }, 'att-1'), /Forbidden/);
    await assert.rejects(() => uc.resume({ ...owner, companyId: 'co-other' }, 'att-1'), /not found/i);
    await assert.rejects(() => uc.resume({ ...owner, scopes: { branchIds: ['branch-b'] } }, 'att-1'), /Forbidden/);
    await assert.rejects(() => uc.resume(makeCtx([]), 'att-1'), /Forbidden/);
  });
});


it('R11 upload intent checks branch before quota and storage', async () => {
  for (const branchIds of [['branch-a'], []]) {
    const commercial = mock.fn(async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'STARTER_249', termEndsAt: new Date('2099-01-01') } }));
    const repo = makeRepo({ commercialAccessDb: { company: { findUnique: commercial } } });
    const storage = makeStorage();
    const audit = makeAudit();
    const uc = new CreateUploadIntentUseCase(repo as any, storage as any, audit as any, config as any);
    await assert.rejects(() => uc.execute({ ...makeCtx(['attachment.create']), scopes: { branchIds } }, { ...validCmd, branchId: 'branch-b' }),
      (error: any) => error.getStatus() === 403);
    for (const spy of [commercial, repo.sumPendingBytes, storage.createUploadIntent, repo.createPending]) assert.equal(spy.mock.callCount(), 0);
    assert.equal((audit.log.mock.calls as any[])[0]?.arguments[0].result, 'DENIED');
  }
  for (const [branchId, scopes] of [['branch-a', { branchIds: ['branch-a'] }], [undefined, { branchIds: [] }], [null, { branchIds: [] }], ['branch-b', undefined], ['branch-b', {}]] as const) {
    const repo = makeRepo();
    const uc = new CreateUploadIntentUseCase(repo as any, makeStorage() as any, makeAudit() as any, config as any);
    const actor = { ...makeCtx(['attachment.create']), scopes: scopes as any };
    await uc.execute(actor, { ...validCmd, branchId: branchId as any });
    const input = (repo.createPending.mock.calls as any[])[0].arguments[0];
    assert.equal(input.branchId, branchId);
    assert.equal(input.uploadedByUserId, actor.userId);
    assert.equal(input.companyId, actor.companyId);
  }
});


it('R11 free upload keeps source branch and reservation identity', async () => {
  const reservation = { eventId: 'free-event', monthKey: '2026-10', sourceRoute: 'receipt-ocr-line' as const, requestId: 'line-message' };
  for (const scenario of ['free', 'upgrade', 'mismatch', 'foreign-creator', 'foreign-tenant', 'final', 'revoked', 'live-branch', 'source-branch', 'reservation-company', 'reservation-month', 'reservation-message'] as const) {
    const actor = { ...makeCtx(['attachment.create', 'expense.receipt.line_upload']), authProvider: 'line' as const, scopes: { branchIds: ['branch-a', 'branch-b'] } };
    const source = { id: 'expense-1', branchId: scenario === 'source-branch' ? 'branch-c' : 'branch-a',
      createdByUserId: scenario === 'foreign-creator' ? 'another-user' : actor.userId,
      status: scenario === 'final' ? 'CONFIRMED' : 'DRAFT', captureSource: 'LINE_UPLOAD', lineMessageId: 'line-message' };
    const event = { id: reservation.eventId, companyId: scenario === 'reservation-company' ? 'other-company' : actor.companyId,
      sourceRoute: reservation.sourceRoute, requestId: scenario === 'reservation-message' ? 'other-message' : reservation.requestId,
      monthKey: scenario === 'reservation-month' ? '2026-09' : reservation.monthKey, quotaSource: 'FREE_MONTHLY_3', succeededAt: null, billingReceiptGrantId: null };
    const months: string[] = [];
    const db = {
      company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: scenario === 'upgrade' ? 'STARTER_249' : 'FREE_TRIAL_15',
        termEndsAt: scenario === 'upgrade' ? new Date('2099-01-01') : new Date(0) } }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
      packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
      expenseRecord: { findFirst: async ({ where }: any) => where.companyId === actor.companyId && scenario !== 'foreign-tenant' ? source : null },
      companyMembership: { findFirst: async () => scenario === 'revoked' ? null : { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: scenario === 'live-branch' ? [] : [{ branchId: 'branch-a' }, { branchId: 'branch-b' }] } },
      companyOcrUsageEvent: {
        findUnique: async () => event,
        findMany: async ({ where }: any) => { months.push(where.monthKey); return [event, { succeededAt: new Date() }, { succeededAt: new Date() }]; },
      },
      attachmentObject: { count: async () => 0 },
    };
    const repo = makeRepo({ commercialAccessDb: db });
    const storage = makeStorage();
    const uc = new CreateUploadIntentUseCase(repo as any, storage as any, makeAudit() as any, config as any);
    const command = { ...validCmd, ...(scenario === 'mismatch' ? { branchId: 'branch-b' } : {}), visibility: 'PUBLIC' as any,
      metadataJson: { freeExpenseSource: { kind: 'EXPENSE', id: 'forged-source' } } };
    const run = () => uc.execute(actor, command, { expenseId: source.id, freeOcrReservation: reservation });
    if (scenario === 'free' || scenario === 'upgrade') {
      await run();
      const pending = (repo.createPending.mock.calls as any[])[0].arguments[0];
      assert.equal(pending.branchId, 'branch-a');
      assert.equal(pending.uploadedByUserId, actor.userId);
      assert.equal(pending.companyId, actor.companyId);
      assert.equal(pending.visibility, 'INTERNAL');
      assert.deepEqual(pending.metadataJson, { freeExpenseSource: { kind: 'EXPENSE', id: source.id }, freeExpenseUploadMonth: reservation.monthKey, lineReceiptExpenseId: source.id });
      assert.deepEqual(months, [reservation.monthKey]);
    } else {
      await assert.rejects(run, (error: any) => error.getStatus() === 403, scenario);
      assert.equal(storage.createUploadIntent.mock.callCount(), 0, scenario);
      assert.equal(repo.sumPendingBytes.mock.callCount(), 0, scenario);
      assert.equal(repo.createPending.mock.callCount(), 0, scenario);
    }
  }
});

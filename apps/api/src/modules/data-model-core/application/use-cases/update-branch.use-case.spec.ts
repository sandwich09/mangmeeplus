import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UpdateBranchUseCase } from './update-branch.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import type { BranchRecord } from '../../domain/models/branch.model';

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

const makeHeadOfficeBranch = (): BranchRecord => ({
  id: 'b-1', companyId: 'co-1', code: 'HQ', name: 'Head Office',
  type: 'HEAD_OFFICE', isVatEstablishment: false, status: 'ACTIVE',
  createdAt: new Date(), updatedAt: new Date(),
});

const makeRepo = (existing: BranchRecord | null, activeHQCount = 1, duplicateTaxBranch: BranchRecord | null = null) => ({
  create: mock.fn(async () => { throw new Error('not used'); }),
  update: mock.fn(async (input: any) => ({ ...makeHeadOfficeBranch(), ...input })),
  findById: mock.fn(async () => existing),
  list: mock.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  countActiveHeadOffice: mock.fn(async () => activeHQCount),
  findActiveByTaxBranchCode: mock.fn(async () => duplicateTaxBranch),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

describe('UpdateBranchUseCase', () => {
  it('throws ForbiddenException when ctx lacks company.branch.manage', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(null) as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx([]), { branchId: 'b-1', name: 'New' }),
      ForbiddenException,
    );
  });

  it('throws NotFoundException when branch not found in company', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(null) as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-999', name: 'X' }),
      NotFoundException,
    );
  });

  it('throws UnprocessableEntityException when archiving the only head office', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch(), 1) as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ARCHIVED' }),
      UnprocessableEntityException,
    );
  });

  it('throws ConflictException for duplicate active taxBranchCode', async () => {
    const duplicate = { ...makeHeadOfficeBranch(), id: 'b-2' };
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch(), 1, duplicate) as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', taxBranchCode: '00000' }),
      ConflictException,
    );
  });

  it('updates and calls audit log on success', async () => {
    const audit = makeAudit();
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch()) as any, audit as any);
    const result = await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', name: 'Updated' });
    assert.ok(result);
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    assert.equal(((audit.log.mock.calls as any[])[0]?.arguments[0] as any).result, 'SUCCESS');
  });

  it('passes null to clear an establishment tax code', async () => {
    const repo = makeRepo({ ...makeHeadOfficeBranch(), taxBranchCode: '00000', isVatEstablishment: true });
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', taxBranchCode: null });
    assert.equal((repo.update.mock.calls as any[])[0]?.arguments[0].taxBranchCode, null);
  });
});

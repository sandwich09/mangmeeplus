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

const makeBranch = (over: Partial<BranchRecord> = {}): BranchRecord => ({ ...makeHeadOfficeBranch(), ...over });

const makeRepo = (
  existing: BranchRecord | null,
  activeHQCount = 1,
  duplicateTaxBranch: BranchRecord | null = null,
  activeCount = 2,
) => ({
  create: mock.fn(async () => { throw new Error('not used'); }),
  update: mock.fn(async (input: any) => ({ ...makeHeadOfficeBranch(), ...input })),
  findById: mock.fn(async () => existing),
  list: mock.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  countActiveHeadOffice: mock.fn(async () => activeHQCount),
  countActive: mock.fn(async () => activeCount),
  findActiveByTaxBranchCode: mock.fn(async () => duplicateTaxBranch),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

/** Only the one table the branch guard reads. `open` is the in-flight reimbursement count. */
const makePrisma = (open = 0) => ({
  client: { reimbursementRequest: { count: mock.fn(async () => open) } },
});

describe('UpdateBranchUseCase', () => {
  it('throws ForbiddenException when ctx lacks company.branch.manage', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(null) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx([]), { branchId: 'b-1', name: 'New' }),
      ForbiddenException,
    );
  });

  it('throws NotFoundException when branch not found in company', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(null) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-999', name: 'X' }),
      NotFoundException,
    );
  });

  it('throws UnprocessableEntityException when archiving the only head office', async () => {
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch(), 1) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ARCHIVED' }),
      UnprocessableEntityException,
    );
  });

  it('throws ConflictException for duplicate active taxBranchCode', async () => {
    const duplicate = { ...makeHeadOfficeBranch(), id: 'b-2' };
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch(), 1, duplicate) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', taxBranchCode: '00000' }),
      ConflictException,
    );
  });

  it('updates and calls audit log on success', async () => {
    const audit = makeAudit();
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch()) as any, audit as any, makePrisma() as any);
    const result = await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', name: 'Updated' });
    assert.ok(result);
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    assert.equal(((audit.log.mock.calls as any[])[0]?.arguments[0] as any).result, 'SUCCESS');
  });

  it('passes null to clear an establishment tax code', async () => {
    const repo = makeRepo({ ...makeHeadOfficeBranch(), taxBranchCode: '00000', isVatEstablishment: true });
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, makePrisma() as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', taxBranchCode: null });
    assert.equal((repo.update.mock.calls as any[])[0]?.arguments[0].taxBranchCode, null);
  });
  it('refuses DISABLED on the only head office, not just ARCHIVED', async () => {
    // The hole this closes: the dropdown on the branch settings page offers ปิดใช้งาน beside
    // เก็บถาวร, and only the second was guarded.
    const uc = new UpdateBranchUseCase(makeRepo(makeHeadOfficeBranch(), 1) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'DISABLED' }),
      (e: any) => e instanceof UnprocessableEntityException
        && (e.getResponse() as any).code === 'branch_head_office_required',
    );
  });

  it('refuses deactivating the last active branch even when it is not a head office', async () => {
    const only = makeBranch({ type: 'BRANCH', code: 'B1' });
    const uc = new UpdateBranchUseCase(makeRepo(only, 0, null, 1) as any, makeAudit() as any, makePrisma() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ARCHIVED' }),
      (e: any) => e instanceof UnprocessableEntityException
        && (e.getResponse() as any).code === 'branch_last_active_required',
    );
  });

  it('refuses deactivating a branch that still has reimbursements in flight', async () => {
    const branch = makeBranch({ type: 'BRANCH', code: 'B2' });
    const uc = new UpdateBranchUseCase(
      makeRepo(branch, 1, null, 3) as any, makeAudit() as any, makePrisma(2) as any,
    );
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'DISABLED' }),
      (e: any) => e instanceof UnprocessableEntityException
        && (e.getResponse() as any).code === 'branch_has_open_reimbursements'
        && (e.getResponse() as any).openReimbursements === 2,
    );
  });

  it('allows deactivating a branch with no open claims when others stay active', async () => {
    const branch = makeBranch({ type: 'BRANCH', code: 'B3' });
    const repo = makeRepo(branch, 1, null, 3);
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, makePrisma(0) as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'DISABLED' });
    assert.equal((repo.update.mock.calls as any[])[0]?.arguments[0].status, 'DISABLED');
  });

  it('does not run the guard when the update leaves status alone', async () => {
    const repo = makeRepo(makeHeadOfficeBranch(), 1, null, 1);
    const prisma = makePrisma(9);
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, prisma as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', name: 'Renamed' });
    assert.equal((repo.countActive.mock.calls as any[]).length, 0);
    assert.equal((prisma.client.reimbursementRequest.count.mock.calls as any[]).length, 0);
  });

  it('does not run the guard when re-activating a branch', async () => {
    const repo = makeRepo(makeBranch({ status: 'DISABLED' }), 1, null, 1);
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, makePrisma(9) as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ACTIVE' });
    assert.equal((repo.countActive.mock.calls as any[]).length, 0);
  });

  it('restores a previously archived branch through the existing ACTIVE command', async () => {
    const repo = makeRepo(makeBranch({ status: 'ARCHIVED' }), 1, null, 1);
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, makePrisma() as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ACTIVE' });
    assert.equal((repo.update.mock.calls as any[])[0]?.arguments[0].status, 'ACTIVE');
  });

  it('does not re-run the guard when a branch that is already inactive is archived', async () => {
    const repo = makeRepo(makeBranch({ status: 'DISABLED' }), 1, null, 1);
    const uc = new UpdateBranchUseCase(repo as any, makeAudit() as any, makePrisma(9) as any);
    await uc.execute(makeCtx(['company.branch.manage']), { branchId: 'b-1', status: 'ARCHIVED' });
    assert.equal((repo.countActive.mock.calls as any[]).length, 0);
  });
});

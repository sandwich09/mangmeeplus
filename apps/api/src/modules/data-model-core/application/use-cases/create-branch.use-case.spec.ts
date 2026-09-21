import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { CreateBranchUseCase } from './create-branch.use-case';
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

const stubBranch: BranchRecord = {
  id: 'b-1', companyId: 'co-1', code: 'HQ', name: 'Head Office',
  type: 'HEAD_OFFICE', isVatEstablishment: false, status: 'ACTIVE',
  createdAt: new Date(), updatedAt: new Date(),
};

const makeRepo = (overrides: any = {}) => ({
  create: mock.fn(async () => stubBranch),
  update: mock.fn(async () => stubBranch),
  findById: mock.fn(async () => null),
  list: mock.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  countActiveHeadOffice: mock.fn(async () => 0),
  findActiveByTaxBranchCode: mock.fn(async () => null),
  ...overrides,
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

// P29: `planTerm: null` is the grandfathered company — the default in every pre-existing test
// below, which is exactly how a customer that predates P29 must behave.
const makePrisma = (opts: { planTerm?: { branchLimit: number } | null; activeBranches?: number } = {}) => ({
  client: {
    companyPlanTerm: { findUnique: mock.fn(async () => opts.planTerm ?? null) },
    branch: { count: mock.fn(async () => opts.activeBranches ?? 0) },
    companyMembership: { count: mock.fn(async () => 0) },
  },
}) as any;

const validCmd = { code: 'HQ', name: 'Head Office', type: 'HEAD_OFFICE' as const };

describe('CreateBranchUseCase', () => {
  it('throws ForbiddenException when ctx lacks company.branch.manage', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any, makePrisma());
    await assert.rejects(() => uc.execute(makeCtx([]), validCmd), ForbiddenException);
  });

  it('throws BadRequestException for invalid branch code', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any, makePrisma());
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, code: 'bad code!' }),
      BadRequestException,
    );
  });

  it('throws BadRequestException for invalid taxBranchCode', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any, makePrisma());
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, taxBranchCode: 'ABC' }),
      BadRequestException,
    );
  });

  it('throws ConflictException for duplicate active taxBranchCode', async () => {
    const uc = new CreateBranchUseCase(
      makeRepo({ findActiveByTaxBranchCode: mock.fn(async () => stubBranch) }) as any,
      makeAudit() as any,
      makePrisma(),
    );
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, taxBranchCode: '00000' }),
      ConflictException,
    );
  });

  it('creates branch and calls audit log on success', async () => {
    const audit = makeAudit();
    const uc = new CreateBranchUseCase(makeRepo() as any, audit as any, makePrisma());
    const result = await uc.execute(makeCtx(['company.branch.manage']), validCmd);
    assert.equal(result.id, 'b-1');
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    assert.equal(((audit.log.mock.calls as any[])[0]?.arguments[0] as any).result, 'SUCCESS');
  });

  // ---- P29 §4D branch cap ----

  it('P29: a company with no plan-term row is unlimited (never even counts branches)', async () => {
    const prisma = makePrisma({ planTerm: null, activeBranches: 99 });
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any, prisma);
    const result = await uc.execute(makeCtx(['company.branch.manage']), validCmd);
    assert.equal(result.id, 'b-1');
    assert.equal(prisma.client.branch.count.mock.calls.length, 0);
  });

  it('P29: under the branch limit still creates', async () => {
    const uc = new CreateBranchUseCase(
      makeRepo() as any,
      makeAudit() as any,
      makePrisma({ planTerm: { branchLimit: 2 }, activeBranches: 1 }),
    );
    assert.equal((await uc.execute(makeCtx(['company.branch.manage']), validCmd)).id, 'b-1');
  });

  it('P29: at the branch limit throws 422 with the Thai package message', async () => {
    const repo = makeRepo();
    const uc = new CreateBranchUseCase(
      repo as any,
      makeAudit() as any,
      makePrisma({ planTerm: { branchLimit: 2 }, activeBranches: 2 }),
    );
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), validCmd),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.deepEqual(err.getResponse(), {
          code: 'plan_branch_limit_exceeded',
          message: 'แพ็กเกจปัจจุบันรองรับ 2 สาขา และใช้งานครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ',
          details: { limit: 2, active: 2 },
        });
        return true;
      },
    );
    // Nothing was written: an over-limit company keeps every branch it already has.
    assert.equal(repo.create.mock.calls.length, 0);
  });

  it('P29: already OVER the limit blocks the new branch and leaves the existing ones alone', async () => {
    const repo = makeRepo();
    const uc = new CreateBranchUseCase(
      repo as any,
      makeAudit() as any,
      makePrisma({ planTerm: { branchLimit: 1 }, activeBranches: 5 }),
    );
    await assert.rejects(() => uc.execute(makeCtx(['company.branch.manage']), validCmd), UnprocessableEntityException);
    assert.equal(repo.create.mock.calls.length, 0);
    assert.equal(repo.update.mock.calls.length, 0);
  });
  it('refuses a second active head office', async () => {
    const repo = makeRepo({ countActiveHeadOffice: mock.fn(async () => 1) });
    const uc = new CreateBranchUseCase(repo as any, makeAudit() as any, makePrisma());
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), validCmd),
      (e: any) => e instanceof ConflictException && (e.getResponse() as any).code === 'branch_head_office_exists',
    );
    assert.equal((repo.create.mock.calls as any[]).length, 0);
  });

  it('still allows an ordinary branch when a head office exists', async () => {
    const repo = makeRepo({ countActiveHeadOffice: mock.fn(async () => 1) });
    const uc = new CreateBranchUseCase(repo as any, makeAudit() as any, makePrisma());
    await uc.execute(makeCtx(['company.branch.manage']), { code: 'B1', name: 'Siam', type: 'BRANCH' });
    assert.equal((repo.create.mock.calls as any[]).length, 1);
  });
});

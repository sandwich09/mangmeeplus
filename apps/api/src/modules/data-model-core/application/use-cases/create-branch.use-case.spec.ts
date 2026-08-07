import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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

const validCmd = { code: 'HQ', name: 'Head Office', type: 'HEAD_OFFICE' as const };

describe('CreateBranchUseCase', () => {
  it('throws ForbiddenException when ctx lacks company.branch.manage', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(() => uc.execute(makeCtx([]), validCmd), ForbiddenException);
  });

  it('throws BadRequestException for invalid branch code', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, code: 'bad code!' }),
      BadRequestException,
    );
  });

  it('throws BadRequestException for invalid taxBranchCode', async () => {
    const uc = new CreateBranchUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, taxBranchCode: 'ABC' }),
      BadRequestException,
    );
  });

  it('throws ConflictException for duplicate active taxBranchCode', async () => {
    const uc = new CreateBranchUseCase(
      makeRepo({ findActiveByTaxBranchCode: mock.fn(async () => stubBranch) }) as any,
      makeAudit() as any,
    );
    await assert.rejects(
      () => uc.execute(makeCtx(['company.branch.manage']), { ...validCmd, taxBranchCode: '00000' }),
      ConflictException,
    );
  });

  it('creates branch and calls audit log on success', async () => {
    const audit = makeAudit();
    const uc = new CreateBranchUseCase(makeRepo() as any, audit as any);
    const result = await uc.execute(makeCtx(['company.branch.manage']), validCmd);
    assert.equal(result.id, 'b-1');
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    assert.equal(((audit.log.mock.calls as any[])[0]?.arguments[0] as any).result, 'SUCCESS');
  });
});

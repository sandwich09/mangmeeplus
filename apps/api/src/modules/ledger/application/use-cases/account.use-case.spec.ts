import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreateAccountUseCase, UpdateAccountUseCase } from './account.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { AccountRecord } from '../../domain/models/ledger.model';

const makeCtx = (permissions: string[] = ['ledger.account.manage']): RequestContext => ({
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: [],
  permissions,
  scopes: {},
  authProvider: 'dev',
} as unknown as RequestContext);

const stubAccount = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: 'acc-1', companyId: 'co-1', code: '1110-01', nameTh: 'เงินสด', nameEn: null,
  accountClass: 'ASSET', reportGroup: null, normalBalance: 'DEBIT', parentAccountId: null,
  isPosting: true, isSystem: false, isControlled: false, taxCategory: null,
  cashFlowCategory: null, sourceGroup1: null, sourceGroup2: null,
  status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const makeRepo = (overrides: any = {}) => ({
  findAccountByCode: mock.fn(async () => null),
  findAccountById: mock.fn(async () => null),
  createAccount: mock.fn(async (data: any) => stubAccount(data)),
  updateAccount: mock.fn(async () => stubAccount()),
  ...overrides,
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

const validInput = { code: '1110-99', nameTh: 'เงินสดย่อย', accountClass: 'ASSET' as const, normalBalance: 'DEBIT' as const };

describe('CreateAccountUseCase (H-02)', () => {
  it('always creates with ctx.companyId and isSystem=false regardless of input', async () => {
    const repo = makeRepo();
    const uc = new CreateAccountUseCase(repo as any, makeAudit() as any);
    await uc.execute(makeCtx(), { ...validInput, companyId: 'other-co', isSystem: true } as any);
    const created = repo.createAccount.mock.calls[0].arguments[0];
    assert.equal(created.companyId, 'co-1');
    assert.equal(created.isSystem, false);
    assert.equal(created.isControlled, false);
  });

  it('rejects a parentAccountId that belongs to another tenant', async () => {
    const repo = makeRepo({ findAccountById: mock.fn(async () => stubAccount({ id: 'p-1', companyId: 'co-other' })) });
    const uc = new CreateAccountUseCase(repo as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(), { ...validInput, parentAccountId: 'p-1' }),
      BadRequestException,
    );
  });

  it('rejects a parentAccountId that does not exist', async () => {
    const uc = new CreateAccountUseCase(makeRepo() as any, makeAudit() as any);
    await assert.rejects(
      () => uc.execute(makeCtx(), { ...validInput, parentAccountId: 'missing' }),
      BadRequestException,
    );
  });

  it('accepts a same-tenant parent and a global system parent', async () => {
    for (const parent of [stubAccount({ id: 'p-1', companyId: 'co-1' }), stubAccount({ id: 'p-2', companyId: null, isSystem: true })]) {
      const repo = makeRepo({ findAccountById: mock.fn(async () => parent) });
      const uc = new CreateAccountUseCase(repo as any, makeAudit() as any);
      const out = await uc.execute(makeCtx(), { ...validInput, parentAccountId: parent.id });
      assert.equal(out.companyId, 'co-1');
    }
  });
});

describe('UpdateAccountUseCase (H-02)', () => {
  it('refuses to update a system account', async () => {
    const repo = makeRepo({ findAccountById: mock.fn(async () => stubAccount({ isSystem: true })) });
    const uc = new UpdateAccountUseCase(repo as any, makeAudit() as any);
    await assert.rejects(() => uc.execute(makeCtx(), 'acc-1', { nameTh: 'x' }), ForbiddenException);
  });

  it('refuses to update another tenant’s account', async () => {
    const repo = makeRepo({ findAccountById: mock.fn(async () => stubAccount({ companyId: 'co-other' })) });
    const uc = new UpdateAccountUseCase(repo as any, makeAudit() as any);
    await assert.rejects(() => uc.execute(makeCtx(), 'acc-1', { nameTh: 'x' }), /Account not found/);
  });
});

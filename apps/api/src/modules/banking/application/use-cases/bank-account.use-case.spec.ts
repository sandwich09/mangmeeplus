import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateBankAccountUseCase, UpdateBankAccountUseCase, isBankLedgerAccount } from './bank-account.use-case.js';

const ctx: RequestContext = {
  requestId: 'request-1',
  authSubject: 'subject-1',
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  roles: [],
  permissions: ['bank.account.manage'],
  scopes: {},
  authProvider: 'dev',
};

const ledgerAccount = {
  id: 'ledger-1',
  companyId: 'company-1',
  code: '1113-01',
  accountClass: 'ASSET',
  normalBalance: 'DEBIT',
  reportGroup: 'Asset',
  cashFlowCategory: null,
  isPosting: true,
  isControlled: false,
  status: 'ACTIVE',
};

function bankAccount() {
  return {
    id: 'bank-1',
    companyId: 'company-1',
    displayName: 'Main bank',
    accountType: 'BANK_SAVINGS',
    currency: 'THB',
    openingBalanceAmount: '0',
    status: 'ACTIVE',
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function repo(account: unknown = ledgerAccount) {
  return {
    findActiveBranch: mock.fn(async () => null),
    findLedgerAccountForBank: mock.fn(async () => account),
    listBankAccounts: mock.fn(async () => []),
    findBankAccountById: mock.fn(async () => bankAccount()),
    createBankAccount: mock.fn(async () => bankAccount()),
    updateBankAccount: mock.fn(async () => bankAccount()),
  };
}

const audit = { log: mock.fn(async () => undefined) };

describe('bank ledger account validation', () => {
  it('accepts reviewed cash/bank codes and explicit cash-flow markers', () => {
    assert.equal(isBankLedgerAccount(ledgerAccount), true);
    assert.equal(isBankLedgerAccount({
      ...ledgerAccount,
      code: '1999-01',
      cashFlowCategory: 'CASH_AND_BANK',
    }), true);
  });

  for (const [label, override] of [
    ['inactive', { status: 'INACTIVE' }],
    ['non-posting', { isPosting: false }],
    ['controlled', { isControlled: true }],
    ['non-asset', { accountClass: 'EXPENSE' }],
    ['credit-normal', { normalBalance: 'CREDIT' }],
    ['non-bank asset', { code: '1140-01' }],
  ] as const) {
    it(`rejects a ${label} ledger account before create`, async () => {
      const fake = repo({ ...ledgerAccount, ...override });
      const useCase = new CreateBankAccountUseCase(fake as any, audit as any);
      await assert.rejects(
        () => useCase.execute(ctx, {
          displayName: 'Main bank',
          accountType: 'BANK_SAVINGS',
          ledgerAccountId: 'ledger-1',
        }),
        (error: any) => error.getResponse?.().code === 'ledger_account_invalid_for_bank',
      );
      assert.equal(fake.createBankAccount.mock.callCount(), 0);
    });
  }

  it('rejects a foreign or missing ledger account before update', async () => {
    const fake = repo(null);
    const useCase = new UpdateBankAccountUseCase(fake as any, audit as any);
    await assert.rejects(
      () => useCase.execute(ctx, 'bank-1', { ledgerAccountId: 'foreign-ledger' }),
      (error: any) => error.getResponse?.().code === 'ledger_account_invalid_for_bank',
    );
    assert.equal(fake.updateBankAccount.mock.callCount(), 0);
  });
});

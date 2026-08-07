import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, mock } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { ListJournalsUseCase } from '../../../ledger/application/use-cases/journal.use-case';
import { CreateBankAccountUseCase, ListBankAccountsUseCase } from '../../../banking/application/use-cases/bank-account.use-case';

const ctx = (permissions: string[], branchIds = ['branch-1']): RequestContext => ({
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  roles: [],
  permissions,
  scopes: { branchIds },
  authProvider: 'dev',
});

describe('P1 branch authorization matrix', () => {
  it('passes branch scope into accounting and ledger list reads', async () => {
    const accountingRepo = { listDocuments: mock.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 20 })) };
    await new ListDocumentsUseCase(accountingRepo as any).execute(
      ctx(['accounting.document.read']),
      {},
    );
    assert.deepEqual((accountingRepo.listDocuments.mock.calls as any[])[0]?.arguments[1], ['branch-1']);

    const ledgerRepo = { listJournals: mock.fn(async () => ({ data: [], total: 0 })) };
    await new ListJournalsUseCase(ledgerRepo as any).execute(ctx(['ledger.journal.read']));
    assert.deepEqual((ledgerRepo.listJournals.mock.calls as any[])[0]?.arguments[2], ['branch-1']);
  });

  it('passes branch scope into banking reads', async () => {
    const repo = { listBankAccounts: mock.fn(async () => []) };
    await new ListBankAccountsUseCase(repo as any).execute(ctx(['bank.account.read']));
    assert.deepEqual((repo.listBankAccounts.mock.calls as any[])[0]?.arguments, ['company-1', ['branch-1']]);
  });

  it('rejects a bank-account write for an out-of-scope branch before persistence', async () => {
    const repo = {
      findActiveBranch: mock.fn(async () => ({ id: 'branch-2' })),
      listBankAccounts: mock.fn(async () => []),
      createBankAccount: mock.fn(async () => ({})),
    };
    const audit = { log: mock.fn(async () => undefined) };
    const useCase = new CreateBankAccountUseCase(repo as any, audit as any);
    await assert.rejects(() => useCase.execute(ctx(['bank.account.manage']), {
      branchId: 'branch-2',
      displayName: 'Other branch account',
      accountType: 'BANK_CHECKING',
    }), ForbiddenException);
    assert.equal(repo.createBankAccount.mock.callCount(), 0);
  });

  it('keeps composite company keys in the database migration for all sampled paths', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../../prisma/migrations/20260728170000_p1_branch_tenant_integrity/migration.sql'),
      'utf8',
    );
    for (const constraint of [
      'AccountingDocument_companyId_branchId_fkey',
      'AccountingDocumentLine_companyId_documentId_fkey',
      'AccountingPaymentAllocation_companyId_paymentId_fkey',
      'BankAccount_companyId_branchId_fkey',
      'BankStatementLine_companyId_bankAccountId_fkey',
      'BankReconciliationMatch_companyId_statementLineId_fkey',
    ]) {
      assert.match(sql, new RegExp(constraint));
    }
  });
});

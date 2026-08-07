import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TH_SME_COA_V1_ACCOUNTS } from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import { loadChartTemplatePreview } from './chart-template-query.service.js';

function account(code: string, overrides: Record<string, unknown> = {}) {
  const template = TH_SME_COA_V1_ACCOUNTS.find((row) => row.code === code)!;
  return {
    id: `account-${code}`,
    companyId: 'company-1',
    code,
    nameTh: template.nameTh,
    accountClass: template.accountClass,
    reportGroup: template.reportGroup,
    normalBalance: template.normalBalance,
    isPosting: template.isPosting,
    isControlled: template.isControlled,
    ...overrides,
  };
}

describe('loadChartTemplatePreview dependency scan', () => {
  it('combines id, code, bank, hierarchy, reconciliation, and unposted JSON references', async () => {
    const accounts = [
      account('1210-00', { nameTh: 'Accounts receivable' }),
      account('5310-01', { nameTh: 'General expenses' }),
    ];
    const db = {
      chartOfAccount: {
        findMany: async ({ where }: any) => where.code
          ? accounts
          : [{ id: 'child-account', parentAccountId: 'account-1210-00' }],
      },
      journalLine: {
        groupBy: async () => [{ accountId: 'account-1210-00', _count: { _all: 2 } }],
      },
      postingRule: {
        findMany: async () => [{
          debitAccountId: null,
          creditAccountId: 'account-1210-00',
          mappingJson: { debitAccountCode: '5310-01', creditAccountCode: '1210-00' },
        }],
      },
      taxAccountDeterminationRule: {
        groupBy: async () => [{ accountId: 'account-1210-00', _count: { _all: 1 } }],
      },
      taxReconciliationLine: {
        groupBy: async () => [{ journalTaxAccountId: 'account-1210-00', _count: { _all: 1 } }],
      },
      bankAccount: {
        groupBy: async () => [{ ledgerAccountId: 'account-1210-00', _count: { _all: 1 } }],
      },
      bankAdjustment: {
        groupBy: async ({ by }: any) => by[0] === 'ledgerDebitAccountId'
          ? [{ ledgerDebitAccountId: 'account-1210-00', _count: { _all: 1 } }]
          : [{ ledgerCreditAccountId: 'account-1210-00', _count: { _all: 2 } }],
      },
      $queryRaw: async () => [
        { source: 'ExpenseLineAssignment', accountId: 'account-1210-00', count: 3 },
        { source: 'TaxEventAssignment', accountId: 'account-1210-00', count: 1 },
      ],
    } as any;

    const preview = await loadChartTemplatePreview(db, 'company-1');
    const loan = preview.rows.find((row) => row.code === '1210-00')!;
    assert.equal(loan.classification, 'IN_USE_CONFLICT');
    assert.deepEqual(loan.dependencies, {
      JournalLine: 2,
      PostingRuleAccount: 1,
      PostingRuleCode: 1,
      TaxAccountRule: 1,
      TaxReconciliationLine: 1,
      BankAccount: 1,
      BankAdjustment: 3,
      AccountHierarchy: 1,
      ExpenseLineAssignment: 3,
      TaxEventAssignment: 1,
    });
    assert.equal(loan.dependencyCount, 15);

    const salary = preview.rows.find((row) => row.code === '5310-01')!;
    assert.equal(salary.classification, 'IN_USE_CONFLICT');
    assert.deepEqual(salary.dependencies, { PostingRuleCode: 1 });
  });
});

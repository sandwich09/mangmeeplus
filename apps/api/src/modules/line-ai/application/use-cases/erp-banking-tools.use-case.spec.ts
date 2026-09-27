import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BankGetAccountBalancesTool, BankGetReconciliationStatusTool } from './erp-banking-tools.use-case';

const ctx = {
  companyId: 'c1', userId: 'u1', membershipId: 'm1', roles: [], locale: 'th-TH',
  permissions: ['bank.account.read', 'bank.cash.read', 'bank.reconciliation.read'], branchIds: ['b1'],
} as any;

describe('bank ERP source adapters', () => {
  it('requires both account and cash permissions before reading balances', async () => {
    let calls = 0;
    const list = { execute: async () => { calls += 1; return []; } } as any;
    const cash = { execute: async () => { calls += 1; return []; } } as any;
    const tool = new BankGetAccountBalancesTool(list, cash);
    assert.equal((await tool.execute({ ...ctx, permissions: ['bank.account.read'] })).status, 'forbidden');
    assert.equal((await tool.execute({ ...ctx, permissions: ['bank.cash.read'] })).status, 'forbidden');
    assert.equal(calls, 0);
  });

  it('reports only last reconciled balances and preserves absent balance as unknown/null', async () => {
    const list = { execute: async () => [
      { id: 'a1', displayName: 'บัญชีหลัก', currency: 'THB' },
      { id: 'a2', displayName: 'บัญชียังไม่กระทบยอด', currency: 'USD' },
    ] } as any;
    const cash = { execute: async () => [
      { bankAccountId: 'a1', lastReconciledBalance: '123.4500', lastReconciledDate: '2026-09-20T00:00:00Z' },
      { bankAccountId: 'a2' },
    ] } as any;
    const result = await new BankGetAccountBalancesTool(list, cash).execute(ctx);
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).basis, 'last_completed_reconciliation_not_live_bank_feed');
    assert.deepEqual((result.data as any).accounts.map((account: any) => [account.lastReconciledBalance, account.balanceState]), [
      ['123.4500', 'known'], [null, 'unknown'],
    ]);
    assert.deepEqual(result.facts?.map((item) => item.state), ['known', 'unknown']);
  });

  it('returns current unmatched/pending counts separately from the last completed session', async () => {
    const status = { execute: async () => ({
      asOf: new Date('2026-09-22T00:00:00Z'),
      accounts: [{
        companyId: 'c1', bankAccountId: 'a1', bankAccountDisplayName: 'บัญชีหลัก', currency: 'THB',
        lastReconciledDate: '2026-09-20T00:00:00Z', lastReconciledBalance: '123.45',
        unreconciledLineCount: 3, unmatchedLineCount: 2, pendingAdjustmentCount: 1,
        lastStatementDate: '2026-09-21T00:00:00Z',
      }],
    }) } as any;
    const result = await new BankGetReconciliationStatusTool(status).execute(ctx);
    assert.equal(result.status, 'ok');
    assert.deepEqual((result.data as any).accounts[0], {
      bankAccountId: 'a1', displayName: 'บัญชีหลัก', currency: 'THB',
      lastCompletedReconciliationDate: '2026-09-20T00:00:00Z', lastCompletedClosingBalance: '123.45',
      unmatchedLineCount: 2, unreconciledLineCount: 3, pendingAdjustmentCount: 1,
      lastStatementDate: '2026-09-21T00:00:00Z',
    });
  });
});


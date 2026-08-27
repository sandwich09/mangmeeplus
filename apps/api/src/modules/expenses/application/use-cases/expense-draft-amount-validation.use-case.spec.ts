import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import type { CreateExpenseDraftInput, RequestContext } from '@watchdog-bms/contracts';
import { CreateExpenseDraftUseCase, UpdateExpenseDraftUseCase } from './expense-draft.use-case';

const ctx: RequestContext = {
  requestId: 'req-amount-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['expense.create'], scopes: {}, authProvider: 'watchdog',
};

const input = (lines: CreateExpenseDraftInput['lines']): CreateExpenseDraftInput => ({
  captureSource: 'WEB_MANUAL',
  expenseDate: '2026-08-08',
  vatMode: 'NO_VAT',
  inputVatClaimStatus: 'NON_CLAIMABLE',
  lines,
});

function setup() {
  const created: any[] = [];
  const upserted: any[] = [];
  const repo = {
    resolveCreateBranchId: async () => 'branch-1',
    createExpense: async (data: any) => {
      created.push(data);
      return { id: 'expense-1', ...data };
    },
    upsertLines: async (_companyId: string, _expenseId: string, lines: any[]) => { upserted.push(...lines); },
    deleteDraftExpense: async () => undefined,
  } as any;
  const audit = { log: async () => undefined } as any;
  const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
  const launchGate = { assertLaunchRouteOpen: async () => undefined } as any;
  return { useCase: new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate), created, upserted };
}

describe('CreateExpenseDraftUseCase amount persistence boundary', () => {
  it('rejects malformed input before creating a database record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(
      () => useCase.execute(ctx, input([{ lineNumber: 1, description: 'ค่าใช้จ่าย', quantity: '1e3', unitPrice: '100' }])),
      /quantity must be positive and fit Decimal\(18,4\)/,
    );
    assert.equal(created.length, 0);
  });

  it('rejects a multi-line aggregate overflow before creating a database record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(
      () => useCase.execute(ctx, input([
        { lineNumber: 1, description: 'รายการ 1', quantity: '1', unitPrice: '60000000000000' },
        { lineNumber: 2, description: 'รายการ 2', quantity: '1', unitPrice: '60000000000000' },
      ])),
      /aggregate amount exceeds Decimal\(18,4\)/,
    );
    assert.equal(created.length, 0);
  });

  it('persists exact boundary-safe line and header totals', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, input([
      { lineNumber: 1, description: 'รายการมูลค่าสูง', quantity: '1', unitPrice: '99999999999999.99' },
    ]));

    assert.equal(created[0].subtotalAmount, '99999999999999.9900');
    assert.equal(created[0].grandTotalAmount, '99999999999999.9900');
    assert.equal(upserted[0].lineSubtotalAmount, '99999999999999.9900');
  });
});

describe('UpdateExpenseDraftUseCase amount persistence boundary', () => {
  it('rejects malformed replacement lines before tax resolution or persistence', async () => {
    let resolved = false;
    let upserted = false;
    const repo = {
      findById: async () => ({
        id: 'expense-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1',
        status: 'DRAFT', sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW',
        vatMode: 'NO_VAT', currency: 'THB', expenseDate: new Date('2026-08-08T00:00:00.000Z'),
      }),
      upsertLines: async () => { upserted = true; },
    } as any;
    const audit = { log: async () => undefined } as any;
    const transactionTax = {
      resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => { resolved = true; return lines; },
    } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, transactionTax);

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ['expense.update'] }, 'expense-1', {
        lines: [{ lineNumber: 1, description: 'ค่าใช้จ่าย', quantity: '1', unitPrice: '100000000000000' }],
      }),
      /unit price must be non-negative and fit Decimal\(18,4\)/,
    );
    assert.equal(resolved, false);
    assert.equal(upserted, false);
  });
});

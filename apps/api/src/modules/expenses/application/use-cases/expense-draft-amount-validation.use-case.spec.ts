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
  it('persists an exact baht input and accepted WHT without inventing a rate', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, {
      ...input([{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '1234.56' }]),
      whtInput: { inputType: 'AMOUNT', value: '30.01' },
    });
    assert.deepEqual(created[0].whtInputJson, { inputType: 'AMOUNT', value: '30.01', origin: 'REVIEWER' });
    assert.equal(created[0].whtAmount, '30.0100');
    assert.equal(created[0].grandTotalAmount, '1234.5600');
    assert.equal(created[0].netPayableAmount, '1204.5500');
    assert.equal(upserted[0].whtRate, null);
    assert.equal(upserted[0].whtAmount, created[0].whtAmount);
  });

  it('rejects malformed/excess baht source before creating anything', async () => {
    for (const whtInput of [{ inputType: 'AMOUNT', value: '100.01' }, { inputType: 'RATE', value: '3.001' },
      { inputType: 'RATE', value: '3', origin: 'OCR' }]) {
      const { useCase, created, upserted } = setup();
      await assert.rejects(() => useCase.execute(ctx, {
        ...input([{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100' }]),
        whtInput,
      } as any));
      assert.equal(created.length, 0);
      assert.equal(upserted.length, 0);
    }
  });

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

  it('creates mixed-VAT lines with independent zero treatment and no invented historical meaning', async () => {
    const { useCase, created, upserted } = setup();
    await useCase.execute(ctx, {
      ...input([
        { lineNumber: 1, description: 'Taxable', quantity: '1', unitPrice: '100', vatRate: '0.07' },
        { lineNumber: 2, description: 'Exempt', quantity: '1', unitPrice: '50', vatRate: '0', vatTreatment: 'EXEMPT' },
        { lineNumber: 3, description: 'Legacy zero', quantity: '1', unitPrice: '20', vatRate: '0' },
      ]),
      vatMode: 'VAT_EXCLUDED',
    });
    assert.equal(created[0].grandTotalAmount, '177.0000');
    assert.deepEqual(upserted.map((line) => line.vatTreatment), [null, 'EXEMPT', null]);
    assert.deepEqual(upserted.map((line) => line.vatAmount), ['7.0000', '0.0000', '0.0000']);
  });

  it('rejects a line source that overrides an explicit zero treatment before creating the record', async () => {
    const { useCase, created } = setup();
    await assert.rejects(() => useCase.execute(ctx, {
      ...input([{ lineNumber: 1, description: 'Exempt', quantity: '1', unitPrice: '100', vatRate: '0', vatTreatment: 'EXEMPT' }]),
      vatMode: 'VAT_EXCLUDED',
      vatSource: { inputType: 'NONE', lines: [{ lineNumber: 1, inputType: 'RATE', vatRatePercent: '7' }] },
    }), /requires an explicit zero VAT rate/);
    assert.equal(created.length, 0);
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

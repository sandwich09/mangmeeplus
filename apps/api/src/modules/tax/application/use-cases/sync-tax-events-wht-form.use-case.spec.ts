import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

// These suites cover the document/expense seams; the supplier-payment WHT seam has its own file.
const noWhtPayments = { findRecordedWithWhtByCompany: async () => [] } as any;

function whtExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    companyId: 'company-1',
    expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    whtAmount: '30.0000',
    grossAmount: '1000.0000',
    vendorName: 'ผู้รับเงิน',
    vendorTaxId: '0100000000000',
    vendorBranchCode: '00003',
    payeeEntityKind: null,
    incomeCategoryCode: 'SERVICE_FEE',
    whtRate: '3.0000',
    currency: 'THB',
    updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(rows: Array<Record<string, unknown>>) {
  const events: any[] = [];
  const periods: any[] = [];
  const taxRepo = {
    upsertPeriod: async (input: any) => { periods.push(input); return { id: `period-${input.formType}`, status: 'OPEN' }; },
    findActiveEventBySourceComponent: async () => null,
    supersedeEvent: async () => undefined,
    upsertEvent: async (input: any) => { events.push(input); },
    createIssue: async () => undefined,
  } as any;
  const docSource = { findIssuedWithVatByCompany: async () => [] } as any;
  const expenseSource = {
    findConfirmedWithVatByCompany: async () => [],
    findConfirmedWithWhtByCompany: async () => rows,
  } as any;
  return { events, periods, run: () => new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('company-1') };
}

describe('SyncTaxEventsUseCase WHT form selection', () => {
  it('carries exact amount-only WHT into tax events without fabricating a reporting rate', async () => {
    const h = harness([whtExpense({ whtAmount: '30.01', grossAmount: '1234.56', whtRate: null })]);
    await h.run();
    assert.equal(h.events[0].withheldAmount, '30.01');
    assert.equal(h.events[0].grossAmount, '1234.56');
    assert.equal(h.events[0].whtRate, null);
  });
  it('files an individual payee on ภ.ง.ด.3', async () => {
    const h = harness([whtExpense({ payeeEntityKind: 'INDIVIDUAL' })]);

    const result = await h.run();

    assert.equal(result.whtCreated, 1);
    assert.deepEqual(h.periods, [{ companyId: 'company-1', taxType: 'WHT', formType: 'PND3', periodKey: '2026-07' }]);
    assert.equal(h.events[0].eventType, 'WHT_PND3');
    assert.equal(h.events[0].whtFormType, 'PND3');
  });

  it('files a juristic payee on ภ.ง.ด.53', async () => {
    const h = harness([whtExpense({ payeeEntityKind: 'JURISTIC' })]);

    await h.run();

    assert.equal(h.events[0].eventType, 'WHT_PND53');
    assert.equal(h.events[0].whtFormType, 'PND53');
  });

  it('falls back to ภ.ง.ด.53 for an expense confirmed before the class was captured, and carries rate and branch code', async () => {
    const h = harness([whtExpense()]);

    await h.run();

    assert.equal(h.events[0].eventType, 'WHT_PND53');
    // The rate reaches the ใบแนบ as a percent, so gross x rate reconciles with the withheld amount.
    assert.equal(h.events[0].whtRate, '3.0000');
    assert.equal(h.events[0].grossAmount, '1000.0000');
    assert.equal(h.events[0].withheldAmount, '30.0000');
    assert.equal(h.events[0].payeeSnapshot.branchCode, '00003');
    assert.equal(h.events[0].incomeCategoryCode, 'SERVICE_FEE');
  });

  it('creates no WHT period and no event for an expense that withholds nothing', async () => {
    const h = harness([whtExpense({ whtAmount: '0.0000', payeeEntityKind: 'INDIVIDUAL' })]);

    const result = await h.run();

    assert.equal(result.whtCreated, 0);
    assert.deepEqual(h.periods, []);
    assert.deepEqual(h.events, []);
  });
});

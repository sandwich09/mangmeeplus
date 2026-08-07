import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

/**
 * RA-20: withholding recorded when a vendor is actually paid reaching ภ.ง.ด.3/53. The expense seam
 * covers tax withheld at capture; this one covers the moment the money leaves, which is when the
 * obligation to the RD arises and where an SME withholds most often.
 */

function whtPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    paymentDate: new Date('2026-08-05T00:00:00.000Z'),
    whtAmount: '30.0000',
    // The income withheld on, already derived from the rate by the adapter — never the payment
    // gross, which includes VAT.
    grossAmount: '1000.0000',
    payeeName: 'ผู้รับเงิน',
    payeeTaxId: '0100000000000',
    payeeBranchCode: '00003',
    supplierType: 'JURISTIC_PERSON',
    incomeCategoryCode: 'WHT_SERVICE_5',
    whtRate: '3.0000',
    currency: 'THB',
    updatedAt: new Date('2026-08-05T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(rows: Array<Record<string, unknown>>, taxRepoOverrides: Record<string, unknown> = {}) {
  const events: any[] = [];
  const periods: any[] = [];
  const issues: any[] = [];
  const superseded: string[] = [];
  const taxRepo = {
    upsertPeriod: async (input: any) => { periods.push(input); return { id: `period-${input.formType}`, status: 'OPEN' }; },
    findActiveEventBySourceComponent: async () => null,
    supersedeEvent: async (id: string) => { superseded.push(id); },
    upsertEvent: async (input: any) => { events.push(input); },
    createIssue: async (input: any) => { issues.push(input); },
    ...taxRepoOverrides,
  } as any;
  const docSource = { findIssuedWithVatByCompany: async () => [] } as any;
  const expenseSource = {
    findConfirmedWithVatByCompany: async () => [],
    findConfirmedWithWhtByCompany: async () => [],
  } as any;
  const paymentSource = { findRecordedWithWhtByCompany: async () => rows } as any;
  return {
    events, periods, issues, superseded,
    run: () => new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, paymentSource).execute('company-1'),
  };
}

describe('SyncTaxEventsUseCase supplier-payment withholding', () => {
  it('files a juristic payee on ภ.ง.ด.53 with the income base, not the settlement total', async () => {
    const h = harness([whtPayment()]);
    const result = await h.run();

    assert.equal(result.whtCreated, 1);
    assert.equal(h.events.length, 1);
    const event = h.events[0];
    assert.equal(event.eventType, 'WHT_PND53');
    assert.equal(event.whtFormType, 'PND53');
    assert.equal(event.sourceType, 'procurement.supplier_payment');
    assert.equal(event.sourceId, 'payment-1');
    assert.equal(event.grossAmount, '1000.0000');
    assert.equal(event.withheldAmount, '30.0000');
    assert.equal(event.taxableBase, '1000.0000');
    assert.equal(event.incomeCategoryCode, 'WHT_SERVICE_5');
    assert.equal(event.whtRate, '3.0000');
    assert.equal(event.branchId, 'branch-1');
    // The period follows the payment date, not the bill date: the withholding happens on payment.
    assert.equal(event.periodKey, '2026-08');
    assert.equal(event.payeeSnapshot.taxId, '0100000000000');
    assert.equal(event.payeeSnapshot.branchCode, '00003');
  });

  it('files an individual payee on ภ.ง.ด.3', async () => {
    const h = harness([whtPayment({ supplierType: 'INDIVIDUAL' })]);
    await h.run();
    assert.equal(h.events[0].eventType, 'WHT_PND3');
    assert.equal(h.periods.at(-1).formType, 'PND3');
  });

  it('keeps ภ.ง.ด.53 as the documented fallback for a payee class it cannot map', async () => {
    // FOREIGN is genuinely ภ.ง.ด.54 territory, which is out of scope — it surfaces on 53 for an
    // accountant to catch rather than being silently dropped from every report.
    for (const supplierType of ['FOREIGN', 'GOVERNMENT', 'OTHER', null]) {
      const h = harness([whtPayment({ supplierType })]);
      await h.run();
      assert.equal(h.events[0].eventType, 'WHT_PND53', `expected PND53 fallback for ${supplierType}`);
    }
  });

  it('raises a review issue instead of an event when the payee has no tax ID', async () => {
    const h = harness([whtPayment({ payeeTaxId: null })]);
    const result = await h.run();
    assert.equal(result.whtCreated, 0);
    assert.equal(h.events.length, 0);
    assert.equal(h.issues.length, 1);
    assert.equal(h.issues[0].issueCode, 'MISSING_TAX_ID');
    assert.equal(h.issues[0].sourceType, 'procurement.supplier_payment');
  });

  it('blocks a foreign-currency withholding on missing FX rather than reporting it in THB', async () => {
    const h = harness([whtPayment({ currency: 'USD' })]);
    const result = await h.run();
    assert.equal(result.whtCreated, 0);
    assert.equal(h.issues[0].issueCode, 'FUNCTIONAL_CURRENCY_FX_MISSING');
  });

  it('skips a payment whose ภ.ง.ด. period is already filed', async () => {
    const h = harness([whtPayment()], {
      upsertPeriod: async (input: any) => ({ id: `period-${input.formType}`, status: 'FILED' }),
    });
    const result = await h.run();
    assert.equal(result.skippedLocked, 1);
    assert.equal(h.events.length, 0);
  });

  it('is idempotent on an unchanged payment and supersedes when the withholding changes', async () => {
    const unchanged = harness([whtPayment()], {
      findActiveEventBySourceComponent: async () => ({ id: 'event-1', sourceHash: null }),
    });
    // Same source hash the sync would compute for this row: re-running must not write again.
    const first = harness([whtPayment()]);
    await first.run();
    const hash = first.events[0].sourceHash;

    const replay = harness([whtPayment()], {
      findActiveEventBySourceComponent: async () => ({ id: 'event-1', sourceHash: hash }),
    });
    assert.equal((await replay.run()).whtCreated, 0);
    assert.equal(replay.events.length, 0);

    const changed = await unchanged.run();
    assert.equal(changed.whtCreated, 1);
    assert.deepEqual(unchanged.superseded, ['event-1']);
  });

  it('reports an unknown income base as the withheld amount, never as a VAT-inclusive total', async () => {
    // Pre-feature rows have no rate, so the adapter cannot derive the base. Falling back to the
    // withheld amount keeps base x rate visibly wrong for review instead of passing a settlement
    // figure off as income.
    const h = harness([whtPayment({ grossAmount: null, whtRate: null })]);
    await h.run();
    assert.equal(h.events[0].grossAmount, '30.0000');
    assert.equal(h.events[0].whtRate, null);
  });
});

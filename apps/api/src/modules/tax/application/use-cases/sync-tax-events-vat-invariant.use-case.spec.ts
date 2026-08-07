import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

// These suites cover the document/expense seams; the supplier-payment WHT seam has its own file.
const noWhtPayments = { findRecordedWithWhtByCompany: async () => [] } as any;

function expense(id: string, inputVatClaimStatus: string, taxEvidenceStatus: string) {
  return {
    id,
    companyId: 'company-1',
    expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    vatAmount: '7.0000',
    whtAmount: '0',
    taxableAmount: '100.0000',
    grandTotalAmount: '107.0000',
    inputVatClaimStatus,
    taxEvidenceStatus,
    vatMode: 'VAT_INCLUDED',
    vendorName: 'Vendor',
    vendorTaxId: '0100000000000',
    currency: 'THB',
    updatedAt: new Date('2026-07-13T10:00:00.000Z'),
  };
}

function harness(expenses: ReturnType<typeof expense>[], existingEventId?: string) {
  const events: any[] = [];
  const issues: any[] = [];
  const superseded: string[] = [];
  const taxRepo = {
    upsertPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
    findEventByIdempotencyKey: async () => existingEventId ? { id: existingEventId, sourceHash: 'old-hash' } : null,
    supersedeEvent: async (id: string) => { superseded.push(id); },
    upsertEvent: async (input: any) => { events.push(input); },
    createIssue: async (input: any) => { issues.push(input); },
  } as any;
  const docSource = { findIssuedWithVatByCompany: async () => [] } as any;
  const expenseSource = {
    findConfirmedWithVatByCompany: async () => expenses,
    findConfirmedWithWhtByCompany: async () => [],
  } as any;
  return {
    useCase: new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments),
    events,
    issues,
    superseded,
  };
}

describe('SyncTaxEventsUseCase expense VAT invariant', () => {
  it('creates VAT input only for exact CLAIMABLE + USABLE_FOR_TAX evidence', async () => {
    const h = harness([
      expense('non-claimable', 'NON_CLAIMABLE', 'USABLE_FOR_TAX'),
      expense('claim-needs-review', 'NEEDS_REVIEW', 'USABLE_FOR_TAX'),
      expense('supporting-only', 'CLAIMABLE', 'SUPPORTING_ONLY'),
      expense('tax-needs-review', 'CLAIMABLE', 'NEEDS_REVIEW'),
      expense('eligible', 'CLAIMABLE', 'USABLE_FOR_TAX'),
    ]);

    const result = await h.useCase.execute('company-1');

    assert.equal(result.vatInputCreated, 1);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0]?.sourceId, 'eligible');
    assert.equal(h.issues.length, 4);
  });

  it('supersedes an existing VAT input event when evidence becomes ineligible', async () => {
    const h = harness([expense('expense-1', 'CLAIMABLE', 'SUPPORTING_ONLY')], 'vat-event-1');

    const result = await h.useCase.execute('company-1');

    assert.equal(result.vatInputCreated, 0);
    assert.deepEqual(h.superseded, ['vat-event-1']);
    assert.equal(h.events.length, 0);
  });
});

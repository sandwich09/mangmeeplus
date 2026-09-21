// GAP-2 / spec §10: `payeeSnapshot.address` was hard-coded null at all four upsert sites, so every
// WHT event reached the 50 ทวิ handoff without the payee address the certificate has to print, and
// the person issuing it re-keyed it from the paper. Three of the four sites carry the address
// frozen on the document that event came from, not whatever a registry says today; the fourth
// (supplier payment) has no document of its own, so it is the one site backed by the registry —
// resolved by the adapter, not re-derived here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

const VENDOR_ADDRESS = '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';
const BUYER_ADDRESS = '99 หมู่ 2 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง ปทุมธานี 12120';

function outputDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1', companyId: 'company-1', documentType: 'TAX_INVOICE', documentNumber: 'INV-1',
    documentDate: new Date('2026-07-13T00:00:00.000Z'), vatMode: 'VAT_EXCLUDED', outputTaxCode: 'O7',
    vatAmount: '7.0000', taxableAmount: '100.0000', grandTotalAmount: '107.0000',
    taxInvoiceType: 'FULL', taxInvoiceId: null,
    counterpartyName: 'ลูกค้า', counterpartyTaxId: '0100000000000', counterpartyAddress: BUYER_ADDRESS,
    branchCode: '00000', currency: 'THB', updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    ...overrides,
  };
}

function vatExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    vatAmount: '7.0000', whtAmount: '0.0000', taxableAmount: '100.0000', grandTotalAmount: '107.0000',
    inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_EXCLUDED',
    vendorName: 'ร้านค้า', vendorTaxId: '0100000000001', vendorBranchCode: '00000',
    vendorAddress: VENDOR_ADDRESS, currency: 'THB', updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    ...overrides,
  };
}

function whtExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-2', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    whtAmount: '30.0000', grossAmount: '1000.0000',
    vendorName: 'ผู้รับเงิน', vendorTaxId: '0100000000002', vendorBranchCode: '00003',
    vendorAddress: VENDOR_ADDRESS, payeeEntityKind: 'JURISTIC', incomeCategoryCode: 'SERVICE_FEE',
    whtRate: '3.0000', currency: 'THB', updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    ...overrides,
  };
}

function whtPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1', companyId: 'company-1', branchId: null,
    paymentDate: new Date('2026-08-05T00:00:00.000Z'), whtAmount: '30.0000', grossAmount: '1000.0000',
    payeeName: 'ผู้รับเงิน', payeeTaxId: '0100000000003', payeeBranchCode: '00000',
    supplierType: 'JURISTIC_PERSON', incomeCategoryCode: 'WHT_SERVICE_5', whtRate: '3.0000',
    currency: 'THB', updatedAt: new Date('2026-08-05T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(sources: {
  documents?: Array<Record<string, unknown>>;
  vatExpenses?: Array<Record<string, unknown>>;
  whtExpenses?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
}) {
  const events: any[] = [];
  const taxRepo = {
    upsertPeriod: async (input: any) => ({ id: `period-${input.formType}`, status: 'OPEN' }),
    findActiveEventBySourceComponent: async () => null,
    findEventByIdempotencyKey: async () => null,
    supersedeEvent: async () => undefined,
    upsertEvent: async (input: any) => { events.push(input); },
    createIssue: async () => undefined,
  } as any;
  const docSource = { findIssuedWithVatByCompany: async () => sources.documents ?? [] } as any;
  const expenseSource = {
    findConfirmedWithVatByCompany: async () => sources.vatExpenses ?? [],
    findConfirmedWithWhtByCompany: async () => sources.whtExpenses ?? [],
  } as any;
  const paymentSource = { findRecordedWithWhtByCompany: async () => sources.payments ?? [] } as any;
  return { events, run: () => new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, paymentSource).execute('company-1') };
}

describe('SyncTaxEventsUseCase payee address', () => {
  it('carries the printed seller address onto the VAT_INPUT event', async () => {
    const h = harness({ vatExpenses: [vatExpense()] });

    await h.run();

    assert.equal(h.events[0].eventType, 'VAT_INPUT');
    assert.equal(h.events[0].payeeSnapshot.address, VENDOR_ADDRESS);
  });

  it('carries the printed seller address onto the WHT event 50 ทวิ is issued from', async () => {
    const h = harness({ whtExpenses: [whtExpense()] });

    await h.run();

    assert.equal(h.events[0].eventType, 'WHT_PND53');
    assert.equal(h.events[0].payeeSnapshot.address, VENDOR_ADDRESS);
  });

  /**
   * §8: an expense whose address was never filled in still syncs. The event says null — the honest
   * answer — instead of blocking, and the handoff review page is where the address gets typed.
   */
  it('writes the event with a null address rather than refusing one that has none', async () => {
    const h = harness({ vatExpenses: [vatExpense({ vendorAddress: null })], whtExpenses: [whtExpense({ vendorAddress: null })] });

    const result = await h.run();

    assert.equal(result.vatInputCreated, 1);
    assert.equal(result.whtCreated, 1);
    assert.deepEqual(h.events.map((event) => event.payeeSnapshot.address), [null, null]);
  });

  it('uses the document\'s own frozen buyer address on the sell side', async () => {
    const h = harness({ documents: [outputDocument()] });

    await h.run();

    assert.equal(h.events[0].eventType, 'VAT_OUTPUT');
    assert.equal(h.events[0].payeeSnapshot.address, BUYER_ADDRESS);
    // A document issued before BuyerSnapshotV1 froze an address still syncs, without one.
    const legacy = harness({ documents: [outputDocument({ counterpartyAddress: null })] });
    await legacy.run();
    assert.equal(legacy.events[0].payeeSnapshot.address, null);
  });

  /**
   * The fourth site has no document of its own to take an address from, so it is the counterparty
   * registry `SupplierPaymentSourceAdapter` now reads (§10 Phase 2) — this use case just takes
   * whatever the source row hands it, same as the other three sites.
   */
  it('carries the registry address the adapter resolved onto the supplier-payment WHT event', async () => {
    const h = harness({ payments: [whtPayment({ payeeAddress: VENDOR_ADDRESS })] });

    await h.run();

    assert.equal(h.events[0].payeeSnapshot.name, 'ผู้รับเงิน');
    assert.equal(h.events[0].payeeSnapshot.address, VENDOR_ADDRESS);
  });

  it('writes a null address when the payment has no counterparty match rather than refusing the event', async () => {
    const h = harness({ payments: [whtPayment({ payeeAddress: null })] });

    await h.run();

    assert.equal(h.events[0].payeeSnapshot.address, null);
  });
});

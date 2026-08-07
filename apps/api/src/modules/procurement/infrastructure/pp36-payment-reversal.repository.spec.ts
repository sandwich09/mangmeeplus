import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaProcurementRepository } from './prisma-procurement.repository.js';

function fixture(options: { claimReleased?: boolean; taxPeriodStatus?: string; certificateLinked?: boolean; whtPeriodStatus?: string; withheld?: boolean } = {}) {
  const whtEvents = options.withheld
    ? [{ id: 'wht-event-1', taxPeriodId: 'wht-period-1', taxPeriod: { status: options.whtPeriodStatus ?? 'OPEN' } }]
    : [];
  const allocation = {
    id: 'allocation-1', companyId: 'company-1', supplierPaymentId: 'payment-1', vendorBillId: 'bill-1',
    amount: '50', whtAmount: null, pp36RecognitionStatus: 'ACTIVE',
    pp36RecognitionJson: [{ recognitionKey: 'allocation-1:line-1', vendorBillLineId: 'line-1', sourceTaxBaseAmount: '50', evidenceIds: ['evidence-1'], preview: {} }],
    allocatedAt: new Date(), createdByUserId: 'payer-1', createdAt: new Date(),
  };
  const payment = {
    id: 'payment-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'RECORDED', paymentNumber: 'PAY-1',
    paymentDate: new Date('2026-08-15'), method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '50', whtAmount: options.withheld ? '1.5' : '0',
    netPaidAmount: '50', allocatedAmount: '50', unappliedAmount: '0', postingStatus: 'posted', taxSyncStatus: 'synced',
    createdByUserId: 'payer-1', createdAt: new Date(), updatedAt: new Date(), allocations: [allocation],
  };
  const journalLine = {
    accountId: 'tax-account', branchId: 'branch-1', lineNumber: 1, description: 'PP36', debitAmount: '7', creditAmount: '0',
    currency: 'THB', sourceType: 'procurement.supplier_payment.pp36', sourceId: 'allocation-1:line-1', taxCode: 'V3',
  };
  const journals = [
    { id: 'journal-ap', periodId: 'period-1', period: { status: 'OPEN' }, status: 'POSTED', sourceType: 'procurement.supplier_payment', sourceId: 'payment-1', entryDate: new Date('2026-08-15'), lines: [journalLine] },
    { id: 'journal-pp36', periodId: 'period-1', period: { status: 'OPEN' }, status: 'POSTED', sourceType: 'procurement.supplier_payment.pp36', sourceId: 'payment-1', entryDate: new Date('2026-08-15'), lines: [journalLine] },
  ];
  const reversalCreates: any[] = [];
  const journalUpdates: any[] = [];
  let eventStatus: string | undefined;
  let whtEventStatus: string | undefined;
  let handoffUpdate: any;
  const adjustments: any[] = [];
  let allocationUpdate: any;
  let billUpdate: any;
  let paymentUpdate: any;
  const client: any = {
    $transaction: async (fn: (tx: any) => unknown) => fn(client),
    supplierPayment: {
      findFirst: async () => payment,
      update: async ({ data }: any) => { paymentUpdate = data; return { ...payment, ...data, allocations: [allocation] }; },
    },
    taxAdjustment: {
      findMany: async () => options.claimReleased ? [{ metadataJson: { kind: 'PP36_INPUT_CLAIM_RELEASE', vendorBillLineId: 'line-1', supplierPaymentId: 'payment-1' } }] : [],
      create: async ({ data }: any) => { adjustments.push(data); return { id: 'adjustment-1' }; },
    },
    taxEvent: {
      // The void runs two separate event queries — PP36 and withholding — so this must answer by
      // sourceType instead of returning the same row to both.
      findMany: async ({ where }: any) => where.sourceType === 'procurement.supplier_payment.pp36'
        ? [{ id: 'event-1', taxPeriodId: 'tax-period-1', taxPeriod: { status: options.taxPeriodStatus ?? 'OPEN' } }]
        : whtEvents,
      updateMany: async ({ where, data }: any) => {
        if (where.id.in.includes('event-1')) eventStatus = data.status; else whtEventStatus = data.status;
        return { count: 1 };
      },
    },
    whtCertificateHandoff: {
      count: async () => options.certificateLinked ? 1 : 0,
      updateMany: async ({ where, data }: any) => { handoffUpdate = { where, data }; return { count: 1 }; },
    },
    journalEntry: {
      findMany: async () => journals,
      create: async ({ data }: any) => { reversalCreates.push(data); return { id: `reversal-${reversalCreates.length}` }; },
      update: async ({ where, data }: any) => { journalUpdates.push({ id: where.id, ...data }); return {}; },
    },
    supplierPaymentAllocation: { updateMany: async ({ data }: any) => { allocationUpdate = data; return { count: 1 }; } },
    vendorBill: {
      findFirst: async () => ({ id: 'bill-1', paidAmount: '50', netPayableAmount: '100' }),
      update: async ({ data }: any) => { billUpdate = data; return {}; },
    },
  };
  return {
    repo: new PrismaProcurementRepository({ client } as any),
    get reversalCreates() { return reversalCreates; }, get journalUpdates() { return journalUpdates; },
    get eventStatus() { return eventStatus; }, get allocationUpdate() { return allocationUpdate; },
    get billUpdate() { return billUpdate; }, get paymentUpdate() { return paymentUpdate; },
    get whtEventStatus() { return whtEventStatus; }, get handoffUpdate() { return handoffUpdate; },
    get adjustments() { return adjustments; },
  };
}

describe('PP36 supplier-payment controlled reversal', () => {
  it('creates compensating journals and atomically reverses tax events, snapshots, payment, and bill balance', async () => {
    const f = fixture();
    const result = await f.repo.voidSupplierPayment('company-1', 'payment-1', 'voider-1', 'duplicate payment', {
      'journal-ap': 'JV-R-1', 'journal-pp36': 'JV-R-2',
    });
    assert.equal(result.payment.status, 'VOIDED');
    assert.deepEqual(result.reversalJournals, [
      { originalJournalId: 'journal-ap', reversalJournalId: 'reversal-1' },
      { originalJournalId: 'journal-pp36', reversalJournalId: 'reversal-2' },
    ]);
    assert.equal(f.reversalCreates.length, 2);
    assert.equal(f.reversalCreates[0].reversalOfJournalEntryId, 'journal-ap');
    assert.equal(String(f.reversalCreates[0].lines.create[0].creditAmount), '7');
    // Prisma 7 regression guard: companyId is inherited through the compound
    // journalEntry relation and must not appear in the nested line create.
    assert.ok(f.reversalCreates.every((create) => create.lines.create.every((line: any) => !('companyId' in line))));
    // Originals keep status POSTED so POSTED-only report queries net them
    // against the reversal entries — a status flip here double-subtracts.
    assert.deepEqual(f.journalUpdates, []);
    assert.equal(f.eventStatus, 'REVERSED');
    assert.equal(f.allocationUpdate.pp36RecognitionStatus, 'REVERSED');
    assert.deepEqual({ paidAmount: f.billUpdate.paidAmount, outstandingAmount: f.billUpdate.outstandingAmount, status: f.billUpdate.status },
      { paidAmount: '0.0000', outstandingAmount: '100.0000', status: 'APPROVED' });
    assert.equal(f.paymentUpdate.status, 'VOIDED');
  });

  it('rejects reversal after input claim release or when the PP36 period is filed', async () => {
    await assert.rejects(() => fixture({ claimReleased: true }).repo.voidSupplierPayment(
      'company-1', 'payment-1', 'voider-1', 'invalid', {},
    ), /pp36_input_claim_already_released_requires_amendment/);
    await assert.rejects(() => fixture({ taxPeriodStatus: 'FILED' }).repo.voidSupplierPayment(
      'company-1', 'payment-1', 'voider-1', 'invalid', {},
    ), /pp36_tax_period_locked_requires_amendment/);
  });
});

describe('withholding on supplier-payment reversal', () => {
  const voidIt = (f: ReturnType<typeof fixture>) => f.repo.voidSupplierPayment(
    'company-1', 'payment-1', 'voider-1', 'duplicate payment', { 'journal-ap': 'JV-R-1', 'journal-pp36': 'JV-R-2' },
  );

  it('reverses the ภ.ง.ด. event and cancels the certificate the payee is no longer owed', async () => {
    const f = fixture({ withheld: true });
    await voidIt(f);
    assert.equal(f.whtEventStatus, 'REVERSED');
    // Left REQUIRED the handoff would sit in the AP panel asking someone to issue a 50 ทวิ for a
    // payment that no longer exists.
    assert.equal(f.handoffUpdate.data.status, 'CANCELLED');
    assert.equal(f.handoffUpdate.where.status, 'REQUIRED');
    assert.equal(f.handoffUpdate.where.sourcePaymentId, 'payment-1');
    const whtAdjustment = f.adjustments.find((row) => row.metadataJson?.kind === 'WHT_PAYMENT_REVERSAL');
    assert.ok(whtAdjustment, 'a withholding reversal must leave its own tax adjustment');
    assert.deepEqual(whtAdjustment.metadataJson.taxEventIds, ['wht-event-1']);
  });

  it('refuses the void once a real 50 ทวิ has been issued to the payee', async () => {
    // A legal document is in the payee's hands. Voiding underneath it would leave the system
    // disagreeing with a certificate the RD has — that needs a person, not a status flip.
    await assert.rejects(() => voidIt(fixture({ withheld: true, certificateLinked: true })),
      /wht_certificate_linked_requires_review/);
  });

  it('refuses the void once the withholding has been filed', async () => {
    await assert.rejects(() => voidIt(fixture({ withheld: true, whtPeriodStatus: 'FILED' })),
      /wht_tax_period_locked_requires_amendment/);
  });

  it('still cancels nothing and reverses nothing when no tax was withheld', async () => {
    const f = fixture();
    await voidIt(f);
    assert.equal(f.whtEventStatus, undefined);
    assert.ok(!f.adjustments.some((row) => row.metadataJson?.kind === 'WHT_PAYMENT_REVERSAL'));
    // A payment that withheld nothing can have no handoff, so the cancel statement never runs.
    assert.equal(f.handoffUpdate, undefined);
  });
});

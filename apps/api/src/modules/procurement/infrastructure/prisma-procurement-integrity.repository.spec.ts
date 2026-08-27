import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaProcurementRepository } from './prisma-procurement.repository.js';
import { vendorBillTaxSourceChecksum } from '../domain/logic/procurement.logic.js';

const payment = {
  supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-07-14'), method: 'BANK_TRANSFER', currency: 'THB',
  grossAmount: '100', netPaidAmount: '100', allocations: [{ vendorBillId: 'bill-1', amount: '100' }],
};

const billRow = () => ({
  id: 'bill-1', companyId: 'company-1', branchId: null, status: 'PENDING_APPROVAL', supplierId: 'supplier-1',
  billDate: new Date('2026-07-10'), dueDate: new Date('2026-08-10'), currency: 'THB', vatMode: 'VAT_EXCLUDED',
  subtotalAmount: '100', discountAmount: '0', taxableAmount: '100', vatAmount: '7', inputVatClaimStatus: 'CLAIMABLE',
  whtAmount: '0', grandTotalAmount: '107', netPayableAmount: '107', paidAmount: '0', outstandingAmount: '107',
  matchingMode: 'NONE', matchingStatus: 'NOT_REQUIRED', matchingVarianceAmount: '0', pp36Candidate: false,
  taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-10'), attachmentId: 'attachment-1',
  taxEvidenceRequired: true, taxEvidenceReviewStatus: 'VERIFIED', taxReviewIssuesJson: [],
  createdByUserId: 'maker-1', createdAt: new Date('2026-07-10T08:00:00Z'), updatedAt: new Date('2026-07-10T09:00:00Z'),
  postingStatus: 'pending', taxSyncStatus: 'pending',
  lines: [{
    id: 'line-1', companyId: 'company-1', vendorBillId: 'bill-1', lineNumber: 1, lineType: 'SERVICE', description: 'service',
    quantity: '1', unitPrice: '100', discountAmount: '0', vatMode: 'VAT_EXCLUDED', vatRate: '7', vatAmount: '7',
    inputVatClaimStatus: 'CLAIMABLE', whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '107',
    taxCodeDefinitionId: 'def-1', externalTaxCodeSnapshot: 'V1', taxProfileKeySnapshot: 'SAP_S4_TH_CURRENT', taxProfileVersionSnapshot: 1,
    taxRegimeSnapshot: 'VAT', taxDirectionSnapshot: 'INPUT', taxTreatmentSnapshot: 'CLAIMABLE', taxContextSnapshot: 'DOMESTIC_PURCHASE',
    taxRateSnapshot: '7', sourceCurrencySnapshot: 'THB', taxCurrencySnapshot: 'THB', exchangeRateSnapshot: '1',
    exchangeRateSourceSnapshot: 'FUNCTIONAL_CURRENCY', exchangeRateDateSnapshot: new Date('2026-07-10'), taxBaseAmount: '100',
    transactionTaxAmount: '7', claimabilitySnapshot: 'CLAIMABLE', accountRuleVersionSnapshot: 1, reportRuleVersionSnapshot: 1,
    taxEvidenceReviewStatus: 'VERIFIED', taxComponentsJson: [{}], createdAt: new Date('2026-07-10T08:00:00Z'), updatedAt: new Date('2026-07-10T09:00:00Z'),
  }],
});

const domesticPreview = () => ({
  snapshot: {
    taxCodeDefinitionId: 'def-1', externalTaxCode: 'V1', taxProfileKey: 'SAP_S4_TH_CURRENT', taxProfileVersion: 1,
    taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'CLAIMABLE', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7',
    sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-10',
    taxBaseAmount: '100', taxAmount: '7', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
    evidenceRefs: ['trade-evidence-1'],
  },
  components: [{ componentKey: 'VAT', accountAssignments: [], reportContributions: [{ formType: 'PP30', boxKey: 'box_7_input_tax', amount: '7', amountSource: 'TAX_AMOUNT' }] }],
  accountRole: null, accountId: null, reportContributions: [], warnings: [], errors: [], sourceChecksum: 'source', configurationChecksum: 'config',
}) as any;

describe('PrismaProcurementRepository AP transaction integrity', () => {
  it('claims an approved purchase request atomically when creating its purchase order', async () => {
    let isolationLevel: string | undefined;
    let created = false;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown, options: any) => {
        isolationLevel = options?.isolationLevel;
        return fn(client);
      },
      purchaseOrder: { create: async () => { created = true; return { id: 'po-1' }; } },
      purchaseRequest: {
        findFirst: async () => ({ branchId: 'branch-1', supplierId: 'supplier-1', currency: 'THB', lines: [{ id: 'pr-line-1' }] }),
        updateMany: async () => ({ count: 0 }),
      },
    };
    await assert.rejects(() => new PrismaProcurementRepository({ client } as any).createPurchaseOrder('company-1', {
      supplierId: 'supplier-1', branchId: 'branch-1', orderDate: new Date('2026-08-10'), sourcePurchaseRequestId: 'pr-1',
      subtotalAmount: '100', discountAmount: '0', taxableAmount: '100', vatAmount: '0', grandTotalAmount: '100', outstandingAmount: '100',
      lines: [{ lineNumber: 1, description: 'service', orderedQuantity: '1', unitPrice: '100', discountAmount: '0', vatMode: 'NO_VAT', vatAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100', sourcePurchaseRequestLineId: 'pr-line-1' }],
    }, 'buyer-1'), /purchase_request_conversion_conflict/);
    assert.equal(created, true);
    assert.equal(isolationLevel, 'Serializable');
  });

  it('rechecks vendor bill supplier and PO references inside the create transaction', async () => {
    let created = false;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => ({ id: 'supplier-1' }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      purchaseOrder: { findFirst: async () => null },
      vendorBill: { create: async () => { created = true; } },
    };
    await assert.rejects(() => new PrismaProcurementRepository({ client } as any).createVendorBill('company-1', {
      supplierId: 'supplier-1', branchId: 'branch-1', purchaseOrderId: 'po-1', billDate: new Date(), dueDate: new Date(), currency: 'THB',
      subtotalAmount: '100', discountAmount: '0', taxableAmount: '100', vatAmount: '0', whtAmount: '0', grandTotalAmount: '100', netPayableAmount: '100',
      lines: [{ lineNumber: 1, description: 'item', quantity: '1', unitPrice: '100', discountAmount: '0', vatMode: 'NO_VAT', vatAmount: '0', whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100', purchaseOrderLineId: 'po-line-1' }],
    }, 'user-1'), /purchase_order_reference_changed/);
    assert.equal(created, false);
  });

  it('rechecks active supplier/company before creating a supplier payment', async () => {
    let created = false;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => null },
      supplierPayment: { create: async () => { created = true; } },
    };
    await assert.rejects(
      () => new PrismaProcurementRepository({ client } as any).createSupplierPayment('company-1', payment, 'user-1'),
      /supplier_not_active_or_outside_company/,
    );
    assert.equal(created, false);
  });

  it('rechecks bill supplier, branch, and currency inside the payment transaction', async () => {
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => ({ id: 'supplier-1' }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      supplierPayment: { create: async () => ({ id: 'payment-1' }) },
      vendorBill: { findFirst: async () => ({ id: 'bill-1', supplierId: 'supplier-2', branchId: 'branch-1', currency: 'THB', status: 'APPROVED', outstandingAmount: '100', paidAmount: '0' }) },
    };
    await assert.rejects(
      () => new PrismaProcurementRepository({ client } as any).createSupplierPayment('company-1', payment, 'user-1'),
      /vendor_bill_supplier_mismatch/,
    );
  });

  it('re-rounds outstanding to satang inside the payment transaction so pre-policy residue settles as PAID (spec §19d)', async () => {
    let update: any;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => ({ id: 'supplier-1' }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      supplierPayment: { create: async () => ({
        id: 'payment-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'RECORDED',
        paymentDate: new Date('2026-07-14'), method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '100', whtAmount: '0',
        netPaidAmount: '100', allocatedAmount: '100', unappliedAmount: '0', postingStatus: 'pending', taxSyncStatus: 'pending',
        createdByUserId: 'user-1', createdAt: new Date('2026-07-14'), updatedAt: new Date('2026-07-14'), allocations: [],
      }) },
      vendorBill: {
        findFirst: async () => ({ id: 'bill-1', supplierId: 'supplier-1', branchId: 'branch-1', currency: 'THB', status: 'APPROVED', outstandingAmount: '100.0042', paidAmount: '0', lines: [] }),
        update: async (args: any) => { update = args; },
      },
    };
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment('company-1', payment, 'user-1');
    assert.equal(update.data.paidAmount, '100.0000');
    assert.equal(update.data.outstandingAmount, '0.0000');
    assert.equal(update.data.status, 'PAID');
  });

  it('rejects an allocation more than half a satang over outstanding inside the payment transaction', async () => {
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => ({ id: 'supplier-1' }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      supplierPayment: { create: async () => ({ id: 'payment-1' }) },
      vendorBill: {
        findFirst: async () => ({ id: 'bill-1', supplierId: 'supplier-1', branchId: 'branch-1', currency: 'THB', status: 'APPROVED', outstandingAmount: '100', paidAmount: '0', lines: [] }),
        update: async () => assert.fail('an overpaid allocation must not mutate the bill'),
      },
    };
    await assert.rejects(() => new PrismaProcurementRepository({ client } as any).createSupplierPayment('company-1', {
      ...payment, grossAmount: '100.01', netPaidAmount: '100.01', allocations: [{ vendorBillId: 'bill-1', amount: '100.01' }],
    }, 'user-1'), /vendor_bill_allocation_conflict/);
  });

  it('uses serializable payment mutation and rejects PP36 recognition calculated from stale cumulative bill state', async () => {
    let isolationLevel: string | undefined;
    const row: any = { ...billRow(), status: 'PARTIALLY_PAID', pp36Candidate: true, branchId: 'branch-1', paidAmount: '1', outstandingAmount: '106' };
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown, options: any) => { isolationLevel = options?.isolationLevel; return fn(client); },
      supplierProfile: { findFirst: async () => ({ id: 'supplier-1' }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      supplierPayment: { create: async () => ({ id: 'payment-1', allocations: [{ id: 'allocation-1', vendorBillId: 'bill-1' }] }) },
      vendorBill: { findFirst: async () => row, update: async () => assert.fail('stale recognition must fail before balance mutation') },
    };
    await assert.rejects(() => new PrismaProcurementRepository({ client } as any).createSupplierPayment('company-1', {
      ...payment, grossAmount: '1', netPaidAmount: '1', allocations: [{ vendorBillId: 'bill-1', amount: '1' }],
    }, 'user-1', [{
      vendorBillId: 'bill-1', lineId: 'line-1', sourceTaxBaseAmount: '1', evidenceIds: ['evidence-1'], preview: {} as any,
      expectedBillPaidAmount: '0', expectedBillOutstandingAmount: '107', expectedBillTaxSourceChecksum: 'stale',
    }]), /pp36_recognition_source_changed/);
    assert.equal(isolationLevel, 'Serializable');
  });

  it('returns the existing payment on an idempotent payment-number retry without duplicating recognition', async () => {
    let transactionCalls = 0;
    const existing = {
      id: 'payment-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'RECORDED', paymentNumber: 'PAY-1',
      paymentDate: new Date('2026-07-14'), method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '100', whtAmount: '0',
      netPaidAmount: '100', allocatedAmount: '100', unappliedAmount: '0', postingStatus: 'pending', taxSyncStatus: 'pending',
      createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(), allocations: [],
    };
    const client: any = {
      supplierPayment: { findFirst: async () => existing },
      $transaction: async () => { transactionCalls++; throw new Error('must not create twice'); },
    };
    const result = await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', { ...payment, paymentNumber: 'PAY-1' }, 'user-1',
    );
    assert.equal(result.id, 'payment-1');
    assert.equal(transactionCalls, 0);
  });

  it('bridges verified vendor-bill tax-invoice review to verified TradeTaxEvidence', async () => {
    const row = billRow();
    let upsert: any;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      vendorBill: {
        findFirst: async () => ({ id: row.id }),
        update: async () => row,
        findUnique: async () => row,
      },
      vendorBillLine: { updateMany: async () => ({ count: 1 }) },
      attachmentObject: { findFirst: async () => ({ id: 'attachment-1' }) },
      // findFirst: the signature library and document attachments may never share bytes, so the
      // link write first asks whether these already belong to the other world.
      attachmentLink: { findFirst: async () => null, createMany: async () => ({ count: 1 }) },
      tradeTaxEvidence: {
        upsert: async (args: any) => { upsert = args; return { id: 'trade-evidence-1' }; },
        updateMany: async () => ({ count: 0 }),
      },
    };
    await new PrismaProcurementRepository({ client } as any).updateVendorBillTaxEvidenceState('company-1', 'bill-1', {
      taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-10'), attachmentId: 'attachment-1',
      taxEvidenceRequired: true, taxEvidenceReviewStatus: 'VERIFIED', reviewIssues: [],
      taxEvidenceReviewedByUserId: 'reviewer-1', taxEvidenceReviewedAt: new Date('2026-07-10T10:00:00Z'), updatedByUserId: 'reviewer-1',
    });
    assert.equal(upsert.create.evidenceType, 'TAX_INVOICE');
    assert.equal(upsert.create.sourceType, 'procurement.vendor_bill');
    assert.equal(upsert.create.sourceLineId, null);
    assert.equal(upsert.create.status, 'VERIFIED');
    assert.deepEqual(upsert.create.attachmentIdsJson, ['attachment-1']);
  });

  it('writes final tax snapshots and APPROVED status in one CAS transaction after an open-period recheck', async () => {
    const row: any = billRow();
    const operations: string[] = [];
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      vendorBill: {
        findFirst: async () => row,
        updateMany: async () => { operations.push('status'); row.status = 'APPROVED'; return { count: 1 }; },
        findFirstOrThrow: async () => row,
        findUnique: async () => row,
      },
      vendorBillLine: { updateMany: async () => { operations.push('snapshot'); return { count: 1 }; } },
      tradeTaxEvidence: { findMany: async () => [{
        id: 'trade-evidence-1', status: 'VERIFIED', sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: null,
        transactionContext: 'DOMESTIC_PURCHASE', branchId: null, evidenceType: 'TAX_INVOICE', attachmentIdsJson: ['attachment-1'],
      }] },
      attachmentObject: { findFirst: async () => ({ id: 'attachment-1' }) },
      taxPeriod: { findMany: async () => [{ formType: 'PP30', status: 'OPEN' }] },
    };
    const repo = new PrismaProcurementRepository({ client } as any);
    const current = await repo.findVendorBillById('company-1', 'bill-1');
    const result = await repo.finalizeVendorBillApprovalCas({
      companyId: 'company-1', id: 'bill-1', expectedStatus: 'PENDING_APPROVAL', expectedUpdatedAt: row.updatedAt,
      expectedSourceChecksum: vendorBillTaxSourceChecksum(current!), actorUserId: 'approver-1', approvedAt: new Date('2026-07-10T11:00:00Z'),
    }, async () => [{ lineId: 'line-1', preview: domesticPreview() }]);
    assert.deepEqual(operations, ['snapshot', 'status']);
    assert.equal(result.bill.status, 'APPROVED');
  });

  it('does not write a snapshot or approval when the PP30 period is already filed', async () => {
    const row = billRow();
    let writes = 0;
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      vendorBill: { findFirst: async () => row, findUnique: async () => row, updateMany: async () => { writes++; return { count: 1 }; } },
      vendorBillLine: { updateMany: async () => { writes++; return { count: 1 }; } },
      tradeTaxEvidence: { findMany: async () => [{
        id: 'trade-evidence-1', sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: null,
        transactionContext: 'DOMESTIC_PURCHASE', branchId: null, evidenceType: 'TAX_INVOICE', attachmentIdsJson: ['attachment-1'],
      }] },
      attachmentObject: { findFirst: async () => ({ id: 'attachment-1' }) },
      taxPeriod: { findMany: async () => [{ formType: 'PP30', status: 'FILED' }] },
    };
    const repo = new PrismaProcurementRepository({ client } as any);
    const current = await repo.findVendorBillById('company-1', 'bill-1');
    await assert.rejects(() => repo.finalizeVendorBillApprovalCas({
      companyId: 'company-1', id: 'bill-1', expectedStatus: 'PENDING_APPROVAL', expectedUpdatedAt: row.updatedAt,
      expectedSourceChecksum: vendorBillTaxSourceChecksum(current!), actorUserId: 'approver-1', approvedAt: new Date('2026-07-10T11:00:00Z'),
    }, async () => [{ lineId: 'line-1', preview: domesticPreview() }]), /vendor_bill_approval_tax_period_locked/);
    assert.equal(writes, 0);
  });

  it('fails the final mutation CAS on stale source status, version, or checksum', async () => {
    for (const stale of ['status', 'version', 'checksum'] as const) {
      const row = billRow();
      if (stale === 'status') row.status = 'NEEDS_REVIEW';
      let writes = 0;
      const client: any = {
        $transaction: async (fn: (tx: any) => unknown) => fn(client),
        vendorBill: { findFirst: async () => row, updateMany: async () => { writes++; return { count: 1 }; } },
        vendorBillLine: { updateMany: async () => { writes++; return { count: 1 }; } },
      };
      const repo = new PrismaProcurementRepository({ client } as any);
      await assert.rejects(() => repo.finalizeVendorBillApprovalCas({
        companyId: 'company-1', id: 'bill-1', expectedStatus: 'PENDING_APPROVAL',
        expectedUpdatedAt: stale === 'version' ? new Date('2026-07-10T09:01:00Z') : row.updatedAt,
        expectedSourceChecksum: stale === 'checksum' ? 'stale' : vendorBillTaxSourceChecksum((repo as any).toVendorBillRecord(row)),
        actorUserId: 'approver-1', approvedAt: new Date('2026-07-10T11:00:00Z'),
      }, async () => []), new RegExp(`vendor_bill_approval_source_${stale}_changed`));
      assert.equal(writes, 0);
    }
  });

  // H4: a settled payment that withheld tax owes the payee a 50 ทวิ. While the SYSTEM route is
  // CLOSED the system issues nothing, so the obligation is recorded as a durable handoff written
  // in the SAME transaction as the settlement.
  const settlementClient = (handoffs: any[], billStatus = 'APPROVED') => {
    const client: any = {
      $transaction: async (fn: (tx: any) => unknown) => fn(client),
      supplierProfile: { findFirst: async () => ({
        id: 'supplier-1', supplierType: 'JURISTIC_PERSON', displayNameSnapshot: 'ผู้ขาย',
        legalNameSnapshot: 'บริษัท ผู้ขาย จำกัด', taxId: '1234567890123', branchCode: '00000', addressJson: { line1: 'x' },
      }) },
      branch: { findFirst: async () => ({ id: 'branch-1' }) },
      supplierBankAccount: { findFirst: async () => ({ id: 'acct-1' }) },
      company: { findUnique: async () => ({ name: 'ผู้จ่าย', registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', addressJson: null }) },
      // `allocations` last on purpose: the create payload carries a nested `{ create: [...] }`
      // writer, while the returned row must expose the persisted array.
      supplierPayment: { create: async ({ data }: any) => ({ id: 'pay-1', ...data, allocations: [] }) },
      vendorBill: {
        findFirst: async () => ({ id: 'bill-1', companyId: 'company-1', branchId: 'branch-1', status: billStatus, supplierId: 'supplier-1', currency: 'THB', paidAmount: '0', outstandingAmount: '100', lines: [] }),
        update: async () => undefined,
      },
      whtCertificateHandoff: { create: async ({ data }: any) => { handoffs.push(data); return { id: 'handoff-1', ...data }; } },
    };
    return client;
  };

  const withholdingPayment = {
    supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-07-14'), method: 'BANK_TRANSFER', currency: 'THB',
    grossAmount: '100', whtAmount: '3', netPaidAmount: '97', allocations: [{ vendorBillId: 'bill-1', amount: '97' }],
  };

  it('records a prefilled 50 ทวิ handoff in the settlement transaction when SYSTEM issuance is closed', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', withholdingPayment as any, 'user-1', [], { whtSystemIssuanceOpen: false },
    );
    assert.equal(handoffs.length, 1);
    const handoff = handoffs[0];
    assert.equal(handoff.status, 'REQUIRED');
    assert.equal(handoff.sourcePaymentType, 'procurement.supplier_payment');
    assert.equal(handoff.sourcePaymentId, 'pay-1');
    assert.equal(handoff.payeeId, 'supplier-1');
    assert.equal(handoff.sourceFeatureKey, 'procurement');
    assert.equal(handoff.companyId, 'company-1');
    // Flat scalar, never a nested relation create (Prisma-7 compound-FK trap).
    assert.equal(handoff.company, undefined);
    // Prefilled from what the system genuinely holds.
    assert.equal(handoff.prefillSnapshotJson.payeeSnapshot.name, 'บริษัท ผู้ขาย จำกัด');
    assert.equal(handoff.prefillSnapshotJson.payeeSnapshot.taxId, '1234567890123');
    assert.equal(handoff.prefillSnapshotJson.payerSnapshot.companyName, 'บริษัท ผู้จ่าย จำกัด');
    assert.equal(handoff.prefillSnapshotJson.withheldAmount, '3');
    assert.equal(handoff.prefillSnapshotJson.formType, 'PND53', 'juristic payee maps to PND53');
    // Never fabricated: the payment header does not carry the withholding category or rate.
    assert.equal(handoff.prefillSnapshotJson.incomeCategoryCode, null);
    assert.equal(handoff.prefillSnapshotJson.whtRate, null);
  });

  it('maps an individual payee to PND3', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    client.supplierProfile.findFirst = async () => ({ id: 'supplier-1', supplierType: 'INDIVIDUAL', displayNameSnapshot: 'นาย ก', legalNameSnapshot: null, taxId: '1', branchCode: null, addressJson: null });
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', withholdingPayment as any, 'user-1', [], { whtSystemIssuanceOpen: false },
    );
    assert.equal(handoffs[0].prefillSnapshotJson.formType, 'PND3');
    assert.equal(handoffs[0].prefillSnapshotJson.payeeSnapshot.name, 'นาย ก');
  });

  it('leaves the form unresolved rather than guessing for a payee class that maps to neither form', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    client.supplierProfile.findFirst = async () => ({ id: 'supplier-1', supplierType: 'FOREIGN', displayNameSnapshot: 'X Ltd', legalNameSnapshot: null, taxId: null, branchCode: null, addressJson: null });
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', withholdingPayment as any, 'user-1', [], { whtSystemIssuanceOpen: false },
    );
    assert.equal(handoffs[0].prefillSnapshotJson.formType, null);
  });

  it('creates no handoff when the payment withheld nothing', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', { ...withholdingPayment, whtAmount: '0', netPaidAmount: '100', allocations: [{ vendorBillId: 'bill-1', amount: '100' }] } as any,
      'user-1', [], { whtSystemIssuanceOpen: false },
    );
    assert.equal(handoffs.length, 0);
  });

  it('creates no handoff when the SYSTEM route is open (the system issues the certificate itself)', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', withholdingPayment as any, 'user-1', [], { whtSystemIssuanceOpen: true },
    );
    assert.equal(handoffs.length, 0);
  });

  it('settles the payment even though the closed route blocked certificate issuance', async () => {
    const handoffs: any[] = [];
    const client = settlementClient(handoffs);
    const result = await new PrismaProcurementRepository({ client } as any).createSupplierPayment(
      'company-1', withholdingPayment as any, 'user-1', [], { whtSystemIssuanceOpen: false },
    );
    // spec:299 — a closed 50 ทวิ route must never block the payment itself.
    assert.equal(result.id, 'pay-1');
    assert.equal(result.status, 'RECORDED');
    assert.equal(handoffs.length, 1);
  });
});

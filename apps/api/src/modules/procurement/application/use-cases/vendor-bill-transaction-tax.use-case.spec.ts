import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authoritativeVendorBillLine, buildVendorBillPostingSource, buildVendorBillPp36PostingSource, ApproveVendorBillUseCase, ReviewVendorBillTaxEvidenceUseCase, SubmitVendorBillUseCase } from './vendor-bill.use-case.js';
import { CreateSupplierPaymentUseCase } from './supplier-payment.use-case.js';
import type { ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case.js';

function pp36Preview(recognitionDate?: string): ResolveTransactionTaxPreviewDto {
  const snapshot = {
    taxCodeDefinitionId: 'pp36-definition', externalTaxCode: 'I7', taxProfileKey: 'S4_TH', taxProfileVersion: 1,
    taxRegime: 'VAT' as const, taxDirection: 'SELF_ASSESSED' as const, taxTreatment: 'REVERSE_CHARGE' as const,
    taxContext: 'IMPORT_SERVICE' as const, taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-01',
    taxBaseAmount: '100.00', taxAmount: '7.00',
    roundingMode: 'HALF_UP' as const, roundingScale: 2, taxAmountTolerance: '0.01',
    claimability: 'CLAIMABLE' as const, evidenceStatus: 'VERIFIED' as const, accountRuleVersion: 1, reportRuleVersion: 1,
    recognitionDate,
  };
  const components = [
    { componentKey: 'PP36_OUTPUT' as const, snapshot, accountRole: 'PP36_OUTPUT_VAT_PAYABLE' as const, accountId: 'out', accountAssignments: [{ accountRole: 'PP36_OUTPUT_VAT_PAYABLE' as const, accountId: 'out', postingSide: 'CREDIT' as const, ruleVersion: 1 }], reportContributions: [] },
    { componentKey: 'PP36_INPUT' as const, snapshot, accountRole: 'PP36_INPUT_VAT_CLAIMABLE' as const, accountId: 'in', accountAssignments: [{ accountRole: 'PP36_INPUT_VAT_CLAIMABLE' as const, accountId: 'in', postingSide: 'DEBIT' as const, ruleVersion: 1 }], reportContributions: [] },
  ];
  return { components, snapshot, accountRole: null, accountId: null, reportContributions: [], warnings: [], errors: [], sourceChecksum: 's', configurationChecksum: 'c' };
}

describe('vendor bill server-authoritative totals', () => {
  it('keeps imported service payable at 100 while PP36 7 remains in paired tax components', () => {
    const line = authoritativeVendorBillLine({ quantity: '1', unitPrice: '100' }, pp36Preview(), 'IMPORT_SERVICE');
    assert.equal(line.lineSubtotalAmount, '100.0000');
    assert.equal(line.vatAmount, '0.0000');
    assert.equal(line.lineTotalAmount, '100.0000');
    assert.equal(pp36Preview().components[0]?.snapshot.taxAmount, '7.00');
  });

  it('ignores forged client line totals and derives domestic VAT from the server preview', () => {
    const preview = pp36Preview();
    preview.snapshot.taxContext = 'DOMESTIC_PURCHASE';
    preview.components = [{ ...preview.components[0]!, componentKey: 'VAT' }];
    const line = authoritativeVendorBillLine({
      quantity: '1', unitPrice: '100', vatAmount: '9999', lineTotalAmount: '9999', discountAmount: '0',
    }, preview, 'DOMESTIC_PURCHASE');
    assert.equal(line.vatAmount, '7.0000');
    assert.equal(line.lineTotalAmount, '107.0000');
  });

  it('separates commercial bill-date posting from PP36 payment-period posting', () => {
    const preview = pp36Preview('2026-08-15T00:00:00.000Z');
    const bill = {
      id: 'bill-1', companyId: 'company-1', branchId: 'branch-1', supplierId: 'supplier-1', status: 'PAID',
      pp36Candidate: true, billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB',
      grandTotalAmount: '100', vatAmount: '0', whtAmount: '0', paidAmount: '100',
      lines: [{ id: 'line-1', description: 'foreign service', quantity: '1', lineSubtotalAmount: '100', lineTotalAmount: '100', vatAmount: '0', whtAmount: '0', taxSnapshot: preview.snapshot, taxComponents: preview.components }],
    } as any;
    const commercial = buildVendorBillPostingSource(bill);
    assert.equal(commercial.sourceType, 'procurement.vendor_bill.commercial');
    assert.equal(commercial.periodKey, '2026-07');
    assert.deepEqual(commercial.lines[0]?.taxComponents, []);
    const pp36 = buildVendorBillPp36PostingSource(bill);
    assert.equal(pp36.sourceType, 'procurement.vendor_bill');
    assert.equal(pp36.sourceEventType, 'procurement.vendor_bill.pp36_payment');
    assert.equal(pp36.periodKey, '2026-08');
    assert.equal(pp36.lines[0]?.sourceLineId, 'line-1');
    assert.deepEqual(pp36.lines[0]?.taxComponents.map((component) => component.componentKey), ['PP36_OUTPUT', 'PP36_INPUT']);
  });

  it('fails closed when PP36 and domestic tax contexts are mixed on one bill', () => {
    const pp36 = pp36Preview();
    const domestic = pp36Preview();
    domestic.snapshot.taxContext = 'DOMESTIC_PURCHASE';
    const bill = {
      id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'APPROVED', pp36Candidate: true,
      billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB', grandTotalAmount: '200', vatAmount: '7', whtAmount: '0', paidAmount: '0',
      lines: [{ id: 'line-1', lineSubtotalAmount: '100', vatAmount: '0', whtAmount: '0', taxSnapshot: pp36.snapshot, taxComponents: pp36.components },
        { id: 'line-2', lineSubtotalAmount: '100', vatAmount: '7', whtAmount: '0', taxSnapshot: domestic.snapshot, taxComponents: [] }],
    } as any;
    assert.throws(() => buildVendorBillPostingSource(bill), (error: any) => error?.getResponse?.().code === 'pp36_mixed_context_not_supported');
  });

  it('approves imported-service bills without finalizing PP36 at bill date', async () => {
    const preview = pp36Preview();
    let resolveCalls = 0;
    const bill = {
      id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'PENDING_APPROVAL', matchingMode: 'NONE',
      pp36Candidate: true, billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB', netPayableAmount: '100',
      updatedAt: new Date('2026-07-10T09:00:00.000Z'),
      lines: [{ id: 'line-1', vatAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100', taxSnapshot: preview.snapshot, taxComponents: preview.components }],
    } as any;
    const repo = {
      findVendorBillById: async () => bill,
      saveVendorBillLineTaxSnapshots: async () => assert.fail('approval must not finalize PP36'),
      finalizeVendorBillApprovalCas: async (_input: any, finalizeTax: any) => {
        const finalized = await finalizeTax({ db: {}, bill });
        assert.deepEqual(finalized, []);
        return { bill: { ...bill, status: 'APPROVED' }, finalized };
      },
      appendPurchaseApprovalEvent: async () => undefined,
      getProcurementApprovalPolicy: async () => null,
      listPurchaseApprovalEvents: async () => [{ action: 'SUBMITTED', actorUserId: 'maker-1', createdAt: new Date() }],
    };
    const useCase = new ApproveVendorBillUseCase(repo as any, { log: () => undefined } as any, { append: () => undefined } as any, {
      listVerifiedEvidenceIdsForSource: async () => [], resolveSourceTax: async () => { resolveCalls++; return preview; },
    } as any);
    const result = await useCase.execute({ companyId: 'company-1', userId: 'approver-1', permissions: ['procurement.vendor_bill.approve'] } as any, 'bill-1');
    assert.equal(result.status, 'APPROVED');
    assert.equal(resolveCalls, 0);
  });

  it('blocks submit and approval when claimable domestic VAT evidence is incomplete or no longer active', async () => {
    const snapshot = pp36Preview().snapshot;
    snapshot.taxContext = 'DOMESTIC_PURCHASE';
    snapshot.taxDirection = 'INPUT';
    const baseBill = {
      id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'NEEDS_REVIEW', matchingMode: 'NONE',
      pp36Candidate: false, billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB', vatAmount: '7',
      inputVatClaimStatus: 'NEEDS_REVIEW', taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', reviewIssues: [],
      netPayableAmount: '107', grandTotalAmount: '107',
      lines: [{ id: 'line-1', vatAmount: '7', lineSubtotalAmount: '100', lineTotalAmount: '107', inputVatClaimStatus: 'NEEDS_REVIEW', taxSnapshot: snapshot, taxComponents: [{ componentKey: 'VAT', snapshot }] }],
    } as any;
    const persisted: any[] = [];
    const repo = {
      findVendorBillById: async () => baseBill,
      findSupplierById: async () => ({ id: 'supplier-1', taxId: '0100000000001', vatRegistered: true }),
      isActiveVendorBillAttachment: async () => false,
      updateVendorBillTaxEvidenceState: async (_companyId: string, _id: string, data: any) => { persisted.push(data); return { ...baseBill, ...data }; },
      getProcurementApprovalPolicy: async () => null,
      listPurchaseApprovalEvents: async () => [{ action: 'SUBMITTED', actorUserId: 'maker-1', createdAt: new Date() }],
    };
    const submit = new SubmitVendorBillUseCase(
      repo as any, { log: () => undefined } as any, { append: () => undefined } as any,
      { execute: async () => assert.fail('number must not be reserved while evidence is blocked') } as any,
      { execute: async () => undefined } as any,
    );
    await assert.rejects(() => submit.execute({ companyId: 'company-1', userId: 'maker-1', permissions: ['procurement.vendor_bill.create'] } as any, 'bill-1'),
      (error: any) => error?.getResponse?.().code === 'vendor_bill_tax_evidence_blocked');
    assert.ok(persisted[0].reviewIssues.includes('missing_active_tax_invoice_attachment'));

    baseBill.status = 'PENDING_APPROVAL';
    baseBill.taxInvoiceNumber = 'TAX-001';
    baseBill.taxInvoiceDate = new Date('2026-07-10');
    baseBill.attachmentId = 'attachment-1';
    baseBill.taxEvidenceReviewStatus = 'VERIFIED';
    const approve = new ApproveVendorBillUseCase(repo as any, { log: () => undefined } as any, { append: () => undefined } as any, {
      listVerifiedEvidenceIdsForSource: async () => assert.fail('tax finalization must not run while attachment is inactive'),
    } as any);
    await assert.rejects(() => approve.execute({ companyId: 'company-1', userId: 'approver-1', permissions: ['procurement.vendor_bill.approve'] } as any, 'bill-1'),
      (error: any) => error?.getResponse?.().code === 'vendor_bill_tax_evidence_blocked');
  });

  it('verifies complete domestic VAT evidence and persists reviewer identity', async () => {
    const snapshot = pp36Preview().snapshot;
    snapshot.taxContext = 'DOMESTIC_PURCHASE';
    snapshot.taxDirection = 'INPUT';
    const bill = {
      id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'NEEDS_REVIEW', pp36Candidate: false,
      taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-10'), attachmentId: 'attachment-1',
      vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW', taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', reviewIssues: [],
      lines: [{ id: 'line-1', vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW', taxSnapshot: snapshot }],
    } as any;
    let saved: any;
    const review = new ReviewVendorBillTaxEvidenceUseCase({
      findVendorBillById: async () => bill,
      findSupplierById: async () => ({ id: 'supplier-1', taxId: '0100000000001', vatRegistered: true }),
      isActiveVendorBillAttachment: async () => true,
      updateVendorBillTaxEvidenceState: async (_companyId: string, _id: string, data: any) => { saved = data; return { ...bill, ...data }; },
      getProcurementApprovalPolicy: async () => null,
      listPurchaseApprovalEvents: async () => [{ action: 'SUBMITTED', actorUserId: 'maker-1', createdAt: new Date() }],
    } as any, { log: () => undefined } as any);
    const result = await review.execute({ companyId: 'company-1', userId: 'approver-1', permissions: ['procurement.vendor_bill.approve'] } as any, 'bill-1', 'VERIFIED');
    assert.equal(result.taxEvidenceReviewStatus, 'VERIFIED');
    assert.equal(saved.taxEvidenceReviewedByUserId, 'approver-1');
    assert.deepEqual(saved.reviewIssues, []);
  });

  it('passes a verified TradeTaxEvidence id through the real resolver when approving a domestic bill', async () => {
    const preview = pp36Preview();
    preview.snapshot.taxContext = 'DOMESTIC_PURCHASE';
    preview.snapshot.taxDirection = 'INPUT';
    preview.snapshot.taxTreatment = 'CLAIMABLE';
    preview.components = [{ ...preview.components[0]!, componentKey: 'VAT', snapshot: preview.snapshot }];
    const bill = {
      id: 'bill-1', companyId: 'company-1', supplierId: 'supplier-1', status: 'PENDING_APPROVAL', matchingMode: 'NONE',
      pp36Candidate: false, billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB', vatAmount: '7',
      inputVatClaimStatus: 'CLAIMABLE', taxEvidenceRequired: true, taxEvidenceReviewStatus: 'VERIFIED', reviewIssues: [],
      taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-10'), attachmentId: 'attachment-1', netPayableAmount: '107',
      updatedAt: new Date('2026-07-10T09:00:00.000Z'),
      lines: [{ id: 'line-1', lineNumber: 1, vatAmount: '7', lineSubtotalAmount: '100', lineTotalAmount: '107', inputVatClaimStatus: 'CLAIMABLE', taxSnapshot: preview.snapshot, taxComponents: preview.components, updatedAt: new Date('2026-07-10T09:00:00.000Z') }],
    } as any;
    const auditEntries: any[] = [];
    const outboxEvents: any[] = [];
    let finalizedPreview: ResolveTransactionTaxPreviewDto | undefined;
    const repo = {
      findVendorBillById: async () => bill,
      findSupplierById: async () => ({ id: 'supplier-1', taxId: '0100000000001', vatRegistered: true }),
      isActiveVendorBillAttachment: async () => true,
      updateVendorBillTaxEvidenceState: async () => bill,
      finalizeVendorBillApprovalCas: async (_input: any, finalizeTax: any) => {
        const finalized = await finalizeTax({ db: taxRepo.prisma.client, bill });
        finalizedPreview = finalized[0].preview;
        return { bill: { ...bill, status: 'APPROVED' }, finalized };
      },
      appendPurchaseApprovalEvent: async () => undefined,
      getProcurementApprovalPolicy: async () => null,
      listPurchaseApprovalEvents: async () => [{ action: 'SUBMITTED', actorUserId: 'maker-1', createdAt: new Date() }],
    };
    const evidence = {
      id: 'trade-evidence-1', companyId: 'company-1', status: 'VERIFIED', reviewedByUserId: 'tax-reviewer-1', reviewedAt: new Date('2026-07-10'),
      sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: null, transactionContext: 'DOMESTIC_PURCHASE', branchId: null,
      evidenceType: 'TAX_INVOICE', evidenceDate: new Date('2026-07-10'), attachmentIdsJson: ['attachment-1'],
      customsValue: '0', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '0',
    };
    const profile = { id: 'profile-1', sourceProfileKey: 'SAP_S4_TH_CURRENT', version: 1, roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: '0.01' };
    const definition = {
      id: 'pp36-definition', profileId: profile.id, externalCode: 'I7', taxRegime: 'VAT', direction: 'INPUT', treatment: 'CLAIMABLE',
      transactionContexts: ['DOMESTIC_PURCHASE'], rate: '7', calculationMethod: 'EXCLUSIVE', claimabilityDefault: 'CLAIMABLE',
      evidenceRuleKey: null, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null,
    };
    const accountRule = {
      id: 'account-rule-1', taxCodeDefinitionId: definition.id, taxRegime: 'VAT', direction: 'INPUT', treatment: 'CLAIMABLE',
      transactionContext: 'DOMESTIC_PURCHASE', sourceModule: 'procurement', accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'input-vat',
      postingSide: 'DEBIT', priority: 1, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1,
    };
    const reportRules = [
      { id: 'report-1', taxCodeDefinitionId: definition.id, formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE', signRule: 'NORMAL', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 },
      { id: 'report-2', taxCodeDefinitionId: definition.id, formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', signRule: 'NORMAL', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 },
    ];
    const taxRepo = {
      prisma: { client: {
        company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
        tradeTaxEvidence: { findMany: async () => [evidence] },
      } },
      listProfiles: async () => [profile],
      listDefinitions: async () => [definition],
      listAccountRules: async () => [accountRule],
      listReportRules: async () => reportRules,
    };
    const transactionTax = new TransactionTaxConfigUseCase(taxRepo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);
    const approve = new ApproveVendorBillUseCase(
      repo as any,
      { log: async (entry: any) => { auditEntries.push(entry); } } as any,
      { append: async (...args: any[]) => { outboxEvents.push(args); } } as any,
      transactionTax,
    );
    await approve.execute({ companyId: 'company-1', userId: 'approver-1', permissions: ['procurement.vendor_bill.approve'], scopes: {} } as any, 'bill-1');
    const finalized = auditEntries.find((entry) => entry.action === 'tax.document_tax.finalize');
    assert.equal(finalized.metadataJson.periodKey, '2026-07');
    assert.equal(finalized.metadataJson.lines[0].taxContext, 'DOMESTIC_PURCHASE');
    assert.equal(finalized.metadataJson.lines[0].claimability, 'CLAIMABLE');
    assert.equal(finalized.metadataJson.checksum.length, 64);
    assert.deepEqual(finalizedPreview?.snapshot.evidenceRefs, ['trade-evidence-1']);
    assert.notDeepEqual(finalizedPreview?.snapshot.evidenceRefs, ['attachment-1']);
    assert.ok(outboxEvents.some(([eventType]) => eventType === 'tax.document_tax.finalized'));
  });

  it('recognizes three PP36 payments cumulatively and assigns profile-rounded base and tax remainders', async () => {
    const draft = pp36Preview();
    const bill = {
      id: 'bill-1', companyId: 'company-1', branchId: 'branch-1', supplierId: 'supplier-1', status: 'APPROVED', pp36Candidate: true,
      billDate: new Date('2026-07-10T00:00:00.000Z'), currency: 'THB', netPayableAmount: '3', outstandingAmount: '3', paidAmount: '0',
      lines: [{ id: 'line-1', lineSubtotalAmount: '100', lineTotalAmount: '100', taxSnapshot: draft.snapshot, taxComponents: draft.components }],
    } as any;
    const persisted: Array<Array<{ lineId: string; sourceTaxBaseAmount: string; evidenceIds: string[]; preview: ResolveTransactionTaxPreviewDto }>> = [];
    const resolvedBases: string[] = [];
    const recognizedBases: string[] = [];
    const recognizedTaxes: string[] = [];
    const useCase = new CreateSupplierPaymentUseCase(
      {
        resolveCreateBranchId: async (_companyId: string, _scopes: unknown, branchId?: string) => branchId ?? 'branch-1',
        findSupplierPaymentByIdempotencyKey: async () => null,
        findSupplierById: async () => ({ id: 'supplier-1', status: 'ACTIVE' }),
        branchExists: async () => true,
        findVendorBillById: async () => bill,
        findVerifiedPp36PaymentEvidence: async (_companyId: string, _billId: string, _branchId: string, _lineIds: string[], ids: string[]) => ids.map((id) => ({ id })),
        createSupplierPayment: async (_companyId: string, data: any, _userId: string, recognitions: typeof persisted[number]) => {
          persisted.push(recognitions);
          bill.paidAmount = String(Number(bill.paidAmount) + Number(data.netPaidAmount));
          bill.outstandingAmount = String(Number(bill.netPayableAmount) - Number(bill.paidAmount));
          bill.status = Number(bill.outstandingAmount) === 0 ? 'PAID' : 'PARTIALLY_PAID';
          return { id: 'payment-1', ...data, companyId: 'company-1', status: 'RECORDED', allocations: data.allocations };
        },
      } as any,
      { log: () => undefined } as any, { append: () => undefined } as any,
      { execute: async () => ({ id: `reservation-${persisted.length}`, documentNumber: `PAY-${persisted.length}` }) } as any,
      { execute: async () => undefined } as any,
      {
        resolveSourceTax: async (_ctx: any, input: any, mode: string, _profile: any, _direction: any, _module: any, internal: any) => {
          resolvedBases.push(input.netAmount);
          recognizedBases.push(internal.authoritativeSelfAssessedTaxBaseAmount);
          recognizedTaxes.push(internal.authoritativeSelfAssessedTaxAmount);
          assert.equal(internal.historicalSnapshot.taxProfileKey, draft.snapshot.taxProfileKey);
          assert.equal(input.documentDate, '2026-07-10T00:00:00.000Z');
          assert.equal(mode, 'FINAL');
          const finalized = pp36Preview(input.paymentDate);
          finalized.snapshot = { ...finalized.snapshot, taxBaseAmount: internal.authoritativeSelfAssessedTaxBaseAmount, taxAmount: internal.authoritativeSelfAssessedTaxAmount };
          finalized.components = finalized.components.map((component) => ({ ...component, snapshot: { ...component.snapshot, taxBaseAmount: internal.authoritativeSelfAssessedTaxBaseAmount, taxAmount: internal.authoritativeSelfAssessedTaxAmount } }));
          return finalized;
        },
      } as any,
      { isSystemIssuanceOpen: async () => true } as any,
    );
    await useCase.execute({ companyId: 'company-1', userId: 'payer-1', requestId: 'pay-1', permissions: ['procurement.supplier_payment.create', 'procurement.supplier_payment.release'] } as any, {
      supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-08-15T00:00:00.000Z'), method: 'BANK_TRANSFER', currency: 'THB',
      grossAmount: '1', netPaidAmount: '1', allocations: [{ vendorBillId: 'bill-1', amount: '1', pp36PaymentEvidenceIds: ['evidence-1'] }],
    });
    await useCase.execute({ companyId: 'company-1', userId: 'payer-1', requestId: 'pay-2', permissions: ['procurement.supplier_payment.create', 'procurement.supplier_payment.release'] } as any, {
      supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-09-15T00:00:00.000Z'), method: 'BANK_TRANSFER', currency: 'THB',
      grossAmount: '1', netPaidAmount: '1', allocations: [{ vendorBillId: 'bill-1', amount: '1', pp36PaymentEvidenceIds: ['evidence-2'] }],
    });
    await useCase.execute({ companyId: 'company-1', userId: 'payer-1', requestId: 'pay-3', permissions: ['procurement.supplier_payment.create', 'procurement.supplier_payment.release'] } as any, {
      supplierId: 'supplier-1', branchId: 'branch-1', paymentDate: new Date('2026-10-15T00:00:00.000Z'), method: 'BANK_TRANSFER', currency: 'THB',
      grossAmount: '1', netPaidAmount: '1', allocations: [{ vendorBillId: 'bill-1', amount: '1', pp36PaymentEvidenceIds: ['evidence-3'] }],
    });
    assert.deepEqual(resolvedBases, ['33.3333', '33.3334', '33.3333']);
    assert.deepEqual(recognizedBases, ['33.33', '33.34', '33.33']);
    assert.deepEqual(recognizedTaxes, ['2.33', '2.34', '2.33']);
    assert.deepEqual(persisted.map((batch) => batch[0]?.sourceTaxBaseAmount), ['33.3333', '33.3334', '33.3333']);
    assert.deepEqual(persisted.map((batch) => batch[0]?.evidenceIds), [['evidence-1'], ['evidence-2'], ['evidence-3']]);
    assert.equal(persisted[0]?.[0]?.preview.snapshot.recognitionDate, '2026-08-15T00:00:00.000Z');
    assert.equal(persisted[1]?.[0]?.preview.snapshot.recognitionDate, '2026-09-15T00:00:00.000Z');
    assert.equal(persisted[2]?.[0]?.preview.snapshot.recognitionDate, '2026-10-15T00:00:00.000Z');
  });
});

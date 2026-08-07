import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ResolveTransactionTaxPreviewDto, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';
import { ReleasePp36InputVatClaimUseCase } from './pp36-input-claim.use-case.js';

function component(role: 'PP36_OUTPUT_VAT_PAYABLE' | 'INPUT_VAT_PENDING' | 'PP36_INPUT_VAT_CLAIMABLE', evidenceStatus: 'VERIFIED' | 'REVIEW_REQUIRED', claimability: 'NOT_APPLICABLE' | 'PENDING_EVIDENCE' | 'CLAIMABLE'): TransactionTaxComponentPreview {
  const output = role === 'PP36_OUTPUT_VAT_PAYABLE';
  return {
    componentKey: output ? 'PP36_OUTPUT' : 'PP36_INPUT',
    snapshot: {
      taxCodeDefinitionId: 'definition-1', externalTaxCode: 'V3', taxProfileKey: 'S4_TH', taxProfileVersion: 1,
      taxRegime: 'VAT', taxDirection: 'SELF_ASSESSED', taxTreatment: 'REVERSE_CHARGE', taxContext: 'IMPORT_SERVICE',
      taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-08-15',
      taxBaseAmount: '100.00', taxAmount: '7.00', claimability, evidenceStatus,
      accountRuleVersion: role === 'INPUT_VAT_PENDING' ? 2 : 3, reportRuleVersion: 4, recognitionDate: '2026-08-15T00:00:00.000Z', evidenceRefs: ['payment-evidence'],
    },
    accountRole: role, accountId: role === 'PP36_OUTPUT_VAT_PAYABLE' ? 'output-account' : role === 'INPUT_VAT_PENDING' ? 'pending-account' : 'claimable-account',
    accountAssignments: [{ accountRole: role, accountId: role === 'PP36_OUTPUT_VAT_PAYABLE' ? 'output-account' : role === 'INPUT_VAT_PENDING' ? 'pending-account' : 'claimable-account', postingSide: output ? 'CREDIT' : 'DEBIT', ruleVersion: role === 'INPUT_VAT_PENDING' ? 2 : 3 }],
    reportContributions: role === 'PP36_INPUT_VAT_CLAIMABLE' ? [
      { formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE', amount: '100.00' },
      { formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', amount: '7.00' },
    ] : output ? [{ formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT', amount: '7.00' }] : [],
  };
}

function fixture(options: { partialRecognitions?: boolean; foreignCurrency?: boolean; remainderTax?: string } = {}) {
  const output = component('PP36_OUTPUT_VAT_PAYABLE', 'VERIFIED', 'NOT_APPLICABLE');
  const pending = component('INPUT_VAT_PENDING', 'REVIEW_REQUIRED', 'PENDING_EVIDENCE');
  const claimable = component('PP36_INPUT_VAT_CLAIMABLE', 'VERIFIED', 'CLAIMABLE');
  for (const item of [output, pending, claimable]) {
    item.snapshot.roundingMode = 'HALF_EVEN';
    item.snapshot.roundingScale = 2;
    item.snapshot.taxAmountTolerance = '0.01';
    if (options.foreignCurrency) Object.assign(item.snapshot, {
      sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'BANK_PAYMENT', exchangeRateDate: '2026-08-15',
    });
    if (options.remainderTax !== undefined) item.snapshot.taxAmount = options.remainderTax;
  }
  const bill = {
    id: 'bill-1', companyId: 'company-1', branchId: 'branch-1', status: 'PAID', billDate: new Date('2026-07-10'), currency: 'THB',
    lines: [{ id: 'line-1', lineSubtotalAmount: options.partialRecognitions ? '200' : '100', lineTotalAmount: options.partialRecognitions ? '200' : '100', taxComponents: [output, pending] }],
  } as any;
  const evidence = { id: 'receipt-1', evidenceDate: new Date('2026-08-20'), status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date('2026-08-20') };
  let adjustment: any = null;
  let eventData: any = null;
  const adjustments = new Map<string, any>();
  const events: any[] = [];
  let auditCount = 0;
  let auditTx: any;
  let outboxCount = 0;
  let evidenceWhere: any;
  let transactionClient: any;
  let transactionOptions: any;
  let internalResolution: any;
  const allocationRows = options.partialRecognitions ? ['1', '2'].map((suffix) => ({
    supplierPayment: { id: `payment-${suffix}` },
    pp36RecognitionJson: [{
      recognitionKey: `allocation-${suffix}:line-1`, vendorBillLineId: 'line-1', sourceTaxBaseAmount: '100',
      evidenceIds: ['payment-evidence'], preview: { components: [output, pending] },
    }],
  })) : [];
  const db: any = {
    supplierPaymentAllocation: { findMany: async ({ where }: any) => allocationRows.filter((row) => !where.supplierPayment.id || row.supplierPayment.id === where.supplierPayment.id) },
    tradeTaxEvidence: { findFirst: async ({ where }: any) => { evidenceWhere = where; return { ...evidence, id: where.id }; } },
    taxAdjustment: { findFirst: async ({ where }: any) => adjustments.get(where.reason) ?? null },
    $transaction: async (fn: any, options: any) => {
      transactionOptions = options;
      transactionClient = {
      supplierPaymentAllocation: { findMany: async ({ where }: any) => allocationRows.filter((row) => !where.supplierPayment.id || row.supplierPayment.id === where.supplierPayment.id) },
      tradeTaxEvidence: { findFirst: async ({ where }: any) => { evidenceWhere = where; return { ...evidence, id: where.id }; } },
      taxPeriod: { upsert: async () => ({ id: 'period-1', status: 'OPEN' }) },
      taxAdjustment: { findFirst: async ({ where }: any) => adjustments.get(where.reason) ?? null, create: async ({ data }: any) => {
        adjustment = { id: `adjustment-${adjustments.size + 1}`, companyId: 'company-1', ...data };
        adjustments.set(data.reason, adjustment);
        return adjustment;
      } },
      taxEvent: { create: async ({ data }: any) => { eventData = data; events.push(data); return { id: `event-${events.length}` }; } },
      };
      return fn(transactionClient);
    },
  };
  const preview: ResolveTransactionTaxPreviewDto = { components: [output, claimable], snapshot: claimable.snapshot,
    accountRole: null, accountId: null, reportContributions: claimable.reportContributions, warnings: [], errors: [], sourceChecksum: 's', configurationChecksum: 'c' };
  const useCase = new ReleasePp36InputVatClaimUseCase(
    { client: db } as any,
    { findVendorBillById: async () => bill } as any,
    { listVerifiedEvidenceIdsForSource: async () => ['payment-evidence', 'receipt-1'], resolveSourceTaxInTransaction: async (...args: any[]) => {
      internalResolution = args[7];
      const resolved = structuredClone(preview);
      resolved.snapshot.taxBaseAmount = internalResolution.authoritativeSelfAssessedTaxBaseAmount;
      resolved.snapshot.taxAmount = internalResolution.authoritativeSelfAssessedTaxAmount;
      resolved.components = resolved.components.map((item: any) => ({ ...item, snapshot: {
        ...item.snapshot, taxBaseAmount: internalResolution.authoritativeSelfAssessedTaxBaseAmount, taxAmount: internalResolution.authoritativeSelfAssessedTaxAmount,
      } }));
      return resolved;
    } } as any,
    { log: async (_entry: any, tx?: any) => { auditCount++; auditTx = tx; } } as any,
    { append: async () => { outboxCount++; } } as any,
  );
  return { useCase, db, evidence, events, get evidenceWhere() { return evidenceWhere; }, get adjustment() { return adjustment; }, get eventData() { return eventData; }, get auditCount() { return auditCount; }, get auditTx() { return auditTx; }, get transactionClient() { return transactionClient; }, get outboxCount() { return outboxCount; }, get transactionOptions() { return transactionOptions; }, get internalResolution() { return internalResolution; } };
}

const ctx = { companyId: 'company-1', userId: 'finance-1', requestId: 'request-1', permissions: ['tax.review_issue.resolve'], scopes: { branchIds: ['branch-1'] } } as any;

describe('ReleasePp36InputVatClaimUseCase', () => {
  it('creates one immutable PP30-only claim event and balanced pending-to-claimable posting source', async () => {
    const f = fixture();
    const result = await f.useCase.execute(ctx, { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'RD PP36 receipt verified' });
    assert.equal(result.idempotent, false);
    assert.equal(f.eventData.componentKey, 'PP36_INPUT');
    assert.equal(f.eventData.sourceType, 'tax.pp36_input_claim');
    assert.equal(f.evidenceWhere.sourceLineId, 'line-1');
    assert.equal(f.evidenceWhere.OR, undefined);
    assert.deepEqual(f.eventData.reportContributionsJson.map((entry: any) => entry.formType), ['PP30', 'PP30']);
    assert.equal(f.eventData.reportContributionsJson.some((entry: any) => entry.formType === 'PP36'), false);
    assert.equal(f.transactionOptions.isolationLevel, 'Serializable');
    const assignments = result.postingSource.lines[0]?.taxComponents?.[0]?.accountAssignments;
    assert.deepEqual(assignments?.map((entry) => [entry.accountRole, entry.postingSide, entry.ruleVersion]), [
      ['PP36_INPUT_VAT_CLAIMABLE', 'DEBIT', 3], ['INPUT_VAT_PENDING', 'CREDIT', 2],
    ]);
    assert.equal(f.auditCount, 1);
    assert.equal(f.outboxCount, 1);
    // L-10: the CRITICAL audit row is written on the claim transaction, not post-commit.
    assert.equal(f.auditTx, f.transactionClient);
  });

  it('is idempotent per immutable payment recognition and does not duplicate event/audit/outbox', async () => {
    const f = fixture();
    const input = { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'RD PP36 receipt verified' };
    await f.useCase.execute(ctx, input);
    const second = await f.useCase.execute(ctx, input);
    assert.equal(second.idempotent, true);
    assert.equal(f.auditCount, 1);
    assert.equal(f.outboxCount, 1);
  });

  it('allows two partial-payment claims on one line while keeping each recognition idempotent', async () => {
    const f = fixture({ partialRecognitions: true });
    const first = { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', supplierPaymentId: 'payment-1', evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'first partial payment' };
    const second = { ...first, supplierPaymentId: 'payment-2', evidenceId: 'receipt-2', reason: 'second partial payment' };

    assert.equal((await f.useCase.execute(ctx, first)).idempotent, false);
    assert.equal((await f.useCase.execute(ctx, first)).idempotent, true);
    assert.equal((await f.useCase.execute(ctx, second)).idempotent, false);

    assert.equal(f.events.length, 2);
    assert.notEqual(f.events[0]?.idempotencyKey, f.events[1]?.idempotencyKey);
    assert.equal(f.auditCount, 2);
    assert.equal(f.outboxCount, 2);
  });

  it('rejects a claim date before the verified receipt date', async () => {
    const f = fixture();
    await assert.rejects(() => f.useCase.execute(ctx, { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', evidenceId: 'receipt-1', claimDate: '2026-08-19', reason: 'too early' }),
      (error: any) => error?.getResponse?.().code === 'pp36_claim_date_invalid');
  });

  it('releases the immutable authoritative payment remainder and copies every FX snapshot to the claim event', async () => {
    const f = fixture({ foreignCurrency: true, remainderTax: '0.00' });
    await f.useCase.execute(ctx, { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'final rounding remainder' });
    assert.equal(f.internalResolution.authoritativeSelfAssessedTaxAmount, '0.00');
    assert.equal(f.internalResolution.authoritativeSelfAssessedTaxBaseAmount, '100.00');
    assert.equal(f.internalResolution.historicalSnapshot.taxProfileKey, 'S4_TH');
    assert.deepEqual([
      f.eventData.currency, f.eventData.sourceCurrencySnapshot, f.eventData.taxCurrencySnapshot,
      f.eventData.exchangeRateSnapshot, f.eventData.exchangeRateSourceSnapshot,
    ], ['THB', 'USD', 'THB', '35', 'BANK_PAYMENT']);
  });
});

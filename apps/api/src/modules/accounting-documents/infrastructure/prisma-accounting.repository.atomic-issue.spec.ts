import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { PrismaAccountingRepository } from './prisma-accounting.repository.js';

const updatedAt = new Date('2026-07-15T10:00:00.000Z');

const preview: ResolveTransactionTaxPreviewDto = {
  snapshot: {
    taxCodeDefinitionId: 'tax-o1', externalTaxCode: 'O1', taxProfileKey: 'SAP_S4_TH_CURRENT', taxProfileVersion: 1,
    roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
    taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_SALE', taxRate: '7',
    sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY',
    exchangeRateDate: '2026-07-15', taxBaseAmount: '100.00', taxAmount: '7.00', claimability: 'NOT_APPLICABLE',
    evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
  },
  components: [{
    componentKey: 'VAT', snapshot: undefined as never, accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat',
    accountAssignments: [{ accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat', postingSide: 'CREDIT', ruleVersion: 1 }],
    reportContributions: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amount: '7.00', amountSource: 'TAX_AMOUNT' }],
  }],
  accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat',
  reportContributions: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amount: '7.00', amountSource: 'TAX_AMOUNT' }],
  warnings: [], errors: [], sourceChecksum: 'source-checksum', configurationChecksum: 'configuration-checksum',
};
preview.components[0]!.snapshot = preview.snapshot;

function documentRow(outputTaxCode: 'O7' | null = null) {
  return {
    id: 'doc-1', companyId: 'company-1', branchId: null, documentType: 'TAX_INVOICE', documentNumber: null,
    status: 'DRAFT', documentDate: new Date('2026-07-15T00:00:00.000Z'), dueDate: null, counterpartyId: null,
    counterpartySnapshotJson: null, sourceDocumentId: null, sourceDocumentType: null, convertedFromDocumentId: null,
    currency: 'THB', vatMode: 'VAT_EXCLUDED', outputTaxCode, subtotalAmount: '100', discountAmount: '0',
    taxableAmount: '100', vatAmount: '7', whtAmount: '0', grandTotalAmount: '107', paidAmount: '0', outstandingAmount: '107',
    unappliedCreditAmount: null, paymentStatus: 'UNPAID', taxStatus: null, taxInvoiceType: null, taxInvoiceId: null,
    postingStatus: 'not_required', journalEntryId: null, postingError: null, note: null, internalMemo: null,
    issuedByUserId: null, issuedAt: null, voidedByUserId: null, voidedAt: null, voidReason: null,
    approvalStatus: null, submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null,
    rejectedByUserId: null, rejectedAt: null, approvalNote: null, createdByUserId: 'creator-1', updatedByUserId: null,
    createdAt: new Date('2026-07-15T09:00:00.000Z'), updatedAt,
    lines: [{
      id: 'line-1', companyId: 'company-1', documentId: 'doc-1', lineNumber: 1, productId: null, skuSnapshot: null,
      description: 'Taxable service', unitName: null, quantity: '1', unitPrice: '100', discountAmount: '0',
      vatRate: '7', vatAmount: '7', whtRate: null, whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '107',
      taxCategory: null, revenueCategory: null, taxCodeDefinitionId: 'draft-tax', externalTaxCodeSnapshot: 'O1',
      taxProfileKeySnapshot: 'SAP_S4_TH_CURRENT', taxProfileVersionSnapshot: 1, taxRegimeSnapshot: 'VAT',
      roundingModeSnapshot: null as string | null, roundingScaleSnapshot: null as number | null, taxAmountToleranceSnapshot: null as string | null,
      taxDirectionSnapshot: 'OUTPUT', taxTreatmentSnapshot: 'STANDARD', taxContextSnapshot: 'DOMESTIC_SALE',
      taxRateSnapshot: '7', sourceCurrencySnapshot: 'THB', taxCurrencySnapshot: 'THB', exchangeRateSnapshot: '1',
      exchangeRateSourceSnapshot: 'FUNCTIONAL_CURRENCY', exchangeRateDateSnapshot: new Date('2026-07-15T00:00:00.000Z'),
      taxBaseAmount: '100', transactionTaxAmount: '7', claimabilitySnapshot: 'NOT_APPLICABLE', accountRuleVersionSnapshot: 1,
      reportRuleVersionSnapshot: 1, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', taxComponentsJson: [], accountAssignmentsJson: [],
      createdAt: new Date('2026-07-15T09:00:00.000Z'), updatedAt,
    }],
  };
}

function harness(options: { lockedTax?: boolean; failIssueUpdate?: boolean; outputTaxCode?: 'O7' } = {}) {
  const state = { document: documentRow(options.outputTaxCode ?? null) };
  const client = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async () => 0,
        accountingDocument: {
          findFirst: async ({ where }: any) => where.id === draft.document.id && where.companyId === draft.document.companyId ? draft.document : null,
          findFirstOrThrow: async () => draft.document,
          findMany: async () => [],
          updateMany: async ({ where, data }: any) => {
            if (options.failIssueUpdate || where.status !== draft.document.status || where.updatedAt?.getTime() !== draft.document.updatedAt.getTime()) return { count: 0 };
            Object.assign(draft.document, data, { updatedAt: new Date('2026-07-15T10:01:00.000Z') });
            return { count: 1 };
          },
        },
        accountingDocumentLine: {
          updateMany: async ({ where, data }: any) => {
            const line = draft.document.lines.find((item) => item.id === where.id);
            if (!line || line.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
            Object.assign(line, data, { updatedAt: new Date('2026-07-15T10:00:30.000Z') });
            return { count: 1 };
          },
        },
        accountingPeriod: { findUnique: async () => ({ status: 'OPEN' }) },
        taxPeriod: { findFirst: async () => options.lockedTax ? { status: 'FILED' } : null },
      };
      const result = await work(tx);
      state.document = draft.document;
      return result;
    },
  };
  return { state, repo: new PrismaAccountingRepository({ client } as any) };
}

const finalizer = async () => [{ lineId: 'line-1', preview }];

describe('atomic accounting tax issue', () => {
  it('rejects an O7 compatibility header over an authoritative S/4HANA O1 line before finalization', async () => {
    const { repo, state } = harness({ outputTaxCode: 'O7' });
    let finalized = false;
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, async () => {
        finalized = true;
        return finalizer();
      }),
      (error: any) => error.getResponse?.().message === 'output_tax_code_line_mismatch',
    );
    assert.equal(finalized, false);
    assert.equal(state.document.status, 'DRAFT');
  });

  it('issues once and rejects a concurrent stale retry', async () => {
    const { repo, state } = harness();
    const first = await repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer);
    assert.equal(first.document.status, 'ISSUED');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'VERIFIED');
    assert.deepEqual([
      state.document.lines[0]!.roundingModeSnapshot,
      state.document.lines[0]!.roundingScaleSnapshot,
      state.document.lines[0]!.taxAmountToleranceSnapshot,
    ], ['HALF_EVEN', 3, '0.005']);
    assert.deepEqual([
      first.document.lines?.[0]?.taxSnapshot?.roundingMode,
      first.document.lines?.[0]?.taxSnapshot?.roundingScale,
      first.document.lines?.[0]?.taxSnapshot?.taxAmountTolerance,
    ], ['HALF_EVEN', 3, '0.005']);
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-002', 'issuer-2', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer),
      (error: any) => error.getResponse?.().code === 'accounting_document_changed',
    );
  });

  it('keeps resolver rounding policy in draft and inherited snapshot writes', async () => {
    const writes: any[] = [];
    const client = {
      accountingDocumentLine: { updateMany: async (query: any) => { writes.push(query.data); return { count: 1 }; } },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const repo = new PrismaAccountingRepository({ client } as any);
    await repo.saveLineTaxSnapshots('company-1', 'doc-1', [{ lineId: 'line-1', preview }]);
    await repo.saveInheritedLineTaxSnapshots('company-1', 'doc-2', [{ lineId: 'line-2', snapshot: preview.snapshot, components: preview.components }]);
    assert.deepEqual(writes.map((data) => [data.roundingModeSnapshot, data.roundingScaleSnapshot, data.taxAmountToleranceSnapshot]), [
      ['HALF_EVEN', 3, '0.005'], ['HALF_EVEN', 3, '0.005'],
    ]);
  });

  it('rolls back line snapshots when the final status CAS fails', async () => {
    const { repo, state } = harness({ failIssueUpdate: true });
    await assert.rejects(() => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer));
    assert.equal(state.document.status, 'DRAFT');
    assert.equal(state.document.lines[0]!.taxCodeDefinitionId, 'draft-tax');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'REVIEW_REQUIRED');
  });

  it('rejects a filed tax period before finalizing or mutating snapshots', async () => {
    const { repo, state } = harness({ lockedTax: true });
    let finalized = false;
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, async () => {
        finalized = true;
        return finalizer();
      }),
      (error: any) => error.getResponse?.().code === 'tax_period_locked',
    );
    assert.equal(finalized, false);
    assert.equal(state.document.status, 'DRAFT');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'REVIEW_REQUIRED');
  });
});

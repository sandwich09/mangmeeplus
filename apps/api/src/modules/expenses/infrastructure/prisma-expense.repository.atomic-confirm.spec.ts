import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TransactionTaxComponentPreview, TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic.js';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';

const snapshot: TransactionTaxSnapshot = {
  taxCodeDefinitionId: 'tax-i7', externalTaxCode: 'I7', taxProfileKey: 'SAP_TH', taxProfileVersion: 1,
  roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: '0.01',
  taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7',
  sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY',
  exchangeRateDate: '2026-07-15', taxBaseAmount: '100.00', taxAmount: '7.00', claimability: 'CLAIMABLE',
  evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
};

const components: TransactionTaxComponentPreview[] = [{
  componentKey: 'VAT', snapshot, accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'account-vat',
  accountAssignments: [{ accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'account-vat', postingSide: 'DEBIT', ruleVersion: 1 }],
  reportContributions: [{ formType: 'PP30', boxKey: 'INPUT_VAT', amount: '7.00', amountSource: 'TAX_AMOUNT' }],
}];

function harness(options: { accountingStatus?: string; taxStatus?: string; withAttachment?: boolean; branchId?: string | null } = {}) {
  const updatedAt = new Date('2026-07-15T10:00:00.000Z');
  const row: any = {
    id: 'expense-1', companyId: 'company-1', branchId: options.branchId === undefined ? 'branch-1' : options.branchId, status: 'READY_FOR_CONFIRMATION', captureSource: 'WEB_MANUAL',
    duplicateStatus: 'NO_MATCH', expenseDate: new Date('2026-07-15T00:00:00.000Z'), currency: 'THB', vatMode: 'VAT_EXCLUDED',
    sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'CLAIMABLE',
    primaryAttachmentId: 'attachment-1', missingReceiptReason: null, substituteReceiptGeneratedAt: null,
    vendorTaxIdSnapshot: '0100000000001', vendorDocumentNumber: 'INV-1', vendorCounterpartyId: null,
    subtotalAmount: 100, discountAmount: 0, taxableAmount: 100, vatAmount: 7, whtAmount: 0, grandTotalAmount: 107,
    netPayableAmount: 107, paidAmount: 0, outstandingAmount: 107, updatedAt,
    lines: [{
      id: 'line-1', companyId: 'company-1', expenseId: 'expense-1', lineNumber: 1, description: 'Service',
      quantity: 1, unitPrice: 100, discountAmount: 0, taxableAmount: 100, vatRate: 0.07, vatAmount: 7,
      whtRate: null, whtAmount: 0, lineSubtotalAmount: 100, lineTotalAmount: 107,
      taxCodeDefinitionId: snapshot.taxCodeDefinitionId, externalTaxCodeSnapshot: snapshot.externalTaxCode,
      taxProfileKeySnapshot: snapshot.taxProfileKey, taxProfileVersionSnapshot: snapshot.taxProfileVersion,
      taxRegimeSnapshot: snapshot.taxRegime, taxDirectionSnapshot: snapshot.taxDirection, taxTreatmentSnapshot: snapshot.taxTreatment,
      taxContextSnapshot: snapshot.taxContext, taxRateSnapshot: 7, sourceCurrencySnapshot: 'THB', taxCurrencySnapshot: 'THB',
      exchangeRateSnapshot: 1, exchangeRateSourceSnapshot: 'FUNCTIONAL_CURRENCY', exchangeRateDateSnapshot: new Date('2026-07-15'),
      taxBaseAmount: 100, transactionTaxAmount: 7, claimabilitySnapshot: 'CLAIMABLE', taxEvidenceReviewStatus: 'VERIFIED',
      accountRuleVersionSnapshot: 1, reportRuleVersionSnapshot: 1, taxComponentsJson: components,
    }],
    duplicateCandidates: [],
  };
  const writes = { line: 0, header: 0, outbox: 0, isolationLevel: '' };
  const client: any = {
    // Added by the expense auto-post work (#59): findByIdWithRelations now reads
    // generated journals to resolve the entry number. No journals in these fixtures.
    journalEntry: { findMany: async () => [] },
    $executeRaw: async () => undefined,
    $transaction: async (work: (tx: any) => Promise<unknown>, config: any) => {
      writes.isolationLevel = config?.isolationLevel;
      return work(client);
    },
    expenseRecord: {
      findFirst: async () => row,
      findFirstOrThrow: async () => row,
      updateMany: async ({ data }: any) => { writes.header++; Object.assign(row, data); return { count: 1 }; },
    },
    expenseLine: { updateMany: async () => { writes.line++; return { count: 1 }; } },
    expenseSubstituteReceiptEvidence: { findFirst: async () => null },
    attachmentLink: {
      findMany: async () => options.withAttachment ? [{
        attachmentId: 'attachment-1', purpose: 'RECEIPT',
        attachment: {
          originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1024,
          checksumSha256: 'sha256-receipt', status: 'ACTIVE', createdAt: new Date('2026-07-15T09:00:00.000Z'),
        },
      }] : [],
    },
    accountingPeriod: { findUnique: async () => options.accountingStatus ? { status: options.accountingStatus } : null },
    taxPeriod: { findMany: async () => options.taxStatus ? [{ formType: 'PP30', status: options.taxStatus }] : [] },
    tradeTaxEvidence: { findMany: async () => [] },
    attachmentObject: { count: async () => 0 },
    outboxEvent: { create: async () => { writes.outbox++; } },
  };
  return { repo: new PrismaExpenseRepository({ client } as any), writes, updatedAt };
}

async function inputFor(repo: PrismaExpenseRepository, updatedAt: Date) {
  const source = await repo.findByIdWithRelations('company-1', 'expense-1');
  assert.ok(source);
  return {
    companyId: 'company-1', id: 'expense-1', expectedUpdatedAt: updatedAt,
    expectedSourceChecksum: expenseTaxSourceChecksum(source), actorUserId: 'approver-1', postingStatus: 'pending' as const,
    vendorSnapshotJson: null, expenseNumber: 'EXP-202607-00001',
    outboxEvent: { eventKey: 'expense.confirmed:expense_record:expense-1:req-1', payloadJson: { requestId: 'req-1' } },
  };
}

const finalize = async () => [{
  expenseId: 'expense-1', companyId: 'company-1', sourceLineId: 'line-1', lineNumber: 1, description: 'Service',
  quantity: '1', unitPrice: '100', discountAmount: '0', taxableAmount: '100', vatRate: '0.07', vatAmount: '7',
  whtRate: null, whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '107', expenseCategoryId: null,
  accountHintKey: null, taxCategory: null, taxSnapshot: snapshot, taxComponents: components,
}];

describe('PrismaExpenseRepository atomic tax confirmation', () => {
  it('blocks legacy unassigned expenses before any tax, header or outbox write', async () => {
    const { repo, writes, updatedAt } = harness({ branchId: null });
    const input = await inputFor(repo, updatedAt);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas(input, finalize), /เลือกสาขา/);
    assert.equal(writes.header, 0);
    assert.equal(writes.line, 0);
    assert.equal(writes.outbox, 0);
  });
  it('persists FINAL snapshots, status CAS, and outbox in one serializable transaction', async () => {
    const { repo, writes, updatedAt } = harness();
    const result = await repo.finalizeAndConfirmExpenseCas(await inputFor(repo, updatedAt), finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.equal(result.expense.expenseNumber, 'EXP-202607-00001');
    assert.deepEqual(writes, { line: 1, header: 1, outbox: 1, isolationLevel: 'Serializable' });
  });

  it('confirms an attachment-bearing expense — the CAS re-read must include attachments in the checksum', async () => {
    // Regression: finalizeAndConfirmExpenseCas once rebuilt the record with
    // attachments: [] while the source checksum covers attachments, so every
    // attachment-bearing expense failed with expense_confirmation_source_checksum_changed.
    const { repo, writes, updatedAt } = harness({ withAttachment: true });
    const result = await repo.finalizeAndConfirmExpenseCas(await inputFor(repo, updatedAt), finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.deepEqual(writes, { line: 1, header: 1, outbox: 1, isolationLevel: 'Serializable' });
  });

  it('blocks confirmation while the accounting period is closing or closed', async () => {
    const { repo, writes, updatedAt } = harness({ accountingStatus: 'CLOSING_REVIEW' });
    const input = await inputFor(repo, updatedAt);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas(input, finalize), /accounting_period_locked/);
    assert.deepEqual([writes.line, writes.header, writes.outbox], [0, 0, 0]);
  });

  it('blocks confirmation into a filed PP30 period', async () => {
    const { repo, writes, updatedAt } = harness({ taxStatus: 'FILED' });
    const input = await inputFor(repo, updatedAt);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas(input, finalize), /tax_period_locked:PP30/);
    assert.deepEqual([writes.line, writes.header, writes.outbox], [0, 0, 0]);
  });
});

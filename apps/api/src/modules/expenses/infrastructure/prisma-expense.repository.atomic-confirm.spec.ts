import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';
import { expenseEvidenceFingerprint, expenseEvidenceImageMissing, isBlockingExpenseVatReconciliation, type ExpenseVatMode, type TransactionTaxComponentPreview, type TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic.js';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';
import { ConfirmExpenseUseCase } from '../application/use-cases/expense-draft.use-case';
import { reconcileExpenseVat } from '../domain/logic/expense-vat-reconciliation.logic';
import { ExpenseTransactionTaxService } from '../application/services/expense-transaction-tax.service';
import { TransactionTaxConfigUseCase } from '../../tax/application/use-cases/transaction-tax-config.use-case';
import { aggregatePp30Boxes } from '../../tax/domain/logic/transaction-tax.logic';
import Decimal from 'decimal.js';
import { ExpenseSourceAdapter } from '../../tax/infrastructure/adapters/expense-source.adapter';
import { calcLineTotals } from '../domain/logic/expense-totals.logic';
import { asLedgerSource } from '../../ledger/application/use-cases/journal.use-case';
import { buildDefaultPostingLines, DEFAULT_ACCOUNT_CODES } from '../../ledger/domain/logic/posting-engine.logic';

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

// What the free-drafts commercial check (expenseDraftAccess) reads from the company row.
const ACTIVE_COMPANY = { status: 'ACTIVE', archivedAt: null, planTerm: null };

const reviewFixtures = new WeakMap<PrismaExpenseRepository, () => Promise<void>>();

function harness(options: { accountingStatus?: string; taxStatus?: string; withAttachment?: boolean; branchId?: string | null } = {}) {
  const updatedAt = new Date('2026-07-15T10:00:00.000Z');
  const row: any = {
    expenseNumber: 'EXP-202607-00001', id: 'expense-1', companyId: 'company-1', branchId: options.branchId === undefined ? 'branch-1' : options.branchId, status: 'READY_FOR_CONFIRMATION', captureSource: 'WEB_MANUAL',
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
  const writes = { line: 0, header: 0, outbox: 0, locks: 0 };
  const audits: any[] = [];
  const client: any = {
    // Added by the expense auto-post work (#59): findByIdWithRelations now reads
    // generated journals to resolve the entry number. No journals in these fixtures.
    documentNumber: { findFirst: async () => null },
    journalEntry: { findMany: async () => [] },
    company: { findUnique: async () => ACTIVE_COMPANY },
    $executeRaw: async () => { writes.locks++; },
    $transaction: async (work: (tx: any) => Promise<unknown>, config: any) => {
      const before = structuredClone(row);
      const beforeWrites = { ...writes };
      const beforeAudits = audits.length;
      try { return await work(client); }
      catch (error) {
        for (const key of Object.keys(row)) delete row[key];
        Object.assign(row, before);
        Object.assign(writes, beforeWrites);
        audits.splice(beforeAudits);
        throw error;
      }
    },
    expenseRecord: {
      findFirst: async () => row,
      findFirstOrThrow: async () => row,
      updateMany: async ({ data }: any) => { writes.header++; Object.assign(row, data); return { count: 1 }; },
    },
    expenseLine: { updateMany: async ({ where, data }: any) => {
      const line = row.lines.find((item: any) => item.id === where.id && item.companyId === where.companyId && item.expenseId === where.expenseId);
      if (!line) return { count: 0 };
      writes.line++; Object.assign(line, data); return { count: 1 };
    } },
    expensePayment: { findFirst: async () => null },
    expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
    reimbursementLine: { findFirst: async () => null },
    attachmentLink: {
      findMany: async () => options.withAttachment !== false ? [{
        targetId: 'expense-1', attachmentId: 'attachment-1', purpose: 'RECEIPT',
        attachment: {
          id: 'attachment-1', branchId: row.branchId, originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1024,
          checksumSha256: 'sha256-receipt', status: 'ACTIVE', createdAt: new Date('2026-07-15T09:00:00.000Z'),
        },
      }] : [],
    },
    accountingPeriod: { findUnique: async () => options.accountingStatus ? { status: options.accountingStatus } : null },
    whtPayerModeFact: { findMany: async () => [] },
    taxPeriod: { findMany: async () => options.taxStatus ? [{ formType: 'PP30', status: options.taxStatus }] : [] },
    tradeTaxEvidence: { findMany: async () => [] },
    attachmentObject: { count: async () => 0 },
    outboxEvent: { create: async () => { writes.outbox++; } },
    auditLog: { create: async ({ data }: any) => { if (data.action === 'expense.vat.source_override') audits.push(data); } },
  };
  const repo = new PrismaExpenseRepository({ client } as any);
  const review = async () => {
    const source = (await repo.findByIdWithRelations('company-1', 'expense-1'))!;
    const assessment = { route: 'SOURCE_DOCUMENT' as const, receiptProblem: 'NONE' as const, attachmentIds: ['attachment-1'], reason: '' };
    row.aiVerificationSummaryJson = { documentReview: { version: 2, reviewedAt: updatedAt.toISOString(), reviewedByUserId: 'reviewer-1',
      assessment, fingerprint: expenseEvidenceFingerprint(source, assessment) } };
  };
  reviewFixtures.set(repo, review);
  return { repo, review, writes, updatedAt, row, client, audits };
}

async function documentVatHarness(options: { vatMode?: ExpenseVatMode; sourceVat?: string; taxCode?: boolean; tolerance?: string; accountingStatus?: string; taxStatus?: string } = {}) {
  const h = harness({ ...options, withAttachment: true });
  const vatMode = options.vatMode ?? 'VAT_EXCLUDED';
  const units = [
    { lineNumber: 1, quantity: '1', unitPrice: vatMode === 'VAT_INCLUDED' ? '107' : '100', vatRate: '0.07' },
    { lineNumber: 2, quantity: '1', unitPrice: '50', vatRate: '0' },
  ];
  const vat = reconcileExpenseVat({ vatMode, lines: units, source: { inputType: 'AMOUNT', vatAmount: options.sourceVat ?? '8' } });
  const originalLine = h.row.lines[0];
  h.row.lines = units.map((unit, index) => ({
    ...(index === 0 && options.taxCode ? originalLine : {}),
    ...unit, ...vat.lines[index]!.totals, id: `line-${index + 1}`, expenseId: h.row.id, companyId: h.row.companyId,
    description: index === 0 ? 'VAT goods' : 'Exempt goods', vatTreatment: index === 0 ? null : 'EXEMPT', whtRate: null,
  }));
  Object.assign(h.row, vat.totals, {
    vatMode, vatCaptureSnapshotJson: vat.snapshot, vendorNameSnapshot: 'Supplier',
    sourceDocumentType: options.taxCode ? 'TAX_INVOICE' : 'RECEIPT',
    inputVatClaimStatus: options.taxCode ? 'CLAIMABLE' : 'NON_CLAIMABLE',
    taxEvidenceStatus: options.taxCode ? 'USABLE_FOR_TAX' : 'SUPPORTING_ONLY', outstandingAmount: vat.totals.netPayableAmount,
  });
  h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, baseCurrency: 'THB' }) };
  h.client.branch = { findFirst: async () => ({ id: 'branch-1' }) };
  h.client.tradeTaxEvidence.findMany = async () => [{
    id: 'evidence-1', companyId: 'company-1', status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date(),
    sourceType: 'expense.record', sourceId: 'expense-1', sourceLineId: 'line-1', transactionContext: 'DOMESTIC_PURCHASE',
    branchId: 'branch-1', evidenceType: 'TAX_INVOICE', attachmentIdsJson: ['attachment-1'],
  }];
  h.client.attachmentObject.count = async () => 1;
  const definition = {
    id: 'tax-i7', companyId: 'company-1', profileId: 'profile-1', externalCode: 'I7', taxRegime: 'VAT', direction: 'INPUT',
    treatment: 'STANDARD', transactionContexts: ['DOMESTIC_PURCHASE'], rate: '7',
    calculationMethod: vatMode === 'VAT_INCLUDED' ? 'INCLUSIVE' : 'EXCLUSIVE', claimabilityDefault: 'CLAIMABLE',
    evidenceRuleKey: 'TAX_INVOICE', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null,
  };
  const rules = { companyId: 'company-1', taxCodeDefinitionId: definition.id, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 };
  const transactionTax = new ExpenseTransactionTaxService(new TransactionTaxConfigUseCase({
    prisma: { client: h.client },
    listProfiles: async () => [{ id: 'profile-1', sourceProfileKey: 'SAP_TH', version: 1, roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: options.tolerance ?? '2' }],
    listDefinitions: async () => [definition],
    listAccountRules: async () => [{ ...rules, taxRegime: 'VAT', direction: 'INPUT', treatment: 'STANDARD', accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'vat-account', postingSide: 'DEBIT', priority: 1 }],
    listReportRules: async () => [
      { ...rules, formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE', signRule: 'NORMAL' },
      { ...rules, formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', signRule: 'NORMAL' },
    ],
  } as any, {} as any, {} as any));
  const audit = { log: async (entry: any, tx: any) => {
    if (entry.action === 'expense.vat.source_override') {
      assert.equal(tx, h.client, 'source decision must use the final mutation transaction');
      await tx.auditLog.create({ data: entry });
    }
  } };
  const useCase = new ConfirmExpenseUseCase(h.repo, audit as any, transactionTax,
    { get: async () => ({ status: 'REGISTERED' }) } as any);
  const ctx: any = { companyId: 'company-1', userId: 'reviewer-1', requestId: 'req-1', authProvider: 'watchdog', permissions: ['expense.confirm', 'expense.review'], scopes: {} };
  await h.review();
  return { ...h, ctx, useCase, definition, transactionTax };
}

describe('document VAT acceptance through real confirmation and tax resolution', () => {
  it('EVID-1 confirms a reviewed original invoice with zero files and preserves claimable VAT; selecting a later image clears its reminder', async () => {
    const h = await documentVatHarness({ sourceVat: '7', taxCode: true });
    h.row.primaryAttachmentId = null;
    h.client.attachmentLink.findMany = async () => [];
    const source = (await h.repo.findByIdWithRelations('company-1', 'expense-1'))!;
    const assessment = { route: 'SOURCE_DOCUMENT' as const, receiptProblem: 'NONE' as const, attachmentIds: [] as string[], reason: '', originalDocumentAvailable: true, note: 'อยู่กับผู้ทำบัญชี' };
    h.row.aiVerificationSummaryJson = { documentEvidenceDraft: assessment, documentReview: { version: 2, reviewedAt: h.updatedAt.toISOString(), reviewedByUserId: h.ctx.userId, assessment, fingerprint: expenseEvidenceFingerprint(source, assessment) } };
    const confirmed = await h.useCase.execute(h.ctx, 'expense-1');
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.inputVatClaimStatus, 'CLAIMABLE');
    assert.equal(confirmed.taxEvidenceStatus, 'USABLE_FOR_TAX');
    assert.equal(confirmed.primaryAttachmentId, null);
    const saved = (await h.repo.findByIdWithRelations('company-1', 'expense-1'))!;
    assert.equal(expenseEvidenceImageMissing(saved), true);
    assert.equal((saved.aiVerificationSummaryJson as any).documentReview.assessment.note, assessment.note);
    const file = { id: 'later-image', status: 'ACTIVE' as const, purpose: 'expense.receipt.primary' };
    assert.equal(expenseEvidenceImageMissing({ ...saved, attachments: [file] }), true);
    const selected = { ...assessment, attachmentIds: [file.id] };
    assert.equal(expenseEvidenceImageMissing({ ...saved, attachments: [file], aiVerificationSummaryJson: { ...saved.aiVerificationSummaryJson, documentEvidenceDraft: selected } }), false);
  });

  it('also preserves in-tolerance source VAT without requiring a reviewer override', async () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const h = await documentVatHarness({ vatMode, sourceVat: '7.01', taxCode: true, tolerance: '0.01' });
      const confirmed = await h.useCase.execute(h.ctx, 'expense-1');
      const line = (await h.repo.findByIdWithRelations('company-1', 'expense-1'))!.lines[0]!;
      assert.equal(Number(confirmed.vatAmount), 7.01);
      assert.equal(Number(line.taxSnapshot?.taxAmount), 7.01);
      assert.equal(Number(line.taxSnapshot?.taxBaseAmount), vatMode === 'VAT_INCLUDED' ? 99.99 : 100);
      assert.equal(h.audits.length, 0, 'automatic in-tolerance acceptance is not a reviewer override');
    }
  });

  it('refuses missing permissions, missing reason/carrier and obsolete decisions without an audit', async () => {
    for (const change of [
      // `expense.confirm` alone is no longer refused — owner decision 2026-08-28, below. What still
      // is: reviewing without the right to confirm, and a decision about a snapshot that is gone.
      (h: Awaited<ReturnType<typeof documentVatHarness>>) => { h.ctx.permissions = ['expense.review']; },
      (h: Awaited<ReturnType<typeof documentVatHarness>>) => { h.row.vatCaptureSnapshotJson = null; },
    ]) {
      const h = await documentVatHarness(); change(h);
      await assert.rejects(() => h.useCase.execute(h.ctx, 'expense-1', { reason: 'Checked', vatLineNumber: 1, expectedUpdatedAt: h.updatedAt.toISOString() }));
      assert.equal(h.audits.length, 0); assert.equal(h.writes.header, 0);
    }
    for (const decision of [{ reason: '', vatLineNumber: 1 }, { reason: 'Checked', vatLineNumber: 2 }, { reason: 'Checked', vatLineNumber: 99 }]) {
      const h = await documentVatHarness();
      await assert.rejects(() => h.useCase.execute(h.ctx, 'expense-1', { ...decision, expectedUpdatedAt: h.updatedAt.toISOString() }));
      assert.equal(h.audits.length, 0); assert.equal(h.writes.header, 0);
    }
  });

  // Owner decision 2026-08-28, from a real dead end: requiring `expense.review` on top of the
  // `expense.confirm` this call already demands meant a confirmer facing a mismatch had no way
  // through at all — the save was refused and the control that clears it was never rendered for
  // them. The decision is still deliberate and still audited; it is simply no longer a second role.
  it('lets a confirmer accept the document VAT total, with the decision still written to the audit', async () => {
    const h = await documentVatHarness();
    h.ctx.permissions = ['expense.confirm'];

    await h.useCase.execute(h.ctx, 'expense-1', { reason: 'Checked printed VAT', vatLineNumber: 1, expectedUpdatedAt: h.updatedAt.toISOString() });

    assert.equal(h.writes.header, 1, 'the receipt is filed');
    assert.ok(h.audits.length > 0, 'and who decided it, and why, is on the record');
  });

  for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
    for (const taxCode of [false, true]) {
      for (const sourceVat of ['8', '6']) {
        it(`${vatMode} ${taxCode ? 'configured tax' : 'receipt'} persists accepted ${sourceVat} through reload, FINAL tax and reports`, async () => {
          const h = await documentVatHarness({ vatMode, taxCode, sourceVat });
          const originalSource = structuredClone(h.row.vatCaptureSnapshotJson.source);
          const exemptBefore = structuredClone(h.row.lines[1]);
          const confirmed = await h.useCase.execute(h.ctx, 'expense-1', { reason: 'Checked printed VAT', vatLineNumber: 1, expectedUpdatedAt: h.updatedAt.toISOString() });
          const reloaded = await h.repo.findByIdWithRelations('company-1', 'expense-1');
          assert.ok(reloaded);
          assert.equal(Number(confirmed.vatAmount), Number(sourceVat));
          assert.equal(Number(reloaded.vatAmount), Number(sourceVat));
          assert.equal(Number(reloaded.taxableAmount), vatMode === 'VAT_INCLUDED' ? 157 - Number(sourceVat) : 150);
          assert.equal(Number(reloaded.grandTotalAmount), vatMode === 'VAT_INCLUDED' ? 157 : 150 + Number(sourceVat));
          assert.equal(reloaded.netPayableAmount, reloaded.grandTotalAmount);
          assert.equal(reloaded.outstandingAmount, reloaded.netPayableAmount);
          assert.equal(Number(reloaded.lines[0]!.vatAmount), Number(sourceVat));
          assert.deepEqual(h.row.lines[1], exemptBefore, 'zero treatment and amounts are untouched');
          assert.deepEqual(reloaded.vatCaptureSnapshotJson?.source, originalSource);
          assert.equal(reloaded.vatCaptureSnapshotJson?.calculation.vatAmount, '7.0000');
          assert.equal(reloaded.vatCaptureSnapshotJson?.reconciliation.status, 'REVIEWER_ACCEPTED');
          assert.equal(isBlockingExpenseVatReconciliation(reloaded.vatCaptureSnapshotJson), false);
          assert.equal(reloaded.vatCaptureSnapshotJson?.reconciliation.acceptedSource, 'SOURCE_AMOUNT');
          const posting = asLedgerSource({ ...reloaded, sourceType: 'expense.record', sourceId: reloaded.id });
          const journal = buildDefaultPostingLines(posting)!;
          assert.equal(Number(posting.totalAmount), Number(reloaded.grandTotalAmount));
          assert.equal(Number(posting.taxTotal), taxCode ? Number(sourceVat) : 0);
          assert.equal(Number(posting.lines[1]!.vatAmount), 0);
          assert.equal(journal.reduce((sum, line) => sum + Number(line.debitAmount ?? 0), 0), Number(reloaded.grandTotalAmount));
          assert.equal(journal.reduce((sum, line) => sum + Number(line.creditAmount ?? 0), 0), Number(reloaded.grandTotalAmount));
          if (taxCode) assert.equal(Number(journal.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.INPUT_VAT)?.debitAmount), Number(sourceVat));
          else assert.equal(journal.some((line) => line.accountId === DEFAULT_ACCOUNT_CODES.INPUT_VAT), false);
          if (taxCode) {
            const line = reloaded.lines[0]!;
            assert.equal(Number(line.taxSnapshot?.taxAmount), Number(sourceVat));
            assert.equal(Number(line.taxSnapshot?.taxBaseAmount), Number(line.taxableAmount));
            assert.equal(Number(line.taxComponents?.[0]?.snapshot.taxAmount), Number(sourceVat));
            const boxes = aggregatePp30Boxes(line.taxComponents!.flatMap((component) => component.reportContributions));
            assert.equal(Number(boxes.box7InputTax), Number(sourceVat));
            assert.equal(Number(boxes.box6EligiblePurchases), Number(line.taxableAmount));
          }
          assert.equal(h.audits.length, 1);
          assert.equal(Number(h.audits[0].metadataJson.acceptedVatAmount), Number(sourceVat));
          assert.equal(h.writes.outbox, 1);
          const replay = await h.useCase.execute(h.ctx, 'expense-1');
          assert.equal(replay.expenseNumber, confirmed.expenseNumber);
          assert.equal(h.writes.outbox, 1);
          assert.equal(h.audits.length, 1);
        });
      }
    }
  }

  for (const failure of ['tax tolerance', 'tax rate', 'evidence', 'period', 'tax period', 'audit', 'outbox', 'CAS'] as const) {
    it(`rolls back amounts, decision and outbox on ${failure} failure`, async () => {
      const h = await documentVatHarness({ taxCode: true, tolerance: failure === 'tax tolerance' ? '0.01' : '2',
        accountingStatus: failure === 'period' ? 'CLOSED' : undefined, taxStatus: failure === 'tax period' ? 'FILED' : undefined });
      if (failure === 'tax rate') h.definition.rate = '8';
      if (failure === 'evidence') h.client.tradeTaxEvidence.findMany = async () => [];
      if (failure === 'audit') h.client.auditLog.create = async () => { throw new Error('audit unavailable'); };
      if (failure === 'outbox') h.client.outboxEvent.create = async () => { throw new Error('outbox unavailable'); };
      if (failure === 'CAS') h.client.expenseRecord.updateMany = async () => ({ count: 0 });
      const before = structuredClone(h.row);
      await assert.rejects(() => h.useCase.execute(h.ctx, 'expense-1', { reason: 'Checked document', vatLineNumber: 1, expectedUpdatedAt: h.updatedAt.toISOString() }), (error: any) => {
        if (failure === 'tax tolerance') assert.equal(error.getResponse().code, 'EXPENSE_VAT_TAX_TOLERANCE_REQUIRED');
        if (failure === 'tax rate') assert.equal(error.getResponse().code, 'EXPENSE_VAT_TAX_RATE_CONFLICT');
        return true;
      });
      assert.deepEqual(h.row, before);
      assert.deepEqual([h.writes.line, h.writes.header, h.writes.outbox, h.audits.length], [0, 0, 0, 0]);
      assert.equal(h.row.expenseNumber, 'EXP-202607-00001');
    });
  }

  it('rejects stale source/line changes before applying or auditing a decision', async () => {
    for (const mutate of [
      (row: any) => { row.updatedAt = new Date('2026-07-16'); },
      (row: any) => { row.vatCaptureSnapshotJson.source.vatAmount = '9.0000'; },
      (row: any) => { row.lines[0].vatRate = '0.08'; },
    ]) {
      const h = await documentVatHarness();
      const input = await inputFor(h.repo, h.updatedAt);
      mutate(h.row);
      await assert.rejects(() => h.repo.finalizeAndConfirmExpenseCas({ ...input,
        vatSourceOverride: { reason: 'Checked document', vatLineNumber: 1, expectedUpdatedAt: h.updatedAt.toISOString() },
      }, async () => { assert.fail('stale source must not reach finalization'); }), /source_(version|checksum)_changed/);
      assert.deepEqual([h.writes.line, h.writes.header, h.writes.outbox, h.audits.length], [0, 0, 0, 0]);
    }
  });

  it('rejects an old or missing UI version even when the source changed before POST began', async () => {
    for (const expectedUpdatedAt of [undefined, 'not-a-date', '2026-07-14T10:00:00.000Z']) {
      const h = await documentVatHarness();
      await assert.rejects(() => h.useCase.execute(h.ctx, 'expense-1', {
        reason: 'Reviewed an earlier snapshot', vatLineNumber: 1, expectedUpdatedAt,
      } as any), (error: any) => error.getResponse().code === 'EXPENSE_VAT_OVERRIDE_STALE');
      assert.equal(h.row.expenseNumber, 'EXP-202607-00001');
      assert.equal(h.audits.length, 0);
    }
  });
});

async function inputFor(repo: PrismaExpenseRepository, updatedAt: Date) {
  await reviewFixtures.get(repo)?.();
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
  it('persists FINAL snapshots, status CAS, and outbox in one locked transaction', async () => {
    const { repo, writes, updatedAt } = harness();
    const result = await repo.finalizeAndConfirmExpenseCas(await inputFor(repo, updatedAt), finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.equal(result.expense.expenseNumber, 'EXP-202607-00001');
    assert.deepEqual({ line: writes.line, header: writes.header, outbox: writes.outbox }, { line: 1, header: 1, outbox: 1 });
    assert.ok(writes.locks >= 2, 'funding and substitute locks are held');
  });

  it('returns a claim projection already confirmed by another attempt without finalizing or emitting its stable event again', async () => {
    const { repo, row, client, writes, updatedAt } = harness();
    row.sourceReimbursementRequestId = 'claim-1';
    row.sourceReimbursementLineId = 'claim-line-1';
    client.reimbursementLine.findMany = async () => [{ id: 'claim-line-1', reimbursementRequestId: 'claim-1',
      sourceExpenseSnapshotJson: null, request: { branchId: row.branchId, requesterDisplayNameSnapshot: 'ผู้เบิก' } }];
    client.reimbursementRequest = { findFirst: async () => ({
      id: 'claim-1', status: 'APPROVED', branchId: row.branchId, currency: row.currency,
      lines: [{ id: 'claim-line-1', amount: row.netPayableAmount }],
    }) };
    const input = { ...await inputFor(repo, updatedAt),
      reimbursementReview: { requestId: 'claim-1', lineId: 'claim-line-1' },
      outboxEvent: { eventKey: 'expense.confirmed:expense_record:expense-1:reimbursement:claim-1:claim-line-1', payloadJson: {} },
    };
    const first = await repo.finalizeAndConfirmExpenseCas(input, finalize);
    // A caller that read READY before the first commit still carries the old version/checksum.
    const retry = await repo.finalizeAndConfirmExpenseCas({ ...input, expectedUpdatedAt: new Date(0), expectedSourceChecksum: 'obsolete' }, async () => {
      assert.fail('an existing confirmation must not finalize tax again');
    });
    assert.equal(retry.expense.status, 'CONFIRMED');
    assert.equal(retry.expense.expenseNumber, first.expense.expenseNumber);
    assert.deepEqual(retry.finalized, []);
    assert.deepEqual([writes.line, writes.header, writes.outbox], [1, 1, 1]);

    const confirm = new ConfirmExpenseUseCase(repo, { log: async () => undefined } as any, {} as any, {} as any);
    const ctx = { companyId: 'company-1', userId: 'approver-1', scopes: {} } as any;
    assert.equal((await confirm.executeForReimbursement(ctx, 'expense-1', {
      reimbursementRequestId: 'claim-1', reimbursementLineId: 'claim-line-1', branchId: 'branch-1', allowMissingReceiptWithReason: true,
    })).status, 'CONFIRMED');
    assert.deepEqual([writes.line, writes.header, writes.outbox], [1, 1, 1]);
  });

  it('confirms an attachment-bearing expense — the CAS re-read must include attachments in the checksum', async () => {
    // Regression: finalizeAndConfirmExpenseCas once rebuilt the record with
    // attachments: [] while the source checksum covers attachments, so every
    // attachment-bearing expense failed with expense_confirmation_source_checksum_changed.
    const { repo, writes, updatedAt } = harness({ withAttachment: true });
    const result = await repo.finalizeAndConfirmExpenseCas(await inputFor(repo, updatedAt), finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.deepEqual({ line: writes.line, header: writes.header, outbox: writes.outbox }, { line: 1, header: 1, outbox: 1 });
    assert.ok(writes.locks >= 2, 'funding and substitute locks are held');
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

// WHT certificate system issuance plan §1.2 (S3): a confirmed expense that withheld tax owes the
// payee a 50 ทวิ, recorded as a durable REQUIRED handoff in the SAME final-mutation transaction —
// mirroring what `createWhtHandoffForPayment` already does on the AP settlement path.
describe('WHT certificate handoff at expense confirmation', () => {
  for (const path of ['confirmExpenseCas', 'finalizeAndConfirmExpenseCas'] as const) {
    it(`R4 ${path} refuses a recorded cash or card payment before confirmation`, async () => {
      for (const paymentMethod of ['CASH', 'CARD']) {
        const h = harness(); h.row.whtRemittance = 'E_WHT';
        h.client.expensePayment = { findFirst: async ({ where }: any) => {
          assert.equal(where.companyId, 'company-1'); assert.equal(where.expenseId, 'expense-1');
          assert.equal(where.status, 'RECORDED'); assert.deepEqual(where.paymentMethod.in, ['CASH', 'CARD']);
          return { id: 'paid-cash', paymentMethod };
        } };
        const input = await inputFor(h.repo, h.updatedAt);
        await assert.rejects(() => path === 'confirmExpenseCas' ? h.repo.confirmExpenseCas(input) : h.repo.finalizeAndConfirmExpenseCas(input, finalize),
          (e: any) => e.getStatus() === 409 && e.getResponse().code === 'expense_ewht_cash_payment_exists');
        assert.equal(h.writes.header, 0); assert.equal(h.writes.outbox, 0);
      }
    });
  }
  for (const path of ['confirmExpenseCas', 'finalizeAndConfirmExpenseCas'] as const) {
    it(`R5 ${path} creates no certificate handoff for E_WHT`, async () => {
      const h = harness();
      Object.assign(h.row, { whtRemittance: 'E_WHT', whtAmount: '3', whtRate: '3',
        whtCategoryCode: 'WHT_SERVICE_3', vendorEntityKindSnapshot: 'INDIVIDUAL' });
      Object.assign(h.row.lines[0], { whtAmount: '3', whtRate: '3' });
      h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ร้านผู้จ่าย', taxId: '9999999999999' }) };
      h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
      h.client.whtIncomeCategory = { findUnique: async () => ({ code: 'WHT_SERVICE_3', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
      h.client.whtCertificateHandoff = { findFirst: async () => assert.fail('e-WHT must not read a handoff'),
        create: async () => assert.fail('e-WHT must not create a handoff') };
      const args = await inputFor(h.repo, h.updatedAt);
      const saved = path === 'confirmExpenseCas' ? await h.repo.confirmExpenseCas(args)
        : (await h.repo.finalizeAndConfirmExpenseCas(args, async () => (await finalize()).map(line => ({ ...line, whtAmount: '3', whtRate: '3' })))).expense;
      assert.equal(saved.status, 'CONFIRMED');
      assert.equal(saved.whtRemittance, 'E_WHT');
      assert.equal(h.writes.outbox, 1);
    });
  }
  it('creates a REQUIRED handoff, prefilled from the row, when the confirmed expense withheld tax', async () => {
    const { repo, updatedAt, row, client } = harness();
    row.whtAmount = 30;
    row.whtCategoryCode = 'CAT1';
    row.whtRate = 3;
    row.vendorEntityKindSnapshot = 'INDIVIDUAL';
    row.vendorNameSnapshot = 'ผู้รับเงิน';
    row.vendorTaxIdSnapshot = '1111111111111';
    const handoffs: any[] = [];
    client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย', registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', addressJson: null }) };
    client.branch = { findUnique: async () => ({ taxBranchCode: '00002' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00002' }] };
    client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าเช่า', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { handoffs.push(data); } };
    const input = await inputFor(repo, updatedAt);
    const result = await repo.finalizeAndConfirmExpenseCas(input, finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.equal(handoffs.length, 1);
    const handoff = handoffs[0];
    assert.equal(handoff.status, 'REQUIRED');
    assert.equal(handoff.sourcePaymentType, 'expense.record');
    assert.equal(handoff.sourcePaymentId, 'expense-1');
    assert.equal(handoff.sourceFeatureKey, 'expenses');
    assert.equal(handoff.prefillSnapshotJson.payerSnapshot.branchCode, '00002', 'Phase 1.1 fix applies on the Expenses side too');
    assert.equal(handoff.prefillSnapshotJson.payeeSnapshot.name, 'ผู้รับเงิน');
    assert.equal(handoff.prefillSnapshotJson.formType, 'PND3');
    assert.equal(handoff.prefillSnapshotJson.incomeCategoryCode, 'CAT1');
    assert.equal(handoff.prefillSnapshotJson.incomeCategoryName, 'ค่าเช่า');
    assert.equal(handoff.prefillSnapshotJson.withheldAmount, '30');
  });

  it('creates no handoff when the confirmed expense withheld nothing', async () => {
    const { repo, updatedAt, client } = harness();
    client.whtCertificateHandoff = { create: async () => { throw new Error('must not be called when whtAmount is 0'); } };
    const input = await inputFor(repo, updatedAt);
    const result = await repo.finalizeAndConfirmExpenseCas(input, finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
  });
});

describe('e-WHT remittance persistence and handoffs (real PostgreSQL, paid path)', () => {
  const required = process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES === 'true';
  const companyId = `ewht-confirm-pg-${randomUUID()}`;
  const actorUserId = `${companyId}-actor`;
  const branchId = `${companyId}-branch`;
  let client: PrismaClient | undefined;
  let repo: PrismaExpenseRepository;
  let fixtureCreated = false;
  let ready = false;
  let unavailable: string | null = null;

  before(async () => {
    if (!process.env.DATABASE_URL) { assert.equal(required, false, 'PostgreSQL required'); return; }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    unavailable = await pgSpecUnreachableReason(() => client!.$queryRaw`SELECT "whtRemittance" FROM "ExpenseRecord" LIMIT 0`, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unavailable) return;
    await client.company.create({ data: { id: companyId, name: 'ร้านทดสอบวิธีนำส่ง', registeredName: 'บริษัททดสอบวิธีนำส่ง จำกัด' } });
    fixtureCreated = true;
    await client.user.create({ data: { id: actorUserId, displayName: 'ผู้ตรวจทดสอบ' } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', taxBranchCode: '00000', createdByUserId: actorUserId } });
    repo = new PrismaExpenseRepository({ client } as any);
    ready = true;
  });
  after(async () => {
    if (!client) return;
    try {
      if (fixtureCreated) {
        await client.whtCertificateHandoff.deleteMany({ where: { companyId } });
        await client.whtCertificateHistory.deleteMany({ where: { companyId } });
        await client.whtCertificate.deleteMany({ where: { companyId } });
        await client.expensePayment.deleteMany({ where: { companyId } });
        await client.outboxEvent.deleteMany({ where: { companyId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.company.delete({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: actorUserId } });
      }
    } finally { await client.$disconnect(); }
  });

  async function roundTwoSource(remittance: 'PAYER_FILES' | 'E_WHT', paidAmount = '0') {
    return client!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: actorUserId,
      expenseDate: new Date('2026-11-04'), expenseNumber: `EXP-${randomUUID()}`, status: 'READY_FOR_CONFIRMATION', captureSource: 'WEB_MANUAL',
      sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', vatMode: 'VAT_EXCLUDED', inputVatClaimStatus: 'NON_CLAIMABLE',
      vendorNameSnapshot: 'ผู้รับเงินทดสอบ', vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'WHT_SERVICE_3', whtRate: '1', whtRemittance: remittance,
      subtotalAmount: '10000', taxableAmount: '10000', vatAmount: '700', whtAmount: '100', grandTotalAmount: '10700', netPayableAmount: '10600',
      paidAmount, outstandingAmount: String(10600 - Number(paidAmount)),
      lines: { create: { companyId, lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '10000', taxableAmount: '10000',
        vatRate: '0.07', vatAmount: '700', whtCategoryCode: 'WHT_SERVICE_3', whtRate: '1', whtAmount: '100', lineSubtotalAmount: '10000', lineTotalAmount: '10700' } } } });
  }
  const roundTwoConfirm = (row: { id: string; updatedAt: Date; expenseNumber: string | null }) => ({ companyId, id: row.id, actorUserId,
    expectedUpdatedAt: row.updatedAt, expenseNumber: row.expenseNumber!, postingStatus: 'not_required' as const, vendorSnapshotJson: null,
    outboxEvent: { eventKey: `ewht-round-two:${randomUUID()}`, payloadJson: {} } });
  const reviewer = () => ({ companyId, userId: actorUserId, requestId: randomUUID(), authProvider: 'watchdog', permissions: ['expense.review'], scopes: {} } as any);

  it('R4 recorded CASH/CARD prevents the paid update and both confirmation transactions', async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL not set');
    const { UpdateExpenseDraftUseCase } = await import('../application/use-cases/expense-draft.use-case');
    for (const paymentMethod of ['CASH', 'CARD'] as const) {
      const source = await roundTwoSource('PAYER_FILES', '40');
      await client!.expensePayment.create({ data: { companyId, expenseId: source.id, amount: '40', currency: 'THB', paidAt: new Date('2026-11-04'),
        paymentMethod, status: 'RECORDED', createdByUserId: actorUserId, idempotencyKey: randomUUID(), payloadFingerprint: canonicalFingerprint({ expenseId: source.id, amount: '40', paymentMethod }) } });
      const uc = new UpdateExpenseDraftUseCase(repo, { log: async () => undefined } as any, {} as any);
      const denied = (e: any) => e.getStatus() === 409 && e.getResponse().code === 'expense_ewht_cash_payment_exists';
      await assert.rejects(() => uc.execute(reviewer(), source.id, { whtRemittance: 'E_WHT', expectedUpdatedAt: source.updatedAt.toISOString() }), denied);
      assert.equal((await repo.findById(companyId, source.id))!.whtRemittance, 'PAYER_FILES');
      const unsafe = await client!.expenseRecord.update({ where: { id: source.id }, data: { whtRemittance: 'E_WHT' } });
      await assert.rejects(() => repo.confirmExpenseCas(roundTwoConfirm(unsafe)), denied);
      await assert.rejects(() => repo.finalizeAndConfirmExpenseCas({ ...roundTwoConfirm(unsafe), expectedSourceChecksum: 'not-reached' }, async () => []), denied);
      assert.equal((await repo.findById(companyId, source.id))!.status, 'READY_FOR_CONFIRMATION');
      assert.equal(await client!.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: source.id } }), 0);
    }
  });

  it('R5 issued certificate is voided on reopen and handoff remains cancelled after e-WHT confirmation', async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL not set');
    const source = await roundTwoSource('PAYER_FILES');
    await repo.confirmExpenseCas(roundTwoConfirm(source));
    const period = await client!.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType: 'PND3', periodKey: '2026-11' } },
      create: { companyId, taxType: 'WHT', formType: 'PND3', periodKey: '2026-11' }, update: {} });
    const certificate = await client!.whtCertificate.create({ data: { companyId, taxPeriodId: period.id, periodKey: '2026-11',
      certificateNumber: `WHT-${randomUUID()}`, status: 'ISSUED', issuedAt: new Date(), issuedByUserId: actorUserId,
      payeeSnapshotJson: { name: 'ผู้รับเงินทดสอบ' }, payerSnapshotJson: { companyName: 'ร้านทดสอบ' }, incomeCategoryCode: 'WHT_SERVICE_3',
      incomeCategoryName: 'ค่าบริการ', whtRate: '1', grossAmount: '10000', withheldAmount: '100', paymentDate: new Date('2026-11-04') } });
    await client!.whtCertificateHandoff.updateMany({ where: { companyId, sourcePaymentId: source.id }, data: { status: 'SYSTEM_ISSUED', certificateId: certificate.id } });
    await repo.reopenExpenseAtomic({ companyId, expenseId: source.id, actorUserId, scopes: {}, reason: 'แก้วิธีนำส่งภาษี',
      permissions: ['expense.confirm', 'wht.certificate.correct'], taxFilingAttested: true, requestId: randomUUID() });
    const changed = await repo.updateExpense({ companyId, id: source.id, updatedByUserId: actorUserId, whtRemittance: 'E_WHT', status: 'READY_FOR_CONFIRMATION' });
    await repo.confirmExpenseCas(roundTwoConfirm(changed));
    assert.equal((await client!.whtCertificate.findUniqueOrThrow({ where: { id: certificate.id } })).status, 'VOIDED');
    const handoffs = await client!.whtCertificateHandoff.findMany({ where: { companyId, sourcePaymentId: source.id } });
    assert.deepEqual(handoffs.map(row => row.status), ['CANCELLED']);
  });

  for (const paidAmount of ['5000', '10600']) it(`R5 changing e-WHT to payer-files 2 percent with ${paidAmount} already paid`, async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL not set');
    const source = await roundTwoSource('E_WHT', paidAmount);
    await client!.expenseRecord.update({ where: { id: source.id }, data: { status: 'CONFIRMED' } });
    await client!.expensePayment.create({ data: { companyId, expenseId: source.id, amount: paidAmount, currency: 'THB', paidAt: new Date('2026-11-04'),
      paymentMethod: 'BANK_TRANSFER', status: 'RECORDED', createdByUserId: actorUserId, idempotencyKey: randomUUID(), payloadFingerprint: canonicalFingerprint({ expenseId: source.id, amount: paidAmount, paymentMethod: 'BANK_TRANSFER' }) } });
    await repo.reopenExpenseAtomic({ companyId, expenseId: source.id, actorUserId, scopes: {}, reason: 'แก้อัตราหักภาษี', permissions: ['expense.confirm'], requestId: randomUUID() });
    const { UpdateExpenseDraftUseCase } = await import('../application/use-cases/expense-draft.use-case');
    const uc = new UpdateExpenseDraftUseCase(repo, { log: async () => undefined } as any,
      { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any);
    const updated = await uc.execute(reviewer(), source.id, { whtRemittance: 'PAYER_FILES', whtInput: { inputType: 'RATE', value: '2' },
      lines: [{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '10000', vatRate: '0.07', whtCategoryCode: 'WHT_SERVICE_3' }] });
    assert.equal(Number(updated.netPayableAmount), 10500);
    const prepared = await repo.updateExpense({ id: source.id, companyId, updatedByUserId: actorUserId, status: 'READY_FOR_CONFIRMATION' });
    if (paidAmount === '10600') await assert.rejects(() => repo.confirmExpenseCas(roundTwoConfirm(prepared)), (e: any) => e.getResponse().code === 'expense_paid_exceeds_payable');
    else {
      await repo.confirmExpenseCas(roundTwoConfirm(prepared));
      assert.equal((await client!.whtCertificateHandoff.findFirstOrThrow({ where: { companyId, sourcePaymentId: source.id } })).status, 'REQUIRED');
    }
  });

  for (const path of ['confirmExpenseCas', 'finalizeAndConfirmExpenseCas'] as const) {
    for (const whtRemittance of ['E_WHT', 'PAYER_FILES'] as const) {
      it(`R1/R5 ${path} round-trips ${whtRemittance} and ${whtRemittance === 'E_WHT' ? 'has no handoff' : 'requires a certificate'}`, async t => {
        if (!ready) { t.skip(unavailable ?? 'DATABASE_URL not set'); return; }
        const expenseDate = new Date('2026-11-04T00:00:00Z');
        const created = await repo.createExpense({ companyId, branchId, createdByUserId: actorUserId,
          captureSource: 'WEB_MANUAL', expenseDate, vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
          sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', vendorNameSnapshot: 'ผู้รับเงินทดสอบ',
          whtRemittance: 'E_WHT', subtotalAmount: '100', discountAmount: '0', taxableAmount: '100', vatAmount: '0',
          whtAmount: '3', grandTotalAmount: '100', netPayableAmount: '97', outstandingAmount: '97' });
        assert.equal(created.whtRemittance, 'E_WHT');
        assert.equal((await repo.findById(companyId, created.id))!.whtRemittance, 'E_WHT');
        const changed = await repo.updateExpense({ id: created.id, companyId, updatedByUserId: actorUserId,
          whtRemittance: 'PAYER_FILES', vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'WHT_SERVICE_3', whtRate: '3' });
        assert.equal(changed.whtRemittance, 'PAYER_FILES');
        assert.equal((await repo.findById(companyId, created.id))!.whtRemittance, 'PAYER_FILES');
        await repo.upsertLines(companyId, created.id, [{ companyId, expenseId: created.id, lineNumber: 1, description: 'ค่าบริการ',
          quantity: '1', unitPrice: '100', discountAmount: '0', taxableAmount: '100', vatRate: null, vatAmount: '0',
          whtCategoryCode: 'WHT_SERVICE_3', whtRate: '3', whtAmount: '3', lineSubtotalAmount: '100', lineTotalAmount: '100',
          expenseCategoryId: null, accountHintKey: null, taxCategory: null }]);
        await repo.updateExpense({ id: created.id, companyId, updatedByUserId: actorUserId, whtRemittance, status: 'READY_FOR_CONFIRMATION', expenseNumber: `EXP-${randomUUID()}` });
        const source = (await repo.findByIdWithRelations(companyId, created.id))!;
        const assessment = { route: 'SOURCE_DOCUMENT' as const, receiptProblem: 'NONE' as const,
          attachmentIds: [] as string[], originalDocumentAvailable: true, reason: '', note: 'อยู่กับผู้ทำบัญชี' };
        await client!.expenseRecord.update({ where: { id: created.id }, data: { aiVerificationSummaryJson: {
          documentReview: { version: 2, reviewedAt: new Date().toISOString(), reviewedByUserId: actorUserId,
            assessment, fingerprint: expenseEvidenceFingerprint(source, assessment) },
        } } });
        const reviewed = (await repo.findByIdWithRelations(companyId, created.id))!;
        const args = { companyId, id: created.id, actorUserId, expectedUpdatedAt: reviewed.updatedAt,
          expectedSourceChecksum: expenseTaxSourceChecksum(reviewed), expenseNumber: reviewed.expenseNumber!, postingStatus: 'not_required' as const,
          vendorSnapshotJson: null, outboxEvent: { eventKey: `ewht-confirm:${created.id}`, payloadJson: {} } };
        const confirmed = path === 'confirmExpenseCas' ? await repo.confirmExpenseCas(args)
          : (await repo.finalizeAndConfirmExpenseCas(args, async () => [])).expense;
        assert.equal(confirmed.status, 'CONFIRMED');
        assert.equal(confirmed.whtRemittance, whtRemittance);
        assert.equal((await repo.findByIdWithRelations(companyId, created.id))!.whtRemittance, whtRemittance);
        const handoffs = await client!.whtCertificateHandoff.findMany({ where: { companyId, sourcePaymentType: 'expense.record', sourcePaymentId: created.id } });
        assert.deepEqual(handoffs.map(row => row.status), whtRemittance === 'E_WHT' ? [] : ['REQUIRED']);
      });
    }
  }
});

describe('evidence review at final transaction', () => {
  it('rejects a removed human review after preflight, without final lines, header or outbox', async () => {
    const h = harness();
    const input = await inputFor(h.repo, h.updatedAt);
    h.row.aiVerificationSummaryJson = null;
    await assert.rejects(() => h.repo.finalizeAndConfirmExpenseCas(input, async () => []),
      (error: any) => error.getResponse().code === 'EXPENSE_EVIDENCE_REVIEW_REQUIRED');
    assert.equal(h.writes.header + h.writes.line + h.writes.outbox, 0);
  });
});


it('confirms a reviewed original receipt after certificate cancellation while retaining its history and missing-receipt reason', async () => {
  const h = harness();
  h.row.missingReceiptReason = 'ไม่ได้รับใบเสร็จในวันที่สร้างใบทดแทน';
  h.client.expenseSubstituteReceiptEvidence.findMany = async ({ where }: any) => where.status === 'ISSUED' ? [] : [{
    id: 'cancelled-cert', expenseId: 'expense-1', version: 1, status: 'SUPERSEDED', artifactAttachmentId: 'cancelled-file', wetSignedScanAttachmentId: null,
  }];
  h.client.attachmentObject.findMany = async () => [{
    id: 'cancelled-file', branchId: h.row.branchId, originalFileName: 'old.svg', mimeType: 'image/svg+xml', byteSize: 30n,
    checksumSha256: 'old', status: 'ACTIVE', createdAt: h.updatedAt,
  }];
  const input = await inputFor(h.repo, h.updatedAt);
  const result = await h.repo.finalizeAndConfirmExpenseCas(input, finalize);
  assert.equal(result.expense.status, 'CONFIRMED');
  assert.equal(h.writes.outbox, 1);
  assert.equal(h.row.missingReceiptReason, 'ไม่ได้รับใบเสร็จในวันที่สร้างใบทดแทน');
});


describe('confirmation after expense correction', () => {
  it('refuses corrected payable below recorded payments before finalization or posting', async () => {
    const h = harness(); h.row.paidAmount = '108'; h.row.netPayableAmount = '107';
    const input = await inputFor(h.repo, h.updatedAt);
    await assert.rejects(() => h.repo.finalizeAndConfirmExpenseCas(input, finalize), (e: any) => e.getResponse?.().code === 'expense_paid_exceeds_payable');
    assert.equal(h.row.status, 'READY_FOR_CONFIRMATION'); assert.equal(h.writes.header, 0); assert.equal(h.writes.outbox, 0);
  });

  it('keeps a typed certificate address on revival only for the same payee by tax digits or normalized name', async () => {
    for (const [oldTaxId, newTaxId, oldName, newName, keep] of [
      ['1-1111-11111-11-1', '1111111111111', 'ชื่อเดิม', 'ชื่อที่สะกดใหม่', true],
      ['1111111111111', '2222222222222', 'ชื่อเดิม', 'ชื่อเดิม', false],
      [null, null, ' ร้าน แสง-ดี ', 'ร้านแสงดี', true],
      [null, null, 'ร้านเดิม', 'ร้านใหม่', false],
      [null, '1111111111111', 'ร้านเดิม', 'ร้านเดิม', false],
      [null, null, '', '', false],
    ] as const) {
      const h = harness();
      const history: any[] = [];
      h.client.whtCertificateHistory = { create: async ({ data }: any) => { history.push(data); return data; } };
      Object.assign(h.row, { whtAmount: 30, whtCategoryCode: 'CAT1', whtRate: 3, vendorEntityKindSnapshot: 'INDIVIDUAL', vendorNameSnapshot: newName, vendorTaxIdSnapshot: newTaxId });
      const typedAt = new Date('2026-07-15T12:00:00Z');
      const retired: any = { id: 'handoff-old', status: 'CANCELLED', payeeAddress: 'บ้านเลขที่ 99', payeeAddressByUserId: 'recorder', payeeAddressAt: typedAt,
        prefillSnapshotJson: { payeeSnapshot: { name: oldName, taxId: oldTaxId, address: null } }, prefillSnapshotHash: 'old' };
      h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
      h.client.branch = { findUnique: async () => ({ taxBranchCode: '00002' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00002' }] };
      h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าเช่า', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
      h.client.whtCertificateHandoff = { findFirst: async () => retired, create: async () => { throw Error('duplicate handoff'); },
        update: async ({ data }: any) => { Object.assign(retired, data); return retired; } };
      await h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), finalize);
      const taxChanged = oldTaxId !== newTaxId && !keep && Boolean(oldTaxId || newTaxId);
      assert.equal(history.length, taxChanged ? 1 : 0);
      if (taxChanged) { assert.equal(history[0].eventType, 'PAYEE_ADDRESS_CLEARED'); assert.equal(history[0].handoffId, retired.id); assert.equal(history[0].actorUserId, 'approver-1'); }
      assert.equal(retired.status, 'REQUIRED'); assert.equal(retired.payeeAddress, keep ? 'บ้านเลขที่ 99' : null);
      assert.equal(retired.payeeAddressByUserId, keep ? 'recorder' : null); assert.equal(retired.payeeAddressAt, keep ? typedAt : null);
      assert.equal(retired.prefillSnapshotJson.payeeSnapshot.address, null, 'the typed address stays outside the frozen prefill');
      assert.equal(retired.prefillSnapshotJson.payeeSnapshot.name, newName);
    }
  });

  it('drops the typed certificate address when the expense now carries a different address of its own', async () => {
    for (const [oldAddress, newAddress, keep] of [
      [null, null, true], ['ที่อยู่ตามใบ', 'ที่อยู่ตามใบ', true], ['ที่อยู่ตามใบ', ' ที่อยู่ตามใบ ', true],
      [null, 'ที่อยู่ที่เพิ่งแก้บนเอกสาร', false], ['ที่อยู่ตามใบ', 'ที่อยู่ที่เพิ่งแก้บนเอกสาร', false],
    ] as const) {
      const h = harness();
      Object.assign(h.row, { whtAmount: 30, whtCategoryCode: 'CAT1', whtRate: 3, vendorEntityKindSnapshot: 'INDIVIDUAL', vendorNameSnapshot: 'ร้านเดิม', vendorTaxIdSnapshot: '1111111111111', vendorAddressSnapshot: newAddress });
      const retired: any = { id: 'handoff-old', status: 'CANCELLED', payeeAddress: 'บ้านเลขที่ 99', payeeAddressByUserId: 'recorder', payeeAddressAt: new Date('2026-07-15T12:00:00Z'),
        prefillSnapshotJson: { payeeSnapshot: { name: 'ร้านเดิม', taxId: '1111111111111', address: oldAddress } }, prefillSnapshotHash: 'old' };
      h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
      h.client.branch = { findUnique: async () => ({ taxBranchCode: '00002' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00002' }] };
      h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าเช่า', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
      h.client.whtCertificateHandoff = { findFirst: async () => retired, create: async () => { throw Error('duplicate handoff'); },
        update: async ({ data }: any) => { Object.assign(retired, data); return retired; } };
      await h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), finalize);
      assert.equal(retired.payeeAddress, keep ? 'บ้านเลขที่ 99' : null, `old ${oldAddress} → new ${newAddress}`);
    }
  });

  it('rebuilds a retired handoff from corrected facts with the same expense number and no duplicate handoff', async () => {
    const h = harness();
    const history: any[] = [];
    h.client.whtCertificateHistory = { create: async ({ data }: any) => { history.push(data); return data; } };
    Object.assign(h.row, { whtAmount: 30, whtCategoryCode: 'CAT1', whtRate: 3, vendorEntityKindSnapshot: 'INDIVIDUAL', expenseNumber: 'EXP-KEEP' });
    const retired: any = { id: 'handoff-old', status: 'CANCELLED', payeeAddress: 'ที่อยู่ของผู้รับเงินเดิม', prefillSnapshotJson: { withheldAmount: 'wrong' } };
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00002' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00002' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าเช่า', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = {
      findFirst: async () => retired,
      update: async ({ where, data }: any) => { assert.equal(where.id, retired.id); Object.assign(retired, data); return retired; },
      create: async () => { throw new Error('duplicate handoff'); },
    };
    const result = await h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), finalize);
    assert.equal(result.expense.expenseNumber, 'EXP-KEEP'); assert.equal(retired.status, 'REQUIRED');
    assert.equal(retired.prefillSnapshotJson.withheldAmount, '30'); assert.equal(retired.prefillSnapshotJson.formType, 'PND3'); assert.equal(retired.payeeAddress, null);
  });
});


describe('confirmation keeps its own period gate', () => {
  // A document confirmed after ภ.ง.ด.3 / ภ.ง.ด.53 was filed is not refused here: the tax sync skips or flags it for an
  // amended filing. Only a correction (reopen) stops at a filed withholding period.
  for (const formType of ['PND3', 'PND53']) it(`still confirms when ${formType} of the month is filed`, async () => {
    const h = harness();
    h.row.whtAmount = 3; h.row.whtCategoryCode = 'CAT1'; h.row.whtRate = 3;
    h.row.vendorEntityKindSnapshot = formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC';
    h.row.vendorNameSnapshot = 'ผู้รับเงิน'; h.row.vendorTaxIdSnapshot = '1111111111111';
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย', registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', addressJson: null }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00002' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00002' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType, defaultRate: '3', status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async () => undefined };
    h.client.taxPeriod.findMany = async ({ where }: any) => where.OR?.some((p: any) => p.formType === formType)
      ? [{ formType, periodKey: '2026-07', status: 'FILED' }] : [];
    const input = await inputFor(h.repo, h.updatedAt);
    const result = await h.repo.finalizeAndConfirmExpenseCas(input, finalize);
    assert.equal(result.expense.status, 'CONFIRMED');
    assert.equal(h.writes.header, 1);
  });
});


describe('expense certificate income base (E1)', () => {
  async function certificateAndFiling(prices: string[], rate: string, rounding: string) {
    const h = harness();
    h.row.lines = [...prices, rounding].map((price, index) => ({ ...h.row.lines[0], id: `line-${index}`, lineNumber: index + 1,
      ...calcLineTotals({ quantity: '1', unitPrice: price, vatMode: 'NO_VAT', whtRate: index < prices.length ? new Decimal(rate).div(100).toString() : '0' }),
      whtRate: index < prices.length ? new Decimal(rate).div(100).toString() : null,
      chargeKind: index === prices.length ? 'ROUNDING' : null }));
    const gross = h.row.lines.reduce((sum: Decimal, line: any) => sum.plus(line.taxableAmount), new Decimal(0));
    const tax = h.row.lines.reduce((sum: Decimal, line: any) => sum.plus(line.whtAmount), new Decimal(0));
    Object.assign(h.row, { whtAmount: tax.toString(), whtRate: rate, whtCategoryCode: 'CAT1', vendorEntityKindSnapshot: 'INDIVIDUAL',
      whtInputJson: { inputType: 'RATE', value: rate }, taxableAmount: gross.toString(), grandTotalAmount: gross.toString(),
      netPayableAmount: gross.minus(tax).toString(), outstandingAmount: gross.minus(tax).toString() });
    let paper: any;
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย', timezone: 'Asia/Bangkok' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType: 'PND3', defaultRate: rate, status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { paper = data; } };
    await h.repo.confirmExpenseCas(await inputFor(h.repo, h.updatedAt));
    const source = { ...h.row, lines: h.row.lines.filter((line: any) => new Decimal(line.whtAmount).gt(0)), payments: [
      { id: 'paid', amount: h.row.netPayableAmount, status: 'RECORDED', paidAtConfirmed: true, paidAt: h.row.expenseDate, createdAt: h.row.expenseDate },
    ] };
    const [filing] = await new ExpenseSourceAdapter({ client: { expenseRecord: { findMany: async () => [source] },
      company: h.client.company, whtFilingLine: { findMany: async () => [] } } } as any).findConfirmedWithWhtByCompany('company-1');
    return { paper: paper.prefillSnapshotJson, filing };
  }
  it('MONEY-T1 uses certificate income 143744.80 for the filing instead of the 143744.56 rounded document total', async () => {
    const { paper, filing } = await certificateAndFiling(Array(4).fill('35936.20'), '1', '-0.24');
    assert.equal(paper.grossAmount, '143744.8000');
    assert.equal(Number(filing.grossAmount), Number(paper.grossAmount));
    assert.equal(Number(filing.whtAmount), Number(paper.withheldAmount));
  });
  it('MONEY-T1 seeded confirmation certificates and filing payments have identical income and withholding', async () => {
    let seed = 4242;
    const pick = (max: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % max);
    for (let i = 0; i < 2500; i++) {
      const prices = Array.from({ length: 1 + pick(5) }, () => new Decimal(100 + pick(10000000)).div(100).toFixed(2));
      const { paper, filing } = await certificateAndFiling(prices, ['1', '2', '3', '5'][pick(4)]!, new Decimal(-1 - pick(99)).div(100).toString());
      assert.ok(new Decimal(filing.grossAmount).eq(paper.grossAmount), `seed case ${i}`);
      assert.ok(new Decimal(filing.whtAmount).eq(paper.withheldAmount), `seed case ${i}`);
    }
  });
  it('MONEY-T1 reads the actual rate or mixed-rate absence without rewriting historical money', async () => {
    for (const [input, lineRates, expected] of [[{ inputType: 'RATE', value: '1' }, ['0.01'], '1'],
      [{ inputType: 'AMOUNT', value: '10' }, [null], null], [null, ['0.01', '0.02'], null]] as const) {
      const h = harness();
      Object.assign(h.row, { whtRate: '3', whtAmount: '10', whtInputJson: input });
      h.row.lines = lineRates.map((whtRate, index) => ({ ...h.row.lines[0], id: `line-${index}`, whtRate, whtAmount: '5' }));
      const read = await h.repo.findByIdWithRelations('company-1', 'expense-1');
      assert.equal(read!.whtRate, expected); assert.equal(h.row.whtRate, '3'); assert.equal(read!.whtAmount, '10');
    }
  });
  it('MONEY-T1 certificate handoffs use the captured rate rather than the category default', async () => {
    const h = harness();
    Object.assign(h.row, { whtAmount: '10', whtRate: '3', whtCategoryCode: 'CAT1', vendorEntityKindSnapshot: 'INDIVIDUAL',
      whtInputJson: { inputType: 'RATE', value: '1' } });
    Object.assign(h.row.lines[0], { taxableAmount: '1000', whtAmount: '10', whtRate: '0.01' });
    let paper: any;
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { paper = data; } };
    await h.repo.confirmExpenseCas(await inputFor(h.repo, h.updatedAt));
    assert.equal(paper.prefillSnapshotJson.whtRate, '1');
  });
  for (const path of ['confirm', 'finalize and confirm']) {
    for (const source of ['stored base', 'withheld lines', 'legacy fallback']) it(`${path} uses ${source} for the 1500 VAT-inclusive bill certificate`, async () => {
      const h = harness();
      Object.assign(h.row, { whtAmount: '42.06', whtRate: '3', whtCategoryCode: 'CAT1', vendorEntityKindSnapshot: 'INDIVIDUAL', grandTotalAmount: '1500.00', taxableAmount: '1401.87', vatAmount: '98.13', netPayableAmount: '1457.94', outstandingAmount: '1457.94' });
      if (source === 'stored base') h.row.whtInputJson = { inputType: 'RATE', value: '3', baseAmount: '1401.87' };
      Object.assign(h.row.lines[0], { taxableAmount: '1401.87', vatAmount: '98.13', lineTotalAmount: '1500', whtAmount: source === 'legacy fallback' ? '0' : '42.06' });
      const papers: any[] = [];
      h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
      h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
      h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
      h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { papers.push(data); } };
      const input = await inputFor(h.repo, h.updatedAt);
      if (path === 'confirm') await h.repo.confirmExpenseCas(input);
      else await h.repo.finalizeAndConfirmExpenseCas(input, finalize);
      assert.equal(Number(papers[0].prefillSnapshotJson.grossAmount), source === 'legacy fallback' ? 1402 : 1401.87);
      assert.equal(papers[0].prefillSnapshotJson.withheldAmount, '42.06');
    });
  }
  it('uses an explicit document base before the withheld line taxable sum', async () => {
    const h = harness();
    Object.assign(h.row, { whtAmount: '30', whtRate: '3', whtCategoryCode: 'CAT1', vendorEntityKindSnapshot: 'INDIVIDUAL', whtInputJson: { inputType: 'RATE', value: '3', baseAmount: '1000' } });
    Object.assign(h.row.lines[0], { taxableAmount: '1401.87', whtAmount: '30' });
    let paper: any;
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { paper = data; } };
    await h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), finalize);
    assert.equal(Number(paper.prefillSnapshotJson.grossAmount), 1000);
  });
  it('excludes lines without withholding from the certificate income base', async () => {
    const h = harness();
    Object.assign(h.row, { whtAmount: '42.06', whtRate: '3', whtCategoryCode: 'CAT1', vendorEntityKindSnapshot: 'INDIVIDUAL', grandTotalAmount: '1750', netPayableAmount: '1707.94', outstandingAmount: '1707.94' });
    Object.assign(h.row.lines[0], { taxableAmount: '1401.87', whtAmount: '42.06' });
    h.row.lines.push({ ...h.row.lines[0], id: 'line-2', lineNumber: 2, taxableAmount: '250', whtAmount: '0' });
    let paper: any;
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ผู้จ่าย' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
    h.client.whtIncomeCategory = { findUnique: async () => ({ nameTh: 'ค่าบริการ', formType: 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { paper = data; } };
    await h.repo.confirmExpenseCas(await inputFor(h.repo, h.updatedAt));
    assert.equal(Number(paper.prefillSnapshotJson.grossAmount), 1401.87);
  });

});

describe('confirmation checks legacy withholding income classification inside its transaction', () => {
  it('switches the same-rate twin at confirmation', async () => {
    const h = harness();
    Object.assign(h.row, { vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'WHT_SERVICE_5', whtRate: '3', whtAmount: '3', netPayableAmount: '104', outstandingAmount: '104' });
    Object.assign(h.row.lines[0], { whtAmount: '3', whtRate: '3' });
    const handoffs: any[] = [];
    h.client.company = { findUnique: async () => ({ ...ACTIVE_COMPANY, name: 'ร้านผู้จ่าย', taxId: '9999999999999' }) };
    h.client.branch = { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [{ id: 'branch-1', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }] };
    h.client.whtCertificateHandoff = { findFirst: async () => null, create: async ({ data }: any) => { handoffs.push(data); } };
    h.client.whtIncomeCategory = { findUnique: async ({ where }: any) => ({ code: where.code, formType: where.code === 'WHT_SERVICE_5' ? 'PND53' : 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    const result = await h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), async () => (await finalize()).map(line => ({ ...line, whtRate: '3', whtAmount: '3' })));
    assert.equal(result.expense.whtCategoryCode, 'WHT_SERVICE_3');
    assert.equal(h.row.whtCategoryCode, 'WHT_SERVICE_3');
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].prefillSnapshotJson.incomeCategoryCode, 'WHT_SERVICE_3');
    assert.equal(handoffs[0].prefillSnapshotJson.formType, 'PND3');
  });
  it('refuses a twin with a different rate before confirmation, audit or outbox writes', async () => {
    const h = harness();
    Object.assign(h.row, { vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'WHT_SERVICE_5', whtRate: '5' });
    h.client.whtIncomeCategory = { findUnique: async ({ where }: any) => ({ code: where.code, formType: where.code === 'WHT_SERVICE_5' ? 'PND53' : 'PND3', defaultRate: '3', status: 'ACTIVE' }) };
    await assert.rejects(h.repo.finalizeAndConfirmExpenseCas(await inputFor(h.repo, h.updatedAt), finalize), (error: any) => error.getResponse().code === 'expense_wht_category_payee_mismatch');
    assert.equal(h.row.status, 'READY_FOR_CONFIRMATION');
    assert.equal(h.writes.header, 0); assert.equal(h.writes.outbox, 0);
  });
});

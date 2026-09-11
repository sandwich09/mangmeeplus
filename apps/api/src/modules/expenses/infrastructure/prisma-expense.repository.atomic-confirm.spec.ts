import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expenseEvidenceFingerprint, isBlockingExpenseVatReconciliation, type ExpenseVatMode, type TransactionTaxComponentPreview, type TransactionTaxSnapshot } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic.js';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';
import { ConfirmExpenseUseCase } from '../application/use-cases/expense-draft.use-case';
import { reconcileExpenseVat } from '../domain/logic/expense-vat-reconciliation.logic';
import { ExpenseTransactionTaxService } from '../application/services/expense-transaction-tax.service';
import { TransactionTaxConfigUseCase } from '../../tax/application/use-cases/transaction-tax-config.use-case';
import { aggregatePp30Boxes } from '../../tax/domain/logic/transaction-tax.logic';
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

const reviewFixtures = new WeakMap<PrismaExpenseRepository, () => Promise<void>>();

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
  const audits: any[] = [];
  const client: any = {
    // Added by the expense auto-post work (#59): findByIdWithRelations now reads
    // generated journals to resolve the entry number. No journals in these fixtures.
    journalEntry: { findMany: async () => [] },
    $executeRaw: async () => undefined,
    $transaction: async (work: (tx: any) => Promise<unknown>, config: any) => {
      writes.isolationLevel = config?.isolationLevel;
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
    expenseSubstituteReceiptEvidence: { findFirst: async () => null },
    reimbursementLine: { findFirst: async () => null },
    attachmentLink: {
      findMany: async () => options.withAttachment !== false ? [{
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
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
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
  h.client.company = { findUnique: async () => ({ baseCurrency: 'THB' }) };
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
  const numbers = { reserved: 0, committed: 0, cancelled: 0 };
  const audit = { log: async (entry: any, tx: any) => {
    if (entry.action === 'expense.vat.source_override') {
      assert.equal(tx, h.client, 'source decision must use the final mutation transaction');
      await tx.auditLog.create({ data: entry });
    }
  } };
  const useCase = new ConfirmExpenseUseCase(h.repo, audit as any, transactionTax,
    { execute: async () => { numbers.reserved++; return { id: 'number-1', documentNumber: 'EXP-1' }; } } as any,
    { execute: async () => { numbers.committed++; } } as any,
    { execute: async () => { numbers.cancelled++; } } as any,
    { get: async () => ({ status: 'REGISTERED' }) } as any);
  const ctx: any = { companyId: 'company-1', userId: 'reviewer-1', requestId: 'req-1', authProvider: 'watchdog', permissions: ['expense.confirm', 'expense.review'], scopes: {} };
  await h.review();
  return { ...h, numbers, ctx, useCase, definition, transactionTax };
}

describe('document VAT acceptance through real confirmation and tax resolution', () => {
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
          await assert.rejects(() => h.useCase.execute(h.ctx, 'expense-1'));
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
      assert.deepEqual(h.numbers, { reserved: 1, committed: 0, cancelled: 1 });
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
      assert.deepEqual(h.numbers, { reserved: 0, committed: 0, cancelled: 0 });
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

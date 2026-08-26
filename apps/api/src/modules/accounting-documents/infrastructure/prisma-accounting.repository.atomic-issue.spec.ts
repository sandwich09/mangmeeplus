import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { RequestContext, ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { PrismaAccountingRepository } from './prisma-accounting.repository.js';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository.js';
import { IncomeExpenseLedgerUseCase } from '../application/use-cases/income-expense-ledger.use-case.js';

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

function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '../.env'), join(process.cwd(), '../../.env')]) {
    try {
      const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1]) return match[1];
    } catch {
      // Keep walking toward the workspace root.
    }
  }
  return null;
}

describe('P27 simple-income bundle (real PostgreSQL when available)', () => {
  const companyId = `p27-simple-${process.pid}`;
  let client: PrismaClient | null = null;
  let repo: PrismaAccountingRepository | null = null;
  let reachable = false;

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const [probe] = await client.$queryRaw<Array<{ command_table: string | null; payment_column: boolean }>>`
        SELECT
          to_regclass('"AccountingSimpleIncomeCommand"')::text AS command_table,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'AccountingPayment' AND column_name = 'idempotencyKey'
          ) AS payment_column
      `;
      if (!probe?.command_table || !probe.payment_column) return;
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.company.create({ data: { id: companyId, name: 'P27 simple-income test' } });
      repo = new PrismaAccountingRepository(
        { client } as any,
        new PrismaDocumentSequenceRepository({ client } as any),
      );
      reachable = true;
    } catch {
      reachable = false;
    }
  });

  after(async () => {
    if (!client) return;
    if (reachable) {
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId } });
      await client.accountingPaymentAllocation.deleteMany({ where: { companyId } });
      await client.accountingPayment.deleteMany({ where: { companyId } });
      await client.accountingDocument.deleteMany({ where: { companyId } });
      await client.documentNumber.deleteMany({ where: { companyId } });
      await client.documentSequence.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
    }
    await client.$disconnect();
  });

  const input = (idempotencyKey: string, payloadFingerprint: string, note: string) => ({
    companyId, idempotencyKey, payloadFingerprint, documentDate: '2026-08-26', vatMode: 'NO_VAT' as const,
    paymentMethod: 'BANK_TRANSFER' as const, note,
    lines: [{ lineNumber: 1, description: note, quantity: '1', unitPrice: '100.00', whtRate: '3' }],
    createdByUserId: 'p27-test-user',
  });

  it('rolls back every row on a late failure, then gives one result to concurrent retries', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');

    await assert.rejects(() => repo!.recordSimpleIncomeBundle(
      input('income-fail-0001', 'fingerprint-fail', `${companyId}-fail`),
      async () => { throw new Error('audit unavailable'); },
    ));
    assert.equal(await client.accountingSimpleIncomeCommand.count({ where: { companyId, idempotencyKey: 'income-fail-0001' } }), 0);
    assert.equal(await client.accountingDocument.count({ where: { companyId, note: `${companyId}-fail` } }), 0);
    assert.equal(await client.accountingPayment.count({ where: { companyId, note: `${companyId}-fail` } }), 0);

    const attempts = await Promise.all(Array.from({ length: 6 }, () => repo!.recordSimpleIncomeBundle(
      input('income-race-0001', 'fingerprint-race', `${companyId}-success`),
      async () => undefined,
    )));
    assert.equal(new Set(attempts.map((result) => result.invoice.id)).size, 1);
    assert.equal(attempts.filter((result) => !result.replayed).length, 1);
    const result = attempts[0]!;
    assert.equal(result.invoice.paymentStatus, 'PAID');
    assert.equal(Number(result.invoice.paidAmount), 100);
    assert.equal(Number(result.invoice.outstandingAmount), 0);
    assert.equal(Number(result.payment.amount), 97);
    assert.equal(Number(result.payment.whtAmount), 3);
    assert.equal(result.receipt.sourceDocumentId, result.invoice.id);
    assert.equal(result.receipt.postingStatus, 'not_required', 'auto-receipt must not post settlement twice');
    assert.equal(await client.accountingDocument.count({ where: { companyId } }), 2);
    assert.equal(await client.accountingPayment.count({ where: { companyId } }), 1);
    assert.equal(await client.accountingPaymentAllocation.count({ where: { companyId } }), 1);
    assert.equal(await client.accountingSimpleIncomeCommand.count({ where: { companyId } }), 1);
    assert.equal(await client.documentNumber.count({ where: { companyId, status: 'COMMITTED' } }), 3);

    await assert.rejects(
      () => repo!.recordSimpleIncomeBundle(
        input('income-race-0001', 'different-fingerprint', `${companyId}-changed`),
        async () => undefined,
      ),
      (error: any) => error.getResponse?.().code === 'simple_income_idempotency_conflict',
    );
  });

  it('makes allocated payment retries at-most-once and prevents concurrent over-allocation', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the payment idempotency migration is unavailable');
    const makeInvoice = (note: string) => client!.accountingDocument.create({ data: {
      companyId, documentType: 'INVOICE', status: 'ISSUED', documentDate: new Date('2026-08-27T00:00:00.000Z'),
      currency: 'THB', vatMode: 'NO_VAT', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100',
      paidAmount: '0', outstandingAmount: '100', paymentStatus: 'UNPAID', note, createdByUserId: 'p27-test-user',
    } });
    const payment = (documentId: string, idempotencyKey: string, amount: string) => ({
      companyId, idempotencyKey, payloadFingerprint: `${idempotencyKey}:${amount}`, direction: 'RECEIVED' as const,
      method: 'BANK_TRANSFER' as const, amount, paidAt: '2026-08-27T10:00:00.000Z',
      allocateToDocumentId: documentId, createdByUserId: 'p27-test-user',
    });

    const retryInvoice = await makeInvoice(`${companyId}-payment-retry`);
    const retries = await Promise.all(Array.from({ length: 4 }, () => repo!.createPayment(
      payment(retryInvoice.id, 'payment-retry-0001', '100.00'),
    )));
    assert.equal(new Set(retries.map((result) => result.payment.id)).size, 1);
    assert.equal(retries.filter((result) => !result.replayed).length, 1);
    assert.equal(await client.accountingPaymentAllocation.count({ where: { companyId, documentId: retryInvoice.id } }), 1);

    const raceInvoice = await makeInvoice(`${companyId}-payment-race`);
    const race = await Promise.allSettled([
      repo.createPayment(payment(raceInvoice.id, 'payment-race-0001', '60.00')),
      repo.createPayment(payment(raceInvoice.id, 'payment-race-0002', '60.00')),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 2);
    const persisted = await client.accountingDocument.findUniqueOrThrow({ where: { id: raceInvoice.id } });
    assert.equal(Number(persisted.paidAmount), 100);
    assert.equal(Number(persisted.outstandingAmount), 0);
    const allocations = await client.accountingPaymentAllocation.findMany({ where: { companyId, documentId: raceInvoice.id } });
    assert.equal(allocations.reduce((total, row) => total + Number(row.amount), 0), 100);
    const racePaymentIds = race.flatMap((result) => result.status === 'fulfilled' ? [result.value.payment.id] : []);
    const payments = await client.accountingPayment.findMany({ where: { id: { in: racePaymentIds } } });
    assert.equal(payments.reduce((total, row) => total + Number(row.unappliedAmount), 0), 20);
  });

  it('keeps mixed 7% and zero-rate line arithmetic through invoice, payment, and receipt', async (t) => {
    if (!reachable || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const result = await repo.recordSimpleIncomeBundle({
      ...input('income-mixed-0001', 'fingerprint-mixed', `${companyId}-mixed`),
      vatMode: 'VAT_EXCLUDED',
      lines: [
        { lineNumber: 1, description: 'บริการ VAT 7%', quantity: '1', unitPrice: '100.00', vatRate: '7' },
        { lineNumber: 2, description: 'รายการอัตรา 0%', quantity: '1', unitPrice: '100.00', vatRate: '0' },
      ],
    }, async () => undefined);
    assert.equal(Number(result.invoice.taxableAmount), 200);
    assert.equal(Number(result.invoice.vatAmount), 7);
    assert.equal(Number(result.invoice.grandTotalAmount), 207);
    assert.equal(Number(result.payment.amount), 207);
    assert.equal(Number(result.receipt.grandTotalAmount), 207);
    assert.equal(result.invoice.paymentStatus, 'PAID');
  });

  it('keeps the six ledger definitions, permission split, Bangkok payment boundary, and export on one dataset', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const ledgerCompanyId = `${companyId}-ledger`;
    const ctx: RequestContext = {
      requestId: 'p27-ledger-request', authSubject: 'p27-ledger-user', userId: 'p27-ledger-user', companyId: ledgerCompanyId,
      membershipId: 'p27-ledger-membership', roles: [], scopes: { branchIds: [] }, authProvider: 'watchdog',
      permissions: ['accounting.document.read', 'accounting.document.export', 'expense.read', 'expense.export'],
    };
    try {
      await client.company.create({ data: { id: ledgerCompanyId, name: 'P27 ledger test' } });
      await client.companyTaxProfile.create({ data: { companyId: ledgerCompanyId, accountingPeriodMonth: 12 } });
      const allowedBranch = await client.branch.create({ data: {
        companyId: ledgerCompanyId, code: 'P27-ALLOWED', name: 'สาขาที่มีสิทธิ์', type: 'BRANCH', createdByUserId: ctx.userId,
      } });
      const forbiddenBranch = await client.branch.create({ data: {
        companyId: ledgerCompanyId, code: 'P27-FORBIDDEN', name: 'สาขาที่ไม่มีสิทธิ์', type: 'BRANCH', createdByUserId: ctx.userId,
      } });
      ctx.scopes = { branchIds: [allowedBranch.id] };
      const counterparty = await client.accountingCounterparty.create({ data: {
        companyId: ledgerCompanyId, type: 'CUSTOMER', displayName: 'ลูกค้าทดสอบ', createdByUserId: ctx.userId,
      } });
      const incomeBundle = await repo.recordSimpleIncomeBundle({
        companyId: ledgerCompanyId, idempotencyKey: 'ledger-income-0001', payloadFingerprint: 'ledger-fingerprint',
        documentDate: '2026-08-01', counterpartyId: counterparty.id, vatMode: 'NO_VAT', paymentMethod: 'BANK_TRANSFER',
        lines: [{ lineNumber: 1, description: 'รายรับทดสอบ', quantity: '1', unitPrice: '100.00', whtRate: '3' }],
        createdByUserId: ctx.userId,
      }, async () => undefined);
      await client.accountingDocument.update({ where: { id: incomeBundle.invoice.id }, data: { dueDate: new Date('2026-08-15T00:00:00.000Z') } });
      const creditNote = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-LEDGER-0001',
        status: 'ISSUED', documentDate: new Date('2026-08-02T00:00:00.000Z'), sourceDocumentId: incomeBundle.invoice.id,
        counterpartyId: counterparty.id, counterpartySnapshotJson: { displayName: counterparty.displayName },
        subtotalAmount: '10', taxableAmount: '10', grandTotalAmount: '10', outstandingAmount: '10',
        paymentStatus: 'UNPAID', adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: creditNote.id, lineNumber: 1, description: 'ลดราคาทดสอบ',
        quantity: '1', unitPrice: '10', lineSubtotalAmount: '10', lineTotalAmount: '10',
      } });
      const allowedBranchInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, branchId: allowedBranch.id, documentType: 'INVOICE',
        documentNumber: 'INV-P27-ALLOWED-0001', status: 'ISSUED', documentDate: new Date('2026-08-03T00:00:00.000Z'),
        dueDate: new Date('2026-08-20T00:00:00.000Z'), subtotalAmount: '20', taxableAmount: '20', grandTotalAmount: '20',
        paidAmount: '0', outstandingAmount: '20', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: allowedBranchInvoice.id, lineNumber: 1, description: 'รายรับสาขาที่มีสิทธิ์',
        quantity: '1', unitPrice: '20', lineSubtotalAmount: '20', lineTotalAmount: '20',
      } });
      const forbiddenBranchInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, branchId: forbiddenBranch.id, documentType: 'INVOICE',
        documentNumber: 'INV-P27-FORBIDDEN-0001', status: 'ISSUED', documentDate: new Date('2026-08-03T00:00:00.000Z'),
        dueDate: new Date('2026-08-20T00:00:00.000Z'), subtotalAmount: '900', taxableAmount: '900', grandTotalAmount: '900',
        paidAmount: '0', outstandingAmount: '900', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: forbiddenBranchInvoice.id, lineNumber: 1, description: 'รายรับสาขาที่ไม่มีสิทธิ์',
        quantity: '1', unitPrice: '900', lineSubtotalAmount: '900', lineTotalAmount: '900',
      } });
      const ytdInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'INVOICE', documentNumber: 'INV-P27-YTD-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-15T00:00:00.000Z'), subtotalAmount: '1500000', taxableAmount: '1500000',
        grandTotalAmount: '1500000', paidAmount: '1500000', outstandingAmount: '0', paymentStatus: 'PAID',
        vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      const standaloneTaxInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'TAX_INVOICE', documentNumber: 'TAX-P27-STANDALONE-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-20T00:00:00.000Z'), subtotalAmount: '100000', taxableAmount: '100000',
        grandTotalAmount: '100000', paidAmount: '100000', outstandingAmount: '0', paymentStatus: 'PAID',
        vatMode: 'NO_VAT', outputTaxCode: 'O0', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: standaloneTaxInvoice.id, lineNumber: 1, description: 'ใบกำกับภาษีต้นทาง',
        quantity: '1', unitPrice: '100000', lineSubtotalAmount: '100000', lineTotalAmount: '100000',
      } });
      const standaloneTaxCredit = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-TAX-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-21T00:00:00.000Z'), sourceDocumentId: standaloneTaxInvoice.id,
        sourceDocumentType: 'TAX_INVOICE', subtotalAmount: '50000', taxableAmount: '50000', grandTotalAmount: '50000',
        paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', outputTaxCode: 'O0',
        adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: standaloneTaxCredit.id, lineNumber: 1, description: 'ลดใบกำกับภาษีต้นทาง',
        quantity: '1', unitPrice: '50000', lineSubtotalAmount: '50000', lineTotalAmount: '50000',
      } });
      const linkedTaxInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'TAX_INVOICE', documentNumber: 'TAX-P27-LINKED-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-22T00:00:00.000Z'), sourceDocumentId: ytdInvoice.id, sourceDocumentType: 'INVOICE',
        subtotalAmount: '1500000', taxableAmount: '1500000', grandTotalAmount: '1500000', paidAmount: '1500000',
        outstandingAmount: '0', paymentStatus: 'PAID', vatMode: 'NO_VAT', outputTaxCode: 'O0', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: linkedTaxInvoice.id, lineNumber: 1, description: 'ใบกำกับภาษีที่อ้างใบแจ้งหนี้',
        quantity: '1', unitPrice: '1500000', lineSubtotalAmount: '1500000', lineTotalAmount: '1500000',
      } });
      const linkedTaxCredit = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-LINKED-TAX-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-23T00:00:00.000Z'), sourceDocumentId: linkedTaxInvoice.id,
        sourceDocumentType: 'TAX_INVOICE', subtotalAmount: '25000', taxableAmount: '25000', grandTotalAmount: '25000',
        paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', outputTaxCode: 'O0',
        adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: linkedTaxCredit.id, lineNumber: 1, description: 'ลดใบกำกับภาษีที่อ้างใบแจ้งหนี้',
        quantity: '1', unitPrice: '25000', lineSubtotalAmount: '25000', lineTotalAmount: '25000',
      } });
      await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'INVOICE', documentNumber: 'INV-P27-VOIDED-0001', status: 'VOIDED',
        documentDate: new Date('2026-02-15T00:00:00.000Z'), subtotalAmount: '1000000', taxableAmount: '1000000',
        grandTotalAmount: '1000000', paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID',
        vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      const expense = await client.expenseRecord.create({ data: {
        companyId: ledgerCompanyId, status: 'CONFIRMED', expenseDate: new Date('2026-08-01T00:00:00.000Z'),
        grandTotalAmount: '50', netPayableAmount: '50', paidAmount: '20', outstandingAmount: '30',
        paymentStatus: 'PARTIALLY_PAID', createdByUserId: ctx.userId,
      } });
      await client.expenseLine.create({ data: {
        companyId: ledgerCompanyId, expenseId: expense.id, lineNumber: 1, description: 'รายจ่ายทดสอบ',
        quantity: '1', unitPrice: '50', taxableAmount: '50', lineSubtotalAmount: '50', lineTotalAmount: '50',
      } });
      await client.expensePayment.createMany({ data: [
        { companyId: ledgerCompanyId, expenseId: expense.id, amount: '20', paidAt: new Date('2026-07-31T17:00:00.000Z'), createdByUserId: ctx.userId },
        { companyId: ledgerCompanyId, expenseId: expense.id, amount: '99', paidAt: new Date('2026-07-31T16:59:59.999Z'), createdByUserId: ctx.userId },
      ] });

      const ledger = new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { throw new Error('branch-scoped ledger must not load a company-wide VAT total'); } } as any,
      );
      const summary = await ledger.summary(ctx, '2026-08-01', '2026-08-31');
      assert.deepEqual({
        sales: summary.income.salesDocumentTotal, received: summary.income.receivedTotal,
        wht: summary.income.withheldTaxTotal, outstanding: summary.income.receivableOutstanding,
        expense: summary.expense.recordedExpenseTotal, paid: summary.expense.paidExpenseTotal,
        cashDifference: summary.cashDifference, documentDifference: summary.documentDifference,
      }, {
        sales: '110.00', received: '100.00', wht: '3.00', outstanding: '20.00',
        expense: '50.00', paid: '20.00', cashDifference: '80.00', documentDifference: '60.00',
      });
      const incomeOnly = await ledger.summary({ ...ctx, permissions: ['accounting.document.read'] }, '2026-08-01', '2026-08-31');
      assert.equal(incomeOnly.income.available, true);
      assert.equal(incomeOnly.income.vatRegistrationAlert, undefined);
      assert.deepEqual(incomeOnly.expense, { available: false, unavailableReason: 'NO_PERMISSION', byCategory: [] });
      assert.equal(incomeOnly.cashDifference, undefined);

      let vatStatusReads = 0;
      const companyWideLedger = new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { vatStatusReads += 1; return { status: 'NOT_REGISTERED' }; } } as any,
      );
      const companyWidePermissions = [
        ...ctx.permissions, 'company.vat_registration.read', 'tax.profile.read',
      ];
      const companyWide = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: companyWidePermissions },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.deepEqual(companyWide.income.vatRegistrationAlert, {
        level: 'APPROACHING', periodBasis: 'ACCOUNTING_PERIOD', periodStart: '2026-01-01', periodEnd: '2026-08-27',
        salesDocumentTotal: '1526010.00', thresholdAmount: '1800000.00',
      });
      assert.equal(vatStatusReads, 1);

      const missingVatPermission = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: [...ctx.permissions, 'tax.profile.read'] },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(missingVatPermission.income.vatRegistrationAlert, undefined);
      assert.equal(vatStatusReads, 1, 'VAT status is not read without company.vat_registration.read');

      const missingTaxProfilePermission = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: [...ctx.permissions, 'company.vat_registration.read'] },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(missingTaxProfilePermission.income.vatRegistrationAlert, undefined);
      assert.equal(vatStatusReads, 1, 'VAT status is not read when the protected accounting period cannot be read');

      const accessorUnavailable = await new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { throw new Error('temporary VAT accessor outage'); } } as any,
      ).summary(
        { ...ctx, scopes: {}, permissions: companyWidePermissions },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(accessorUnavailable.income.available, true);
      assert.equal(accessorUnavailable.income.vatRegistrationAlert, undefined);

      const januaryIncome = await ledger.entries(ctx, { type: 'INCOME', from: '2026-01-01', to: '2026-01-31' });
      assert.deepEqual(
        new Set(januaryIncome.data.map((row) => row.id)),
        new Set([ytdInvoice.id, standaloneTaxInvoice.id, standaloneTaxCredit.id, linkedTaxCredit.id]),
        'standalone TAX_INVOICE is a revenue root; linked TAX_INVOICE is evidence while its correction still adjusts revenue',
      );

      const entries = await ledger.entries(ctx, { type: 'ALL', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(entries.total, 4, 'evidence-only receipt and the forbidden branch are not income rows');
      assert.deepEqual(new Set(entries.data.map((row) => row.side)), new Set(['INCOME', 'EXPENSE']));
      assert.equal(entries.data.some((row) => row.id === forbiddenBranchInvoice.id), false);
      const incomeEntry = entries.data.find((row) => row.id === incomeBundle.invoice.id)!;
      assert.match(incomeEntry.evidenceHref, /\/sales-documents\?documentId=/);
      assert.equal(incomeEntry.dueDate, '2026-08-15');
      assert.equal(incomeEntry.counterpartyId, counterparty.id);
      assert.equal(incomeEntry.partyName, 'ลูกค้าทดสอบ');
      const creditEntry = entries.data.find((row) => row.id === creditNote.id);
      assert.equal(creditEntry?.amount, '-10.00');
      assert.equal(creditEntry?.outstandingAmount, undefined, 'credit notes reduce income but never display as receivable');
      const receivables = await ledger.entries(ctx, { type: 'RECEIVABLE', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(receivables.total, 1, 'only the allowed-branch invoice is receivable');
      assert.equal(receivables.data[0]?.id, allowedBranchInvoice.id);
      const exported = await ledger.export(ctx, { type: 'ALL', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(exported.rowCount, 4);
      assert.match(exported.csv, /รายรับ/);
      assert.doesNotMatch(exported.csv, /INV-P27-FORBIDDEN-0001/);
      assert.ok(Buffer.from(exported.xlsxBase64, 'base64').subarray(0, 2).equals(Buffer.from('PK')));
    } finally {
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingPaymentAllocation.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingPayment.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingDocument.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingCounterparty.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.documentNumber.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.documentSequence.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expensePayment.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expenseLine.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expenseRecord.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.companyTaxProfile.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.company.deleteMany({ where: { id: ledgerCompanyId } });
    }
  });
});

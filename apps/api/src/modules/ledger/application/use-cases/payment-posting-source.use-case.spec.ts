import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAccountingPaymentPostingSource } from '../../../accounting-documents/application/use-cases/posting-source.use-case.js';
import { buildSupplierPaymentPp36PostingSource, buildSupplierPaymentPostingSource } from '../../../procurement/application/use-cases/supplier-payment.use-case.js';
import { GenerateJournalFromSourceUseCase } from './journal.use-case.js';
import { buildDefaultPostingLines, DEFAULT_ACCOUNT_CODES } from '../../domain/logic/posting-engine.logic.js';

describe('canonical payment posting sources', () => {
  it('assigns payments after Bangkok midnight to the new civil day and month', () => {
    const instant = new Date('2026-08-31T19:00:00.000Z'); // 02:00 on 1 Sep in Bangkok
    const accounting = buildAccountingPaymentPostingSource({
      id: 'payment-bkk', companyId: 'company-1', direction: 'RECEIVED', status: 'RECORDED',
      method: 'BANK_TRANSFER', amount: '1.0000', allocatedAmount: '1.0000', unappliedAmount: '0', currency: 'THB',
      paidAt: instant, postingStatus: 'pending', createdByUserId: 'user-1', createdAt: instant, updatedAt: instant,
    } as any);
    const supplier = buildSupplierPaymentPostingSource({
      id: 'supplier-payment-bkk', companyId: 'company-1', status: 'RECORDED', supplierId: 'supplier-1',
      paymentDate: instant, method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '1.0000', whtAmount: '0',
      netPaidAmount: '1.0000', allocatedAmount: '1.0000', unappliedAmount: '0', postingStatus: 'pending', taxSyncStatus: 'pending',
      createdByUserId: 'user-1', createdAt: instant, updatedAt: instant, allocations: [],
    } as any);

    assert.deepEqual(
      [accounting.sourceDate, accounting.periodKey, supplier.sourceDate, supplier.periodKey],
      ['2026-09-01', '2026-09', '2026-09-01', '2026-09'],
    );
  });

  it('posts an accounting receipt from server-owned date, amount, direction and branch', () => {
    const source = buildAccountingPaymentPostingSource({
      id: 'payment-1', companyId: 'company-1', branchId: 'branch-1', direction: 'RECEIVED', status: 'RECORDED',
      method: 'BANK_TRANSFER', amount: '107.0000', allocatedAmount: '107.0000', unappliedAmount: '0', currency: 'THB',
      paidAt: new Date('2026-08-15T00:00:00.000Z'), postingStatus: 'pending', createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(),
    } as any);
    assert.equal(source.sourceEventType, 'accounting.payment.received');
    assert.equal(source.periodKey, '2026-08');
    assert.equal(source.totalAmount, '107.0000');
    const lines = buildDefaultPostingLines(source)!;
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.CASH_OR_BANK)?.debitAmount, '107.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)?.creditAmount, '107.0000');
  });

  it('posts a receipt where the customer withheld tax as receivable settled, split across cash and the tax credit', () => {
    const source = buildAccountingPaymentPostingSource({
      id: 'payment-2', companyId: 'company-1', branchId: 'branch-1', direction: 'RECEIVED', status: 'RECORDED',
      method: 'BANK_TRANSFER', amount: '1040.0000', whtAmount: '30.0000', allocatedAmount: '1040.0000', unappliedAmount: '0', currency: 'THB',
      paidAt: new Date('2026-08-15T00:00:00.000Z'), postingStatus: 'pending', createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(),
    } as any);
    // AR must be relieved by what was settled, or the invoice stays open by the withheld amount.
    assert.equal(source.totalAmount, '1070.0000');
    assert.equal(source.whtTotal, '30.0000');
    // The bank statement figure stays on the payment block for reconciliation.
    assert.equal(source.payment?.amount, '1040.0000');
    const lines = buildDefaultPostingLines(source)!;
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)?.creditAmount, '1070.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.CASH_OR_BANK)?.debitAmount, '1040.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.WHT_RECEIVABLE)?.debitAmount, '30.0000');
  });

  it('posts supplier payment debt cleared as Dr AP, splitting the credit between bank and withheld tax', () => {
    // 103 of debt settled, 3 withheld, 100 transferred. This used to post the NET against AP, which
    // left the withheld 3 outstanding against the vendor forever and never credited the RD.
    const source = buildSupplierPaymentPostingSource({
      id: 'supplier-payment-1', companyId: 'company-1', branchId: 'branch-1', status: 'RECORDED', supplierId: 'supplier-1',
      paymentDate: new Date('2026-08-15T00:00:00.000Z'), method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '103.0000',
      whtAmount: '3.0000', netPaidAmount: '100.0000', allocatedAmount: '103.0000', unappliedAmount: '0', postingStatus: 'pending', taxSyncStatus: 'pending',
      createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(), allocations: [{ id: 'allocation-1', vendorBillId: 'bill-1', amount: '103.0000', whtAmount: '3.0000' }],
    } as any);
    assert.equal(source.sourceType, 'procurement.supplier_payment');
    assert.equal(source.totalAmount, '103.0000');
    assert.equal(source.whtTotal, '3.0000');
    // PP36 stays its own posting source; commercial VAT is never folded in here.
    assert.equal(source.taxTotal, '0');
    // The cash figure the bank statement will show stays on the payment block for reconciliation.
    assert.equal(source.payment?.amount, '100.0000');
    const lines = buildDefaultPostingLines(source)!;
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE)?.debitAmount, '103.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.CASH_OR_BANK)?.creditAmount, '100.0000');
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.WHT_PAYABLE)?.creditAmount, '3.0000');
  });

  it('leaves a supplier payment that withheld nothing on its original two lines', () => {
    const source = buildSupplierPaymentPostingSource({
      id: 'supplier-payment-2', companyId: 'company-1', branchId: 'branch-1', status: 'RECORDED', supplierId: 'supplier-1',
      paymentDate: new Date('2026-08-15T00:00:00.000Z'), method: 'BANK_TRANSFER', currency: 'THB', grossAmount: '100.0000',
      whtAmount: '0', netPaidAmount: '100.0000', allocatedAmount: '100.0000', unappliedAmount: '0', postingStatus: 'pending', taxSyncStatus: 'pending',
      createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(), allocations: [{ id: 'allocation-2', vendorBillId: 'bill-2', amount: '100.0000' }],
    } as any);
    assert.equal(source.totalAmount, '100.0000');
    const lines = buildDefaultPostingLines(source)!;
    assert.equal(lines.length, 2);
    assert.equal(lines.find((line) => line.accountId === DEFAULT_ACCOUNT_CODES.CASH_OR_BANK)?.creditAmount, '100.0000');
  });

  it('uses immutable payment-allocation and source-line identities for each PP36 partial-payment journal', () => {
    const snapshot = {
      taxCodeDefinitionId: 'definition-1', externalTaxCode: 'V3', taxProfileKey: 'TH', taxProfileVersion: 1,
      taxRegime: 'VAT', taxDirection: 'SELF_ASSESSED', taxTreatment: 'REVERSE_CHARGE', taxContext: 'IMPORT_SERVICE', taxRate: '7',
      sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'BOT', exchangeRateDate: '2026-08-15',
      taxBaseAmount: '1750', taxAmount: '122.5', claimability: 'NOT_APPLICABLE', evidenceStatus: 'VERIFIED',
      accountRuleVersion: 1, reportRuleVersion: 1, recognitionDate: '2026-08-15T00:00:00.000Z', evidenceRefs: ['evidence-1'],
    } as any;
    const output = { componentKey: 'PP36_OUTPUT', snapshot, accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'out', accountAssignments: [], reportContributions: [] } as any;
    const pending = { componentKey: 'PP36_INPUT', snapshot: { ...snapshot, claimability: 'PENDING_EVIDENCE', evidenceStatus: 'REVIEW_REQUIRED' }, accountRole: 'INPUT_VAT_PENDING', accountId: 'pending', accountAssignments: [], reportContributions: [] } as any;
    const recognition = {
      recognitionKey: 'allocation-1:line-1', vendorBillLineId: 'line-1', sourceTaxBaseAmount: '50', evidenceIds: ['evidence-1'],
      preview: { snapshot, components: [output, pending], accountRole: null, accountId: null, reportContributions: [], warnings: [], errors: [], sourceChecksum: 's', configurationChecksum: 'c' },
    };
    const source = buildSupplierPaymentPp36PostingSource({
      id: 'payment-1', companyId: 'company-1', status: 'RECORDED', supplierId: 'supplier-1', paymentDate: new Date('2026-08-15'),
      method: 'BANK_TRANSFER', currency: 'USD', netPaidAmount: '50', grossAmount: '50', whtAmount: '0', allocatedAmount: '50', unappliedAmount: '0',
      postingStatus: 'posted', taxSyncStatus: 'pending', createdByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date(),
      allocations: [{
        id: 'allocation-1', companyId: 'company-1', supplierPaymentId: 'payment-1', vendorBillId: 'bill-1', amount: '50',
        pp36RecognitionStatus: 'ACTIVE', pp36RecognitionJson: [recognition],
      }],
    } as any);
    assert.equal(source.sourceType, 'procurement.supplier_payment.pp36');
    assert.equal(source.sourceId, 'payment-1');
    assert.equal(source.currency, 'THB');
    assert.equal(source.lines[0]?.sourceLineId, 'allocation-1:line-1');
    assert.deepEqual(source.lines[0]?.taxComponents?.map((component) => component.componentKey), ['PP36_OUTPUT', 'PP36_INPUT']);
  });

  it('rejects unknown raw posting source types instead of accepting caller-shaped lines', async () => {
    const useCase = new GenerateJournalFromSourceUseCase({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await assert.rejects(() => useCase.execute({ companyId: 'company-1', permissions: ['journal.entry.post'], scopes: {} } as any, {
      companyId: 'company-1', sourceType: 'caller.raw', sourceId: 'raw-1', sourceEventType: 'accounting.payment.made', idempotencyKey: 'forged',
      sourceDate: '2026-08-15', periodKey: '2026-08', currency: 'THB', totalAmount: '999999', lines: [],
    }), (error: any) => error?.getResponse?.().code === 'unsupported_posting_source');
  });

  it('repairs the source status when a retry finds an existing generated journal', async () => {
    const existing = {
      id: 'journal-1', companyId: 'company-1', periodId: 'period-1', entryNumber: 'JV-202607-00001',
      entryType: 'GENERATED', sourceType: 'expense.record', sourceId: 'expense-1',
      reversalOfJournalEntryId: null, status: 'POSTED', entryDate: new Date('2026-07-01'),
      postedAt: new Date('2026-07-01'), postedByUserId: 'user-1', memo: 'EXP-1',
      createdByUserId: 'user-1', lines: [], createdAt: new Date('2026-07-01'), updatedAt: new Date('2026-07-01'),
    };
    let repaired: any;
    const ledgerRepo = { findGeneratedJournal: async () => existing } as any;
    const expenseRepo = {
      findByIdWithRelations: async () => ({
        id: 'expense-1', companyId: 'company-1', branchId: null, status: 'CONFIRMED',
        expenseNumber: 'EXP-1', expenseDate: new Date('2026-07-01'), currency: 'THB',
        vendorCounterpartyId: null, grandTotalAmount: '100', vatAmount: '0', whtAmount: '0',
        paidAmount: '0', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY',
        lines: [],
      }),
      updatePostingStatus: async (_companyId: string, _expenseId: string, value: any) => { repaired = value; },
    } as any;
    const prisma = { client: { company: { findUnique: async () => ({ baseCurrency: 'THB' }) } } } as any;
    const useCase = new GenerateJournalFromSourceUseCase(
      ledgerRepo, {} as any, {} as any, {} as any, {} as any, {} as any,
      expenseRepo, {} as any, {} as any, prisma,
    );

    const result = await useCase.execute(
      { companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions: ['journal.entry.post'], scopes: {} } as any,
      { sourceType: 'expense.record', sourceId: 'expense-1' } as any,
    );

    assert.equal(result.entryNumber, 'JV-202607-00001');
    assert.deepEqual(repaired, { postingStatus: 'posted', journalEntryId: 'journal-1', postingError: null });
  });
});

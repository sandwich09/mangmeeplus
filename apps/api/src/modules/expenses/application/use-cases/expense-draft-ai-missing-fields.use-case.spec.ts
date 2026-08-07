// A review save that supplies a value IS the human confirmation the AI `missingFields` flag was
// asking for, so the flag is cleared here. The guided stepper derives its green/⚠ state from these
// flags, so a flag that never clears leaves the step permanently unfinished.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const audit = { log: async () => undefined } as any;
const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'mem-1', roles: [], permissions: ['expense.review', 'expense.update'],
  scopes: {}, authProvider: 'watchdog',
};

function makeUseCase(missingFields: string[]) {
  const updates: any[] = [];
  const repo = {
    findById: async () => ({
      id: 'exp-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
      currency: 'THB', expenseDate: new Date('2026-08-04T00:00:00.000Z'),
      aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields },
    }),
    findByIdWithRelations: async () => ({ lines: [] }),
    updateExpense: async (input: any) => { updates.push(input); return input; },
    upsertLines: async () => undefined,
  } as any;
  return { useCase: new UpdateExpenseDraftUseCase(repo, audit, transactionTax), updates };
}

const nextMissing = (updates: any[]) => updates[0].aiVerificationSummaryJson?.missingFields;

describe('UpdateExpenseDraftUseCase AI missingFields clearing', () => {
  it('clears the flag for each field the save supplies, under every alias', async () => {
    const { useCase, updates } = makeUseCase(['vendor', 'vendorName', 'vendorTaxId', 'documentNumber', 'expenseDate']);

    await useCase.execute(ctx, 'exp-1', {
      vendorNameSnapshot: 'Starbucks Coffee', vendorTaxIdSnapshot: '0105541008688',
      vendorDocumentNumber: '260717-01-04092', expenseDate: '2026-07-17',
    } as any);

    assert.deepEqual(nextMissing(updates), []);
  });

  it('clears the amount flags only once the saved lines total above zero', async () => {
    const priced = makeUseCase(['grandTotalAmount', 'amount', 'vatAmount']);
    await priced.useCase.execute(ctx, 'exp-1', {
      lines: [{ lineNumber: 1, description: 'G.GREEN TEA FR', quantity: '1', unitPrice: '185', discountAmount: '0', vatRate: '0.07' }],
    } as any);
    assert.deepEqual(nextMissing(priced.updates), []);

    const zero = makeUseCase(['grandTotalAmount', 'amount', 'vatAmount']);
    await zero.useCase.execute(ctx, 'exp-1', {
      lines: [{ lineNumber: 1, description: 'ของแถม', quantity: '1', unitPrice: '0', discountAmount: '0', vatRate: '0' }],
    } as any);
    assert.deepEqual(nextMissing(zero.updates), ['grandTotalAmount', 'amount']);
  });

  it('leaves flags the save did not answer, and receipt_evidence always', async () => {
    const { useCase, updates } = makeUseCase(['receipt_evidence', 'vendorName', 'vendorTaxId', 'category']);

    await useCase.execute(ctx, 'exp-1', { vendorNameSnapshot: 'Starbucks Coffee' } as any);

    assert.deepEqual(nextMissing(updates), ['receipt_evidence', 'vendorTaxId', 'category']);
  });

  it('treats a blank value as no answer at all', async () => {
    const { useCase, updates } = makeUseCase(['vendorName']);

    await useCase.execute(ctx, 'exp-1', { vendorNameSnapshot: '   ' } as any);

    assert.equal(updates[0].aiVerificationSummaryJson, undefined);
  });

  it('does not touch the summary when nothing was resolved', async () => {
    const { useCase, updates } = makeUseCase(['vendorTaxId']);

    await useCase.execute(ctx, 'exp-1', { note: 'ค่ากาแฟทีมงาน' } as any);

    assert.equal(updates[0].aiVerificationSummaryJson, undefined);
  });

  it('clears the category flag from a review save that picks one', async () => {
    const { useCase, updates } = makeUseCase(['category']);

    await useCase.execute(ctx, 'exp-1', { expenseCategoryId: 'cat-1' } as any);

    assert.deepEqual(nextMissing(updates), []);
  });
});

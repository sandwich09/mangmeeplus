import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateDocumentUseCase } from './document.use-case';
import { CreatePaymentUseCase } from './payment.use-case';
import { RecordSimpleIncomeUseCase, simpleIncomePayloadFingerprint } from './record-simple-income.use-case';

const ctx: RequestContext = {
  requestId: 'request-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], scopes: { branchIds: [] }, authProvider: 'watchdog',
  permissions: ['accounting.document.create', 'accounting.payment.create'],
};

const paymentInput = (amount: string) => ({
  direction: 'RECEIVED' as const,
  method: 'BANK_TRANSFER' as const,
  amount,
  paidAt: '2026-07-18T10:00:00.000Z',
});

describe('P27 simple-income use-case boundary', () => {
  const input = {
    idempotencyKey: 'income_retry_001', documentDate: '2026-08-26', vatMode: 'NO_VAT' as const,
    paymentMethod: 'BANK_TRANSFER' as const,
    lines: [{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '100.00', revenueCategoryId: 'revenue-1' }],
  };
  const fullCtx = {
    ...ctx,
    permissions: ['accounting.invoice.create', 'accounting.invoice.issue', 'accounting.payment.create', 'accounting.receipt.issue'],
  };
  const result = {
    invoice: { id: 'invoice-1', issuedAt: new Date(), documentNumber: 'INV-1', grandTotalAmount: '100.00' },
    payment: { id: 'payment-1', amount: '100.00', whtAmount: '0.00', method: 'BANK_TRANSFER', direction: 'RECEIVED' },
    receipt: { id: 'receipt-1', documentNumber: 'RC-1' },
    replayed: false,
  } as any;

  it('fingerprints canonical payloads deterministically and changes on material input', () => {
    assert.equal(simpleIncomePayloadFingerprint(input), simpleIncomePayloadFingerprint({ ...input }));
    assert.notEqual(simpleIncomePayloadFingerprint(input), simpleIncomePayloadFingerprint({ ...input, paymentMethod: 'CASH' }));
  });

  it('requires the complete permission set before opening the bundle transaction', async () => {
    let called = false;
    const useCase = new RecordSimpleIncomeUseCase(
      { recordSimpleIncomeBundle: async () => { called = true; return result; } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
    );
    await assert.rejects(() => useCase.execute({ ...fullCtx, permissions: ['accounting.invoice.create'] }, input));
    assert.equal(called, false);
  });

  it('writes the audit inside the transaction and emits three events only for a new bundle', async () => {
    const events: string[] = [];
    let auditDb: unknown;
    const transactionDb = { tag: 'same-transaction' };
    const useCase = new RecordSimpleIncomeUseCase(
      { recordSimpleIncomeBundle: async (_input: any, hook: any) => {
        await hook(transactionDb, result);
        return result;
      } } as any,
      { log: async (_entry: any, db: unknown) => { auditDb = db; } } as any,
      { append: async (event: string) => { events.push(event); } } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
    );
    const created = await useCase.execute(fullCtx, input);
    assert.equal(created.receipt.documentNumber, 'RC-1');
    assert.equal(auditDb, transactionDb);
    assert.deepEqual(events.sort(), ['accounting.invoice.issued', 'accounting.payment.recorded', 'accounting.receipt.issued']);
  });

  it('does not emit duplicate events when the command is replayed', async () => {
    let events = 0;
    const useCase = new RecordSimpleIncomeUseCase(
      { recordSimpleIncomeBundle: async () => ({ ...result, replayed: true }) } as any,
      { log: async () => undefined } as any,
      { append: async () => { events += 1; } } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
    );
    assert.equal((await useCase.execute(fullCtx, input)).replayed, true);
    assert.equal(events, 0);
  });

  it('blocks VAT modes for a company that is not VAT registered', async () => {
    let called = false;
    const useCase = new RecordSimpleIncomeUseCase(
      { recordSimpleIncomeBundle: async () => { called = true; return result; } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'NOT_REGISTERED' }) } as any,
    );
    await assert.rejects(() => useCase.execute(fullCtx, { ...input, vatMode: 'VAT_EXCLUDED' }));
    assert.equal(called, false);
  });
});

describe('H-05 use-case revalidation', () => {
  it('rejects invalid payment money before the repository transaction', async () => {
    let creates = 0;
    const repo = {
      findDocumentById: async () => null,
      createPayment: async () => { creates += 1; throw new Error('must not persist'); },
    };
    const useCase = new CreatePaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);

    for (const amount of ['-1.00', '0.00', 'NaN', 'Infinity', '0.001', '100000000000000.00']) {
      await assert.rejects(() => useCase.execute(ctx, paymentInput(amount)));
    }
    assert.equal(creates, 0);
  });

  it('rejects an invalid allocation target before persistence', async () => {
    let creates = 0;
    const repo = {
      findDocumentById: async () => ({
        documentType: 'INVOICE', status: 'DRAFT', currency: 'THB',
        outstandingAmount: '100.00',
      }),
      createPayment: async () => { creates += 1; throw new Error('must not persist'); },
    };
    const useCase = new CreatePaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);
    await assert.rejects(() => useCase.execute(ctx, { ...paymentInput('150.00'), allocateToDocumentId: 'doc-1' }));
    assert.equal(creates, 0);
  });

  it('keeps valid overpayment for repository allocation/unapplied-credit handling', async () => {
    let creates = 0;
    const repo = {
      findDocumentById: async () => ({
        documentType: 'INVOICE', status: 'ISSUED', currency: 'THB', counterpartyId: 'customer-1',
        outstandingAmount: '100.00',
      }),
      createPayment: async (input: any) => {
        creates += 1;
        return {
          id: 'payment-1', companyId: input.companyId, direction: input.direction, status: 'RECORDED',
          method: input.method, amount: input.amount, allocatedAmount: '100.00', unappliedAmount: '50.00',
          currency: 'THB', paidAt: new Date(input.paidAt), postingStatus: 'pending',
          createdByUserId: input.createdByUserId, createdAt: new Date(), updatedAt: new Date(),
        };
      },
    };
    const useCase = new CreatePaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);
    const result = await useCase.execute(ctx, {
      ...paymentInput('150.00'), counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1',
    });
    assert.equal(creates, 1);
    assert.equal(result.unappliedAmount, '50.00');
  });

  it('rejects invalid document money before createDocument', async () => {
    let creates = 0;
    const repo = { createDocument: async () => { creates += 1; throw new Error('must not persist'); } };
    const useCase = new CreateDocumentUseCase(repo as any, { log: async () => undefined } as any, {} as any);

    await assert.rejects(() => useCase.execute(ctx, {
      documentType: 'INVOICE', documentDate: '2026-07-18', vatMode: 'NO_VAT',
      lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '-100.00' }],
    }));
    assert.equal(creates, 0);
  });
});

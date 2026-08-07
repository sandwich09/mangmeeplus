import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateDocumentUseCase } from './document.use-case';
import { CreatePaymentUseCase } from './payment.use-case';

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

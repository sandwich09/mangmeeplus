import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateCounterpartyUseCase, UpdateCounterpartyUseCase } from './counterparty.use-case';
import { CreateDocumentUseCase, SubmitQuotationApprovalUseCase } from './document.use-case';
import { CreatePaymentUseCase } from './payment.use-case';
import { RecordSimpleIncomeUseCase, simpleIncomePayloadFingerprint } from './record-simple-income.use-case';
import {
  GetSalesDocumentRootAvailabilityUseCase,
  SALES_DOCUMENT_LAUNCH_ROUTE_CLOSED_MESSAGE,
  createsNewSalesRoot,
} from '../sales-document-launch-gate';
import { FEATURE_TEMPORARILY_UNAVAILABLE, featureTemporarilyUnavailable } from '../../../employee-access/application/entitlement.helper';

const ctx: RequestContext = {
  requestId: 'request-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], scopes: {}, authProvider: 'watchdog',
  permissions: ['accounting.document.create', 'accounting.payment.create'],
};

const paymentInput = (amount: string) => ({
  direction: 'RECEIVED' as const,
  method: 'BANK_TRANSFER' as const,
  amount,
  paidAt: '2026-07-18T10:00:00.000Z',
});

const openLaunchGate = {
  assertLaunchRouteOpen: async () => undefined,
  assertLaunchRouteOpenInTransaction: async () => undefined,
} as any;

describe('P27 sales root launch gate', () => {
  it('separates new roots from required linked children and corrections', () => {
    for (const documentType of ['QUOTATION', 'INVOICE', 'BILLING_NOTE'] as const) {
      assert.equal(createsNewSalesRoot({ documentType }), true);
    }
    assert.equal(createsNewSalesRoot({ documentType: 'RECEIPT' }), true);
    assert.equal(createsNewSalesRoot({ documentType: 'TAX_INVOICE' }), true);
    assert.equal(createsNewSalesRoot(
      { documentType: 'RECEIPT', sourceDocumentId: 'invoice-1' },
      { documentType: 'INVOICE', status: 'ISSUED', paymentStatus: 'PAID', outstandingAmount: '0.00' },
    ), false);
    assert.equal(createsNewSalesRoot(
      { documentType: 'RECEIPT', sourceDocumentId: 'quotation-1' },
      { documentType: 'QUOTATION', status: 'DRAFT', paymentStatus: 'UNPAID', outstandingAmount: '0.00' },
    ), true);
    assert.equal(createsNewSalesRoot(
      { documentType: 'TAX_INVOICE', sourceDocumentId: 'invoice-1' },
      { documentType: 'INVOICE', status: 'ISSUED', outstandingAmount: '100.00' },
    ), false);
    assert.equal(createsNewSalesRoot({ documentType: 'CREDIT_NOTE', sourceDocumentId: 'invoice-1' }), false);
    assert.equal(createsNewSalesRoot({ documentType: 'DEBIT_NOTE', sourceDocumentId: 'invoice-1' }), false);
  });

  it('fails closed before persistence and audits a plain-Thai denial', async () => {
    let creates = 0;
    const audits: any[] = [];
    const useCase = new CreateDocumentUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         createDocument: async (_input: unknown, beforeMutation: (db: unknown) => Promise<void>) => {
        await beforeMutation({});
        creates += 1;
      } } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      {} as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      { assertLaunchRouteOpenInTransaction: async () => { throw featureTemporarilyUnavailable('sales_documents'); } } as any,
    );
    await assert.rejects(
      () => useCase.execute(ctx, {
        documentType: 'INVOICE', documentDate: '2026-08-27', vatMode: 'NO_VAT',
        lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100.00' }],
      }),
      (error: any) => {
        const body = error.getResponse();
        assert.equal(body.code, FEATURE_TEMPORARILY_UNAVAILABLE);
        assert.equal(body.message, SALES_DOCUMENT_LAUNCH_ROUTE_CLOSED_MESSAGE);
        assert.equal(body.message.includes('sales_documents'), false);
        return true;
      },
    );
    assert.equal(creates, 0);
    assert.equal(audits[0]?.action, 'accounting.document.create');
    assert.equal(audits[0]?.result, 'DENIED');
  });

  it('returns only a boolean and propagates infrastructure failures', async () => {
    const closed = new GetSalesDocumentRootAvailabilityUseCase({
      assertLaunchRouteOpen: async () => { throw featureTemporarilyUnavailable('sales_documents'); },
    } as any);
    assert.deepEqual(await closed.execute(), { canCreateSalesRoot: false });

    const broken = new GetSalesDocumentRootAvailabilityUseCase({
      assertLaunchRouteOpen: async () => { throw new Error('gate read failed'); },
    } as any);
    await assert.rejects(() => broken.execute(), /gate read failed/);
  });
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
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async (_record: unknown, _audit: unknown, beforeMutation: (db: unknown) => Promise<void>) => {
        await beforeMutation({});
        called = true;
        return result;
      } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      openLaunchGate,
    );
    await assert.rejects(() => useCase.execute({ ...fullCtx, permissions: ['accounting.invoice.create'] }, input));
    assert.equal(called, false);
  });

  it('refuses the atomic receive-income root while the sales route is closed', async () => {
    let called = false;
    const audits: any[] = [];
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async (_record: unknown, _audit: unknown, beforeMutation: (db: unknown) => Promise<void>) => {
        await beforeMutation({});
        called = true;
        return result;
      } } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      { assertLaunchRouteOpenInTransaction: async () => { throw featureTemporarilyUnavailable('sales_documents'); } } as any,
    );
    await assert.rejects(() => useCase.execute(fullCtx, input));
    assert.equal(called, false);
    assert.equal(audits[0]?.action, 'accounting.simple_income.record');
    assert.equal(audits[0]?.result, 'DENIED');
  });

  it('uses the single available branch returned by the source-branch resolver', async () => {
    let persistedBranchId: string | undefined;
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async (record: any) => {
        persistedBranchId = record.branchId;
        return { ...result, replayed: true };
      } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      openLaunchGate,
    );

    await useCase.execute({ ...fullCtx, scopes: { branchIds: ['branch-1'] } }, input);
    assert.equal(persistedBranchId, 'branch-1');
  });

  it('writes the audit inside the transaction and emits three events only for a new bundle', async () => {
    const events: string[] = [];
    let auditDb: unknown;
    const transactionDb = { tag: 'same-transaction' };
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async (_input: any, hook: any) => {
        await hook(transactionDb, result);
        return result;
      } } as any,
      { log: async (_entry: any, db: unknown) => { auditDb = db; } } as any,
      { append: async (event: string) => { events.push(event); } } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      openLaunchGate,
    );
    const created = await useCase.execute(fullCtx, input);
    assert.equal(created.receipt.documentNumber, 'RC-1');
    assert.equal(auditDb, transactionDb);
    assert.deepEqual(events.sort(), ['accounting.invoice.issued', 'accounting.payment.recorded', 'accounting.receipt.issued']);
  });

  it('does not emit duplicate events when the command is replayed', async () => {
    let events = 0;
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async () => ({ ...result, replayed: true }) } as any,
      { log: async () => undefined } as any,
      { append: async () => { events += 1; } } as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      openLaunchGate,
    );
    assert.equal((await useCase.execute(fullCtx, input)).replayed, true);
    assert.equal(events, 0);
  });

  it('blocks VAT modes for a company that is not VAT registered', async () => {
    let called = false;
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async () => { called = true; return result; } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'NOT_REGISTERED' }) } as any,
      openLaunchGate,
    );
    await assert.rejects(() => useCase.execute(fullCtx, { ...input, vatMode: 'VAT_EXCLUDED' }));
    assert.equal(called, false);
  });

  it('fails closed when the company has not confirmed its VAT status', async () => {
    let called = false;
    const useCase = new RecordSimpleIncomeUseCase(
      {
        findActiveBranch: async () => ({ id: 'branch-1' }),
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
         recordSimpleIncomeBundle: async () => { called = true; return result; } } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      { get: async () => ({ status: 'UNKNOWN' }) } as any,
      openLaunchGate,
    );
    await assert.rejects(() => useCase.execute(fullCtx, input), /must be confirmed/);
    assert.equal(called, false);
  });
});

describe('H-05 use-case revalidation', () => {
  it('rejects invalid payment money before the repository transaction', async () => {
    let creates = 0;
    const repo = {
      findActiveBranch: async () => ({ id: 'branch-1' }),
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

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
      findActiveBranch: async () => ({ id: 'branch-1' }),
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => ({
        branchId: 'branch-1', documentType: 'INVOICE', status: 'DRAFT', currency: 'THB',
        outstandingAmount: '100.00',
      }),
      findPaymentByIdempotencyKey: async () => null,
      createPayment: async () => { creates += 1; throw new Error('must not persist'); },
    };
    const useCase = new CreatePaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);
    await assert.rejects(() => useCase.execute(ctx, { ...paymentInput('150.00'), idempotencyKey: 'payment_retry_000', allocateToDocumentId: 'doc-1' }));
    assert.equal(creates, 0);
  });

  it('keeps valid overpayment for repository allocation/unapplied-credit handling', async () => {
    let creates = 0;
    const repo = {
      findActiveBranch: async () => ({ id: 'branch-1' }),
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => ({
        branchId: 'branch-1', documentType: 'INVOICE', status: 'ISSUED', currency: 'THB', counterpartyId: 'customer-1',
        outstandingAmount: '100.00',
      }),
      findPaymentByIdempotencyKey: async () => null,
      createPayment: async (input: any) => {
        creates += 1;
        return { replayed: false, payment: {
          id: 'payment-1', companyId: input.companyId, direction: input.direction, status: 'RECORDED',
          method: input.method, amount: input.amount, whtAmount: '0', allocatedAmount: '100.00', unappliedAmount: '50.00',
          currency: 'THB', paidAt: new Date(input.paidAt), postingStatus: 'pending',
          createdByUserId: input.createdByUserId, createdAt: new Date(), updatedAt: new Date(),
        } };
      },
    };
    const useCase = new CreatePaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any);
    const result = await useCase.execute(ctx, {
      ...paymentInput('150.00'), idempotencyKey: 'payment_retry_001', counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1',
    });
    assert.equal(creates, 1);
    assert.equal(result.unappliedAmount, '50.00');
  });

  it('inherits branch and counterparty from the scoped target and suppresses replay side effects', async () => {
    let persisted: any;
    let events = 0;
    let audits = 0;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => ({
        documentType: 'INVOICE', status: 'ISSUED', currency: 'THB', branchId: 'branch-1', counterpartyId: 'customer-1',
        outstandingAmount: '100.00',
      }),
      findPaymentByIdempotencyKey: async () => null,
      findActiveBranch: async () => ({ id: 'branch-1' }),
      createPayment: async (input: any) => {
        persisted = input;
        return { replayed: true, payment: {
          id: 'payment-1', companyId: input.companyId, branchId: input.branchId, counterpartyId: input.counterpartyId,
          direction: input.direction, status: 'RECORDED', method: input.method, amount: input.amount, whtAmount: '0',
          allocatedAmount: input.amount, unappliedAmount: '0', currency: 'THB', paidAt: new Date(input.paidAt),
          postingStatus: 'pending', createdByUserId: input.createdByUserId, createdAt: new Date(), updatedAt: new Date(),
        } };
      },
    };
    const useCase = new CreatePaymentUseCase(
      repo as any,
      { log: async () => { audits += 1; } } as any,
      { append: async () => { events += 1; } } as any,
    );
    const scopedCtx = { ...ctx, scopes: { branchIds: ['branch-1'] } };
    const result = await useCase.execute(scopedCtx, {
      ...paymentInput('100.00'), idempotencyKey: 'payment_retry_002', allocateToDocumentId: 'doc-1',
    });
    assert.equal(result.id, 'payment-1');
    assert.equal(persisted.branchId, 'branch-1');
    assert.equal(persisted.counterpartyId, 'customer-1');
    assert.equal(typeof persisted.payloadFingerprint, 'string');
    assert.equal(events, 0);
    assert.equal(audits, 0);
  });

  it('replays a settled target before allocation validation without duplicate side effects', async () => {
    let creates = 0;
    let events = 0;
    let audits = 0;
    const request = {
      ...paymentInput('100.00'), idempotencyKey: 'payment_retry_004', allocateToDocumentId: 'doc-1',
    };
    const target: any = {
      documentType: 'INVOICE', status: 'ISSUED', paymentStatus: 'UNPAID', currency: 'THB',
      branchId: 'branch-1', counterpartyId: 'customer-1', outstandingAmount: '100.00',
    };
    const priorPayment = {
      id: 'payment-settled', companyId: ctx.companyId, branchId: 'branch-1', counterpartyId: 'customer-1',
      direction: 'RECEIVED', status: 'RECORDED', method: 'BANK_TRANSFER', amount: '100.00', whtAmount: '0',
      allocatedAmount: '100.00', unappliedAmount: '0', currency: 'THB', paidAt: new Date(request.paidAt),
      postingStatus: 'pending', createdByUserId: ctx.userId, createdAt: new Date(), updatedAt: new Date(),
    } as any;
    let prior: { payment: typeof priorPayment; payloadFingerprint: string } | null = null;
    let branchActive = true;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async (companyId: string) => companyId === ctx.companyId ? target : null,
      findPaymentByIdempotencyKey: async (_companyId: string, key: string) => key === request.idempotencyKey
        ? prior
        : null,
      findActiveBranch: async () => branchActive ? { id: 'branch-1' } : null,
      createPayment: async (input: any) => {
        creates += 1;
        target.paymentStatus = 'PAID';
        target.outstandingAmount = '0.00';
        prior = { payment: priorPayment, payloadFingerprint: input.payloadFingerprint };
        return { payment: priorPayment, replayed: false };
      },
    };
    const useCase = new CreatePaymentUseCase(
      repo as any,
      { log: async () => { audits += 1; } } as any,
      { append: async () => { events += 1; } } as any,
    );
    const scopedCtx = { ...ctx, scopes: { branchIds: ['branch-1'] } };
    assert.equal((await useCase.execute(scopedCtx, request)).id, 'payment-settled');
    assert.equal(target.outstandingAmount, '0.00');
    assert.equal((await useCase.execute(scopedCtx, request)).id, 'payment-settled');
    await assert.rejects(
      () => useCase.execute(scopedCtx, { ...request, amount: '99.00' }),
      (error: any) => error.getResponse?.().code === 'accounting_payment_idempotency_conflict',
    );
    await assert.rejects(() => useCase.execute(scopedCtx, { ...request, idempotencyKey: 'payment_retry_005' }));
    await assert.rejects(() => useCase.execute({ ...scopedCtx, permissions: [] }, request));
    await assert.rejects(() => useCase.execute({ ...scopedCtx, companyId: 'company-2' }, request));
    await assert.rejects(() => useCase.execute({ ...scopedCtx, scopes: { branchIds: ['branch-2'] } }, request));
    await assert.rejects(() => useCase.execute(scopedCtx, { ...request, counterpartyId: 'customer-2' }));
    branchActive = false;
    await assert.rejects(() => useCase.execute(scopedCtx, request));
    assert.equal(creates, 1);
    assert.equal(events, 1);
    assert.equal(audits, 1);
  });

  it('rejects source branch/counterparty mismatch, inactive branch, and out-of-scope target', async () => {
    const target = {
      documentType: 'INVOICE', status: 'ISSUED', currency: 'THB', branchId: 'branch-1', counterpartyId: 'customer-1',
      outstandingAmount: '100.00',
    };
    const execute = (overrides: Record<string, unknown>, branchIds = ['branch-1'], active = true) => new CreatePaymentUseCase({
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => target,
      findPaymentByIdempotencyKey: async () => null,
      findActiveBranch: async () => active ? { id: 'branch-1' } : null,
      createPayment: async () => { throw new Error('must not persist'); },
    } as any, {} as any, {} as any).execute(
      { ...ctx, scopes: { branchIds } },
      { ...paymentInput('100.00'), idempotencyKey: 'payment_retry_003', allocateToDocumentId: 'doc-1', ...overrides },
    );
    await assert.rejects(() => execute({ branchId: 'branch-2' }));
    await assert.rejects(() => execute({ counterpartyId: 'customer-2' }));
    await assert.rejects(() => execute({}, ['branch-2']));
    await assert.rejects(() => execute({}, ['branch-1'], false));
  });

  it('rejects invalid document money before createDocument', async () => {
    let creates = 0;
    const repo = {
      findActiveBranch: async () => ({ id: 'branch-1' }),
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',
       createDocument: async () => { creates += 1; throw new Error('must not persist'); } };
    const useCase = new CreateDocumentUseCase(
      repo as any, { log: async () => undefined } as any, {} as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      openLaunchGate,
    );

    await assert.rejects(() => useCase.execute(ctx, {
      documentType: 'INVOICE', documentDate: '2026-07-18', vatMode: 'NO_VAT',
      lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '-100.00' }],
    }));
    assert.equal(creates, 0);
  });
});

describe('P27 BLOCK_NEW_ROOT mutation coverage', () => {
  const mutationCtx: RequestContext = {
    ...ctx,
    permissions: [
      'accounting.counterparty.manage', 'accounting.quotation.submit_approval', 'accounting.receipt.create',
      'accounting.credit_note.create', 'accounting.tax_invoice.create',
    ],
  };
  const closedTransactionalGate = {
    assertLaunchRouteOpenInTransaction: async () => { throw featureTemporarilyUnavailable('sales_documents'); },
  } as any;

  it('blocks counterparty create and update inside their final transactions', async () => {
    const deniedActions: string[] = [];
    let writes = 0;
    const audit = { log: async (entry: any) => { deniedActions.push(entry.action); } } as any;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findCounterpartyById: async () => ({ id: 'cp-1' }),
      createCounterparty: async (_input: unknown, before: (db: unknown) => Promise<void>) => {
        await before({});
        writes += 1;
      },
      updateCounterparty: async (_input: unknown, before: (db: unknown) => Promise<void>) => {
        await before({});
        writes += 1;
      },
    } as any;
    await assert.rejects(() => new CreateCounterpartyUseCase(repo, audit, closedTransactionalGate)
      .execute(mutationCtx, { type: 'CUSTOMER', displayName: 'Blocked customer' }));
    await assert.rejects(() => new UpdateCounterpartyUseCase(repo, audit, closedTransactionalGate)
      .execute(mutationCtx, 'cp-1', { displayName: 'Blocked update' }));
    assert.equal(writes, 0);
    assert.deepEqual(deniedActions, ['accounting.counterparty.create', 'accounting.counterparty.update']);
  });

  it('blocks quotation submit before its status mutation', async () => {
    let statusWrites = 0;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => ({ id: 'quote-1', documentType: 'QUOTATION', status: 'DRAFT' }),
      submitQuotationForApproval: async (_companyId: string, _id: string, _actor: string, before: (db: unknown) => Promise<void>) => {
        await before({});
        statusWrites += 1;
      },
    } as any;
    await assert.rejects(() => new SubmitQuotationApprovalUseCase(
      repo, { log: async () => undefined } as any, {} as any, closedTransactionalGate,
    ).execute(mutationCtx, 'quote-1'));
    assert.equal(statusWrites, 0);
  });

  it('rejects a second active receipt for the same fully-paid invoice under the source lock', async () => {
    const source = {
      id: 'invoice-1', companyId: 'company-1', branchId: 'branch-1', documentType: 'INVOICE', status: 'ISSUED',
      paymentStatus: 'PAID', outstandingAmount: '0.00', vatMode: 'NO_VAT', vatAmount: '0.00',
    };
    let creates = 0;
    let sourceReads = 0;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findDocumentById: async () => source,
      findActiveBranch: async () => true,
      listRevenueCategories: async () => [],
      createDocument: async (_input: unknown, before: (db: any) => Promise<void>) => {
        const db = {
          $executeRaw: async () => undefined,
          accountingDocument: { findFirst: async () => {
            sourceReads += 1;
            return sourceReads <= 2 ? source : { id: 'receipt-existing' };
          } },
        };
        await before(db);
        creates += 1;
      },
    } as any;
    const useCase = new CreateDocumentUseCase(
      repo,
      { log: async () => undefined } as any,
      {} as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      { assertLaunchRouteOpenInTransaction: async () => undefined } as any,
    );
    await assert.rejects(
      () => useCase.execute(mutationCtx, {
        documentType: 'RECEIPT', sourceDocumentId: source.id, sourceDocumentType: 'INVOICE',
        documentDate: '2026-08-27', vatMode: 'NO_VAT',
        lines: [{ lineNumber: 1, description: 'Payment receipt', quantity: '1', unitPrice: '100.00' }],
      }),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'accounting_receipt_already_exists',
    );
    assert.equal(creates, 0);
  });

  it('keeps a non-VAT credit note eligible when the final Prisma source row carries outputTaxCode=null', async () => {
    const mappedSource = {
      id: 'invoice-non-vat', companyId: 'company-1', branchId: 'branch-1', documentType: 'INVOICE', status: 'ISSUED',
      paymentStatus: 'UNPAID', outstandingAmount: '100.00', vatMode: 'NO_VAT', vatAmount: '0.00', outputTaxCode: undefined,
    };
    const rawSource = { ...mappedSource, outputTaxCode: null };
    let creates = 0;
    const repo = {
      findDocumentById: async () => mappedSource,
      findActiveBranch: async () => true,
      listRevenueCategories: async () => [],
      createDocument: async (_input: unknown, before: (db: any) => Promise<void>) => {
        await before({
          $executeRaw: async () => undefined,
          accountingDocument: { findFirst: async () => rawSource },
        });
        creates += 1;
        return { id: 'credit-1' };
      },
    } as any;
    const useCase = new CreateDocumentUseCase(
      repo,
      { log: async () => undefined } as any,
      {} as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      { assertLaunchRouteOpenInTransaction: async () => undefined } as any,
    );

    await useCase.execute(mutationCtx, {
      documentType: 'CREDIT_NOTE', sourceDocumentId: mappedSource.id, sourceDocumentType: 'INVOICE',
      adjustmentReasonCode: 'GOODS_RETURNED', documentDate: '2026-08-27', vatMode: 'NO_VAT',
      lines: [{ lineNumber: 1, description: 'คืนสินค้า', quantity: '1', unitPrice: '10.00' }],
    });
    assert.equal(creates, 1);
  });

  it('rejects a second active linked tax invoice under the source lifecycle lock', async () => {
    const source = {
      id: 'invoice-tax-source', companyId: 'company-1', branchId: 'branch-1', documentType: 'INVOICE', status: 'ISSUED',
      paymentStatus: 'UNPAID', outstandingAmount: '100.00', vatMode: 'NO_VAT', vatAmount: '0.00', outputTaxCode: undefined,
    };
    let creates = 0;
    let reads = 0;
    const repo = {
      findDocumentById: async () => source,
      findActiveBranch: async () => true,
      listRevenueCategories: async () => [],
      createDocument: async (_input: unknown, before: (db: any) => Promise<void>) => {
        await before({
          $executeRaw: async () => undefined,
          accountingDocument: {
            findFirst: async () => (++reads <= 2 ? { ...source, outputTaxCode: null } : { id: 'tax-existing' }),
            findMany: async () => [],
          },
        });
        creates += 1;
      },
    } as any;
    const useCase = new CreateDocumentUseCase(
      repo,
      { log: async () => undefined } as any,
      {} as any,
      { get: async () => ({ status: 'REGISTERED' }) } as any,
      { assertLaunchRouteOpenInTransaction: async () => undefined } as any,
    );

    await assert.rejects(
      () => useCase.execute(mutationCtx, {
        documentType: 'TAX_INVOICE', sourceDocumentId: source.id, sourceDocumentType: 'INVOICE',
        documentDate: '2026-08-27', vatMode: 'NO_VAT', outputTaxCode: 'O0',
        lines: [{ lineNumber: 1, description: 'ใบกำกับภาษี', quantity: '1', unitPrice: '100.00' }],
      }),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'accounting_tax_invoice_already_exists',
    );
    assert.equal(creates, 0);
  });
});

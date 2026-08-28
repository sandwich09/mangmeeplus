import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConvertDocumentUseCase, CreateDocumentUseCase, GetDocumentUseCase, ListDocumentsUseCase, UpdateDocumentUseCase } from './document.use-case';
import { featureTemporarilyUnavailable } from '../../../employee-access/application/entitlement.helper';

const VERSION = new Date('2026-08-09T10:00:00.000Z');
const ctx = {
  requestId: 'request-1', authSubject: 'subject-1', userId: 'sales-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['accounting.invoice.update'], scopes: {}, authProvider: 'dev',
} as any;

function document(status = 'DRAFT') {
  return {
    id: 'document-1', companyId: 'company-1', branchId: undefined, documentType: 'INVOICE', status,
    documentDate: new Date('2026-08-01T00:00:00.000Z'), dueDate: undefined, counterpartyId: 'customer-1',
    currency: 'THB', vatMode: 'NO_VAT', outputTaxCode: undefined, grandTotalAmount: '100.00',
    note: 'old', createdByUserId: 'sales-1', updatedAt: VERSION,
    lines: [{
      id: 'line-1', lineNumber: 1, description: 'Old description', quantity: '1', unitPrice: '100.00',
      discountAmount: '0', vatAmount: '0', whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100',
    }],
  } as any;
}

describe('UpdateDocumentUseCase', () => {
  for (const [documentType, status, permission] of [
    ['INVOICE', 'DRAFT', 'accounting.invoice.update'],
    ['QUOTATION', 'REJECTED', 'accounting.quotation.update'],
  ]) it(`lets a document-type editor revise ${documentType} ${status} with the loaded version`, async () => {
    const current = { ...document(status), documentType };
    let replacement: any;
    const repo = {
      findDocumentById: mock.fn(async () => current),
      findActiveBranch: mock.fn(async () => null),
      updateDraftDocument: mock.fn(async (_id: string, expected: Date, input: any, actor: string, withinTx: any) => {
        assert.equal(expected, VERSION);
        assert.equal(actor, 'sales-1');
        replacement = input;
        await withinTx({}, { ...current, lines: current.lines });
        return { ...current, ...input, updatedAt: new Date('2026-08-09T10:01:00.000Z') };
      }),
    } as any;
    const useCase = new UpdateDocumentUseCase(
      repo, { log: mock.fn(async () => undefined) } as any, {} as any,
      { get: mock.fn(async () => ({ status: 'REGISTERED' })) } as any,
    );

    await useCase.execute({ ...ctx, permissions: [permission] }, {
      documentId: current.id,
      expectedUpdatedAt: VERSION,
      documentDate: '2026-08-02',
      note: 'corrected',
      lines: [{ lineNumber: 1, description: 'Correct description', quantity: '2', unitPrice: '100.00' }],
    });

    assert.equal(replacement.documentType, documentType);
    assert.equal(replacement.documentDate, '2026-08-02');
    assert.equal(replacement.counterpartyId, 'customer-1');
    assert.equal(replacement.lines[0].description, 'Correct description');
  });

  it('does not revise a rejected non-quotation or an approved quotation', async () => {
    for (const [documentType, status] of [['INVOICE', 'REJECTED'], ['QUOTATION', 'APPROVED']]) {
      const updateDraftDocument = mock.fn(async () => document());
      const useCase = new UpdateDocumentUseCase({
        findDocumentById: mock.fn(async () => ({ ...document(status), documentType })), updateDraftDocument,
      } as any, {} as any, {} as any, {} as any);
      await assert.rejects(() => useCase.execute({ ...ctx, permissions: ['accounting.document.update'] }, {
        documentId: 'document-1', expectedUpdatedAt: VERSION, note: 'cannot reopen',
      }), UnprocessableEntityException);
      assert.equal(updateDraftDocument.mock.callCount(), 0);
    }
  });

  it('rejects issued evidence before calling the draft mutation', async () => {
    const updateDraftDocument = mock.fn(async () => document());
    const repo = { findDocumentById: mock.fn(async () => document('ISSUED')), updateDraftDocument } as any;
    const useCase = new UpdateDocumentUseCase(repo, {} as any, {} as any, {} as any);

    await assert.rejects(
      () => useCase.execute(ctx, { documentId: 'document-1', expectedUpdatedAt: VERSION, note: 'overwrite issued' }),
      UnprocessableEntityException,
    );
    assert.equal(updateDraftDocument.mock.callCount(), 0);
  });

  it('revalidates VAT registration before replacing a draft', async () => {
    const current = document();
    const updateDraftDocument = mock.fn(async () => current);
    const repo = { findDocumentById: mock.fn(async () => current), updateDraftDocument } as any;
    const useCase = new UpdateDocumentUseCase(
      repo, {} as any, {} as any,
      { get: mock.fn(async () => ({ status: 'NOT_REGISTERED' })) } as any,
    );
    await assert.rejects(
      () => useCase.execute(ctx, {
        documentId: current.id, expectedUpdatedAt: VERSION, vatMode: 'EXEMPT',
      }),
      UnprocessableEntityException,
    );
    assert.equal(updateDraftDocument.mock.callCount(), 0);
  });
});

describe('document-type read permissions', () => {
  it('lets Sales read a quotation without the generic accounting.document.read key', async () => {
    const quotation = { ...document(), documentType: 'QUOTATION' };
    const useCase = new GetDocumentUseCase({ findDocumentById: mock.fn(async () => quotation) } as any);
    const result = await useCase.execute({ ...ctx, permissions: ['accounting.quotation.read'] }, quotation.id);
    assert.equal(result.id, quotation.id);
  });

  it('limits a type-specific list to readable document types and rejects an unauthorized filter', async () => {
    let filter: any;
    const useCase = new ListDocumentsUseCase({
      listDocuments: mock.fn(async (input: any) => {
        filter = input;
        return { data: [], total: 0, page: 1, pageSize: 20 };
      }),
    } as any);
    const sales = { ...ctx, permissions: ['accounting.quotation.read'] };

    await useCase.execute(sales, {});
    assert.deepEqual(filter.documentTypes, ['QUOTATION']);
    await assert.rejects(() => useCase.execute(sales, { documentType: 'INVOICE' }), ForbiddenException);
  });

  it('lets a related actor read only a document confirmed by the source repository', async () => {
    const invoice = document();
    const related = { ...ctx, permissions: ['accounting.document.read_related'] };
    const allowed = new GetDocumentUseCase({
      findDocumentById: mock.fn(async () => invoice),
      isDocumentRelatedToUser: mock.fn(async () => true),
    } as any);
    assert.equal((await allowed.execute(related, invoice.id)).id, invoice.id);

    const denied = new GetDocumentUseCase({
      findDocumentById: mock.fn(async () => invoice),
      isDocumentRelatedToUser: mock.fn(async () => false),
    } as any);
    await assert.rejects(() => denied.execute(related, invoice.id), ForbiddenException);
  });

  it('passes related identity into list filtering without widening readable document types', async () => {
    let filter: any;
    const useCase = new ListDocumentsUseCase({
      listDocuments: mock.fn(async (input: any) => {
        filter = input;
        return { data: [], total: 0, page: 1, pageSize: 20 };
      }),
    } as any);

    await useCase.execute({ ...ctx, permissions: ['accounting.document.read_related'] }, {});
    assert.deepEqual(filter.documentTypes, []);
    assert.equal(filter.relatedUserId, 'sales-1');
  });

  // Spec R6: an explicit branch filter outside the caller's scope is a 403, not a silently empty page.
  it('rejects an out-of-scope branch filter on the document list', async () => {
    let queries = 0;
    const useCase = new ListDocumentsUseCase({
      listDocuments: mock.fn(async () => { queries += 1; return { data: [], total: 0, page: 1, pageSize: 20 }; }),
    } as any);
    const restricted = { ...ctx, permissions: ['accounting.document.read'], scopes: { branchIds: ['branch-1'] } };

    await assert.rejects(() => useCase.execute(restricted, { branchId: 'branch-2' }), ForbiddenException);
    assert.equal(queries, 0, 'the out-of-scope branch must be refused before the query runs');
  });

  it('passes an in-scope branch filter through to the document query', async () => {
    let filter: any;
    const useCase = new ListDocumentsUseCase({
      listDocuments: mock.fn(async (input: any) => { filter = input; return { data: [], total: 0, page: 1, pageSize: 20 }; }),
    } as any);
    const restricted = { ...ctx, permissions: ['accounting.document.read'], scopes: { branchIds: ['branch-1'] } };

    await useCase.execute(restricted, { branchId: 'branch-1' });
    assert.equal(filter.branchId, 'branch-1');
    // An unrestricted caller keeps naming any branch it likes.
    await useCase.execute({ ...restricted, scopes: {} }, { branchId: 'branch-9' });
    assert.equal(filter.branchId, 'branch-9');
  });
});

describe('ConvertDocumentUseCase permissions', () => {
  const openLaunchGate = {
    assertLaunchRouteOpen: mock.fn(async () => undefined),
    assertLaunchRouteOpenInTransaction: mock.fn(async () => undefined),
  } as any;
  const quotation = {
    ...document('ISSUED'), documentType: 'QUOTATION',
    lines: document('ISSUED').lines,
  } as any;

  it('requires relation or quotation read in addition to target create permission', async () => {
    const convertQuotation = mock.fn(async () => ({ document: document(), didConvert: true }));
    const useCase = new ConvertDocumentUseCase({
      findDocumentById: mock.fn(async () => quotation),
      isDocumentRelatedToUser: mock.fn(async () => false),
      convertQuotation,
    } as any, {} as any, {} as any, openLaunchGate);

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ['accounting.document.read_related', 'accounting.invoice.create'] }, quotation.id, 'INVOICE'),
      ForbiddenException,
    );
    assert.equal(convertQuotation.mock.callCount(), 0);
  });

  it('lets a related actor create only the permitted target type and persists the conversion link', async () => {
    let input: any;
    const useCase = new ConvertDocumentUseCase({
      findDocumentById: mock.fn(async () => quotation),
      isDocumentRelatedToUser: mock.fn(async () => true),
      convertQuotation: mock.fn(async (_sourceId: string, _version: Date, candidate: any) => {
        input = candidate;
        return { document: { ...document(), ...candidate, id: 'invoice-1' }, didConvert: true };
      }),
    } as any, { log: mock.fn(async () => undefined) } as any, { append: mock.fn(async () => undefined) } as any, openLaunchGate);

    await useCase.execute(
      { ...ctx, permissions: ['accounting.document.read_related', 'accounting.invoice.create'] },
      quotation.id,
      'INVOICE',
    );
    assert.equal(input.convertedFromDocumentId, quotation.id);
    await assert.rejects(
      () => useCase.execute(
        { ...ctx, permissions: ['accounting.document.read_related', 'accounting.invoice.create'] },
        quotation.id,
        'BILLING_NOTE',
      ),
      ForbiddenException,
    );
  });

  it('does not emit another event or audit row for an idempotent completed retry', async () => {
    const closed = { ...quotation, status: 'CLOSED' };
    const append = mock.fn(async () => undefined);
    const log = mock.fn(async () => undefined);
    const useCase = new ConvertDocumentUseCase({
      findDocumentById: mock.fn(async () => closed),
      convertQuotation: mock.fn(async () => ({ document: { ...document(), id: 'invoice-1' }, didConvert: false })),
    } as any, { log } as any, { append } as any, openLaunchGate);

    const result = await useCase.execute(
      { ...ctx, permissions: ['accounting.quotation.read', 'accounting.invoice.create'] },
      quotation.id,
      'INVOICE',
    );
    assert.equal(result.id, 'invoice-1');
    assert.equal(append.mock.callCount(), 0);
    assert.equal(log.mock.callCount(), 0);
  });

  it('blocks quotation conversion because it creates a new sales root', async () => {
    let persisted = false;
    const convertQuotation = mock.fn(async (_id: string, _version: Date, _input: unknown, _actor: string, beforeMutation: (db: unknown) => Promise<void>) => {
      await beforeMutation({});
      persisted = true;
      return { document: document(), didConvert: true };
    });
    const useCase = new ConvertDocumentUseCase({
      findDocumentById: mock.fn(async () => quotation),
      convertQuotation,
    } as any, { log: mock.fn(async () => undefined) } as any, {} as any, {
      assertLaunchRouteOpenInTransaction: async () => { throw featureTemporarilyUnavailable('sales_documents'); },
    } as any);

    await assert.rejects(() => useCase.execute(
      { ...ctx, permissions: ['accounting.quotation.read', 'accounting.invoice.create'] },
      quotation.id,
      'INVOICE',
    ));
    assert.equal(convertQuotation.mock.callCount(), 1);
    assert.equal(persisted, false);
  });
});

const createBoundaryContext = {
  requestId: 'request-1', authSubject: 'subject-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['accounting.invoice.create'], authProvider: 'dev',
};

const createBoundaryInput = {
  documentType: 'INVOICE' as const,
  documentDate: '2026-08-27',
  vatMode: 'NO_VAT' as const,
  lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100.00' }],
};

function setupCreateBoundary(vatStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN' = 'REGISTERED') {
  const createdDocument = {
    id: 'document-1', companyId: 'company-1', documentType: 'INVOICE', status: 'DRAFT',
    branchId: 'branch-1', documentDate: new Date('2026-08-27'), currency: 'THB', vatMode: 'NO_VAT',
    lines: [],
  };
  const repo = {
    resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

    findActiveBranch: mock.fn(async () => ({ id: 'branch-1' })),
    findDocumentById: mock.fn(async () => createdDocument),
    listRevenueCategories: mock.fn(async () => []),
    createDocument: mock.fn(async (value: any) => ({ ...createdDocument, branchId: value.branchId, vatMode: value.vatMode })),
  };
  const useCase = new CreateDocumentUseCase(
    repo as any,
    { log: mock.fn(async () => undefined) } as any,
    {} as any,
    { get: mock.fn(async () => ({ status: vatStatus })) } as any,
    { assertLaunchRouteOpen: mock.fn(async () => undefined) } as any,
  );
  return { repo, useCase };
}

describe('CreateDocumentUseCase accounting boundaries', () => {
  it('defaults a branch-restricted create to the first permitted branch', async () => {
    const { repo, useCase } = setupCreateBoundary();
    await useCase.execute({ ...createBoundaryContext, scopes: { branchIds: ['branch-1'] } } as any, createBoundaryInput);
    assert.equal((repo.createDocument.mock.calls as any[])[0]?.arguments[0].branchId, 'branch-1');
  });

  it('does not let a caller with an empty branch scope create a company-central document', async () => {
    const { repo, useCase } = setupCreateBoundary();
    await assert.rejects(
      () => useCase.execute({ ...createBoundaryContext, scopes: { branchIds: [] } } as any, createBoundaryInput),
      ForbiddenException,
    );
    assert.equal(repo.createDocument.mock.callCount(), 0);
  });

  it('fails closed for every mode while registration is unknown and enforces NO_VAT when not registered', async () => {
    for (const [status, vatMode] of [['UNKNOWN', 'NO_VAT'], ['NOT_REGISTERED', 'EXEMPT']] as const) {
      const { repo, useCase } = setupCreateBoundary(status);
      await assert.rejects(
        () => useCase.execute({ ...createBoundaryContext, scopes: {} } as any, { ...createBoundaryInput, vatMode }),
        UnprocessableEntityException,
      );
      assert.equal(repo.createDocument.mock.callCount(), 0);
    }
  });

  it('computes a stable server fingerprint for invoice retries and changes it with the payload', async () => {
    const { repo, useCase } = setupCreateBoundary();
    const createContext = { ...createBoundaryContext, scopes: {} } as any;
    await useCase.execute(createContext, { ...createBoundaryInput, idempotencyKey: 'invoice-page-001' });
    await useCase.execute(createContext, { ...createBoundaryInput, idempotencyKey: 'invoice-page-001' });
    await useCase.execute(createContext, { ...createBoundaryInput, note: 'changed', idempotencyKey: 'invoice-page-001' });
    const persisted = (repo.createDocument.mock.calls as any[]).map((call) => call.arguments[0]);
    assert.equal(persisted[0].payloadFingerprint, persisted[1].payloadFingerprint);
    assert.notEqual(persisted[0].payloadFingerprint, persisted[2].payloadFingerprint);
    assert.equal(persisted[0].idempotencyKey, 'invoice-page-001');
  });

  it('does not accept the invoice retry field on another document type', async () => {
    const { repo, useCase } = setupCreateBoundary();
    await assert.rejects(
      () => useCase.execute({ ...createBoundaryContext, scopes: {}, permissions: ['accounting.credit_note.create'] } as any, {
        ...createBoundaryInput, documentType: 'CREDIT_NOTE', idempotencyKey: 'invoice-page-001',
      } as any),
      UnprocessableEntityException,
    );
    assert.equal(repo.createDocument.mock.callCount(), 0);
  });

  it('inherits a source branch and rejects an explicit cross-branch correction', async () => {
    const { repo, useCase } = setupCreateBoundary();
    repo.findDocumentById = mock.fn(async () => ({
      id: 'source-1', documentType: 'INVOICE', status: 'ISSUED', branchId: 'branch-1', vatMode: 'NO_VAT',
      vatAmount: '0', outputTaxCode: undefined, lines: [],
    })) as any;
    await assert.rejects(
      () => useCase.execute({ ...createBoundaryContext, scopes: {}, permissions: ['accounting.credit_note.create'] } as any, {
        ...createBoundaryInput, documentType: 'CREDIT_NOTE', sourceDocumentId: 'source-1', sourceDocumentType: 'INVOICE',
        branchId: 'branch-2', adjustmentReasonCode: 'GOODS_RETURNED',
      } as any),
      UnprocessableEntityException,
    );
    assert.equal(repo.createDocument.mock.callCount(), 0);
  });
});

describe('GetDocumentUseCase correction capacity', () => {
  it('returns the current per-line basis after issued credits and debits', async () => {
    const repo = {
      findDocumentById: mock.fn(async () => ({
        id: 'document-1', companyId: 'company-1', documentType: 'TAX_INVOICE', status: 'CREDITED',
        vatMode: 'VAT_EXCLUDED', lines: [{ lineNumber: 1, lineSubtotalAmount: '100.00', lineTotalAmount: '107.00' }],
      })),
      listIssuedCorrectionLines: mock.fn(async () => [
        { documentType: 'CREDIT_NOTE', lines: [{ lineNumber: 1, lineSubtotalAmount: '40.00', lineTotalAmount: '42.80' }] },
        { documentType: 'DEBIT_NOTE', lines: [{ lineNumber: 1, lineSubtotalAmount: '10.00', lineTotalAmount: '10.70' }] },
      ]),
    };
    const result = await new GetDocumentUseCase(repo as any).execute({
      ...createBoundaryContext, scopes: {}, permissions: ['accounting.tax_invoice.read'],
    } as any, 'document-1');
    assert.equal(result.lines?.[0]?.correctionBasisAmount, '70.00');
  });
});

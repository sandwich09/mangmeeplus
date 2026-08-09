import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConvertDocumentUseCase, GetDocumentUseCase, ListDocumentsUseCase, UpdateDocumentUseCase } from './document.use-case';

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
  it('lets a document-type editor replace a draft with the loaded version', async () => {
    const current = document();
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
    const useCase = new UpdateDocumentUseCase(repo, { log: mock.fn(async () => undefined) } as any, {} as any);

    await useCase.execute(ctx, {
      documentId: current.id,
      expectedUpdatedAt: VERSION,
      documentDate: '2026-08-02',
      note: 'corrected',
      lines: [{ lineNumber: 1, description: 'Correct description', quantity: '2', unitPrice: '100.00' }],
    });

    assert.equal(replacement.documentType, 'INVOICE');
    assert.equal(replacement.documentDate, '2026-08-02');
    assert.equal(replacement.counterpartyId, 'customer-1');
    assert.equal(replacement.lines[0].description, 'Correct description');
  });

  it('rejects issued evidence before calling the draft mutation', async () => {
    const updateDraftDocument = mock.fn(async () => document());
    const repo = { findDocumentById: mock.fn(async () => document('ISSUED')), updateDraftDocument } as any;
    const useCase = new UpdateDocumentUseCase(repo, {} as any, {} as any);

    await assert.rejects(
      () => useCase.execute(ctx, { documentId: 'document-1', expectedUpdatedAt: VERSION, note: 'overwrite issued' }),
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
});

describe('ConvertDocumentUseCase permissions', () => {
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
    } as any, {} as any, {} as any);

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
    } as any, { log: mock.fn(async () => undefined) } as any, { append: mock.fn(async () => undefined) } as any);

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
    } as any, { log } as any, { append } as any);

    const result = await useCase.execute(
      { ...ctx, permissions: ['accounting.quotation.read', 'accounting.invoice.create'] },
      quotation.id,
      'INVOICE',
    );
    assert.equal(result.id, 'invoice-1');
    assert.equal(append.mock.callCount(), 0);
    assert.equal(log.mock.callCount(), 0);
  });
});

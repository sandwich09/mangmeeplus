import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { IssueDocumentUseCase } from './document.use-case';

// Regression: when repo.issueDocument fails, the number reservation is still
// RESERVED (commit runs only after a successful issue). The catch path must
// cancel the reservation and rethrow the ORIGINAL error — the old voidNumber
// call rejected non-COMMITTED rows, masking the real failure and stranding
// the reservation.

const ctx: any = {
  companyId: 'co_1', userId: 'u1', requestId: 'req_1',
  permissions: ['accounting.document.issue'],
  scopes: {},
};

const draftInvoice = () => ({
  id: 'doc_1', status: 'DRAFT', documentType: 'INVOICE', branchId: 'br_1',
  documentDate: new Date('2026-07-01'), updatedAt: new Date('2026-07-01'),
  currency: 'THB', grandTotalAmount: '100.00',
  lines: [{ id: 'line_1', lineNumber: 1, lineSubtotalAmount: '100.00', lineTotalAmount: '100.00', vatAmount: '0.00' }],
});

describe('IssueDocumentUseCase number release', () => {
  let s: any;
  let repo: any;

  beforeEach(() => {
    s = {
      audit: { log: mock.fn(async () => undefined) },
      outbox: { append: mock.fn(async () => undefined) },
      reserveNumber: { execute: mock.fn(async () => ({ id: 'num_1', documentNumber: 'INV-0001' })) },
      commitNumber: { execute: mock.fn(async () => undefined) },
      cancelNumber: { execute: mock.fn(async () => undefined) },
      transactionTax: {},
      vatRegistration: { get: mock.fn(async () => ({ status: 'REGISTERED' })) },
    };
    repo = {
      findDocumentById: mock.fn(async () => draftInvoice()),
      issueDocument: mock.fn(async () => ({
        document: { ...draftInvoice(), status: 'ISSUED', documentNumber: 'INV-0001' },
        taxPreviews: [],
      })),
    };
  });

  const make = () => new IssueDocumentUseCase(
    repo, s.audit, s.outbox, s.reserveNumber, s.commitNumber, s.cancelNumber, s.transactionTax,
    s.vatRegistration,
  );

  it('cancels the reservation and propagates the original error when issue fails', async () => {
    repo.issueDocument = mock.fn(async () => { throw new ConflictException('accounting_document_changed'); });
    await assert.rejects(
      () => make().execute(ctx, 'doc_1'),
      (err: any) => err instanceof ConflictException && err.message === 'accounting_document_changed',
    );
    assert.equal(s.cancelNumber.execute.mock.callCount(), 1);
    assert.deepEqual(s.cancelNumber.execute.mock.calls[0].arguments[0], { id: 'num_1', companyId: 'co_1' });
    assert.equal(s.cancelNumber.execute.mock.calls[0].arguments[1], 'u1');
    assert.equal(s.commitNumber.execute.mock.callCount(), 0);
  });

  it('commits the reservation on successful issue without cancelling', async () => {
    const result = await make().execute(ctx, 'doc_1');
    assert.equal(result.documentNumber, 'INV-0001');
    assert.equal(s.commitNumber.execute.mock.callCount(), 1);
    assert.deepEqual(s.commitNumber.execute.mock.calls[0].arguments[0], {
      id: 'num_1', companyId: 'co_1', ownerType: 'accounting_document', ownerId: 'doc_1',
    });
    assert.equal(s.cancelNumber.execute.mock.callCount(), 0);
  });

  it('replays an already-issued result without another number or event', async () => {
    repo.findDocumentById = mock.fn(async () => ({
      ...draftInvoice(), status: 'ISSUED', documentNumber: 'INV-0001', issuedAt: new Date('2026-07-01'),
    }));
    const result = await make().execute(ctx, 'doc_1');
    assert.equal(result.documentNumber, 'INV-0001');
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
    assert.equal(repo.issueDocument.mock.callCount(), 0);
    assert.equal(s.outbox.append.mock.callCount(), 0);
  });

  it('does not issue even a NO_VAT document while company VAT status is unknown', async () => {
    s.vatRegistration.get = mock.fn(async () => ({ status: 'UNKNOWN' }));
    await assert.rejects(() => make().execute(ctx, 'doc_1'), /must be confirmed/);
    assert.equal(s.reserveNumber.execute.mock.callCount(), 0);
  });
});

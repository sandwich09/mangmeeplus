import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { PrismaAccountingRepository } from './prisma-accounting.repository';

const VERSION = new Date('2026-08-09T10:00:00.000Z');
const NEXT_VERSION = new Date('2026-08-09T10:01:00.000Z');

function row() {
  return {
    id: 'document-1', companyId: 'company-1', branchId: null, documentType: 'INVOICE', documentNumber: null,
    status: 'DRAFT', documentDate: new Date('2026-08-01T00:00:00.000Z'), dueDate: null, counterpartyId: null,
    counterpartySnapshotJson: null, sourceDocumentId: null, sourceDocumentType: null, convertedFromDocumentId: null,
    currency: 'THB', vatMode: 'NO_VAT', outputTaxCode: null, subtotalAmount: '100', discountAmount: '0',
    taxableAmount: '100', vatAmount: '0', whtAmount: '0', grandTotalAmount: '100', paidAmount: '0',
    outstandingAmount: '100', unappliedCreditAmount: null, paymentStatus: 'UNPAID', taxStatus: null,
    taxInvoiceType: null, taxInvoiceId: null, postingStatus: 'not_required', journalEntryId: null, postingError: null,
    note: 'old', internalMemo: null, issuedByUserId: null, issuedAt: null, voidedByUserId: null, voidedAt: null,
    voidReason: null, approvalStatus: null, submittedByUserId: null, submittedAt: null, approvedByUserId: null,
    approvedAt: null, rejectedByUserId: null, rejectedAt: null, approvalNote: null, createdByUserId: 'user-1',
    updatedByUserId: null, createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: VERSION,
    lines: [line('line-old', 'Old description', '100')],
  };
}

function line(id: string, description: string, amount: string) {
  return {
    id, companyId: 'company-1', documentId: 'document-1', lineNumber: 1, productId: null, skuSnapshot: null,
    description, unitName: null, quantity: '1', unitPrice: amount, discountAmount: '0', vatRate: null,
    vatAmount: '0', whtRate: null, whtAmount: '0', lineSubtotalAmount: amount, lineTotalAmount: amount,
    taxCategory: null, revenueCategory: null, taxCodeDefinitionId: null, externalTaxCodeSnapshot: null,
    createdAt: VERSION, updatedAt: VERSION,
  };
}

function harness() {
  const state = { document: row() };
  let deletedLines = 0;
  let transactionClient: unknown;
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state.document);
      const tx = {
        $executeRaw: async () => 0,
        accountingDocument: {
          updateMany: async ({ where, data }: any) => {
            if (where.id !== draft.id || where.companyId !== draft.companyId || where.status !== draft.status
              || where.updatedAt.getTime() !== draft.updatedAt.getTime()) return { count: 0 };
            Object.assign(draft, data, { updatedAt: NEXT_VERSION });
            return { count: 1 };
          },
          findFirstOrThrow: async () => draft,
        },
        accountingDocumentLine: {
          deleteMany: async () => { deletedLines += 1; draft.lines = []; },
          createMany: async ({ data }: any) => {
            draft.lines = data.map((item: any, index: number) => ({ ...line(`line-${index + 1}`, item.description, item.unitPrice), ...item }));
          },
        },
      };
      transactionClient = tx;
      const result = await work(tx);
      state.document = draft;
      return result;
    },
  };
  return { state, repo: new PrismaAccountingRepository({ client } as any), deletedLines: () => deletedLines, transactionClient: () => transactionClient };
}

const replacement = {
  companyId: 'company-1', documentType: 'INVOICE' as const, documentDate: '2026-08-02', currency: 'THB',
  vatMode: 'NO_VAT' as const, note: 'corrected', createdByUserId: 'user-1',
  lines: [{ lineNumber: 1, description: 'Correct description', quantity: '2', unitPrice: '100.00' }],
};

describe('PrismaAccountingRepository draft update', () => {
  it('replaces header and lines atomically after the version CAS', async () => {
    const { state, repo, transactionClient } = harness();
    let callbackClient: unknown;
    const result = await repo.updateDraftDocument('document-1', VERSION, replacement, 'editor-1', async (tx) => {
      callbackClient = tx;
    });

    assert.equal(callbackClient, transactionClient());
    assert.equal(state.document.note, 'corrected');
    assert.equal(state.document.lines[0]!.description, 'Correct description');
    assert.equal(result.grandTotalAmount, '200.00');
  });

  it('does not touch lines or run dependent writes when the loaded version is stale', async () => {
    const { state, repo, deletedLines } = harness();
    let callbackCalled = false;
    await assert.rejects(
      () => repo.updateDraftDocument('document-1', new Date('2026-08-09T09:00:00.000Z'), replacement, 'editor-1', async () => {
        callbackCalled = true;
      }),
      (error: unknown) => error instanceof ConflictException && (error.getResponse() as any).code === 'accounting_document_changed',
    );
    assert.equal(state.document.note, 'old');
    assert.equal(deletedLines(), 0);
    assert.equal(callbackCalled, false);
  });

  it('rolls the header and line replacement back when tax preparation fails', async () => {
    const { state, repo } = harness();
    await assert.rejects(
      () => repo.updateDraftDocument('document-1', VERSION, replacement, 'editor-1', async () => {
        throw new Error('tax resolution failed');
      }),
      /tax resolution failed/,
    );
    assert.equal(state.document.note, 'old');
    assert.equal(state.document.lines[0]!.description, 'Old description');
  });
});

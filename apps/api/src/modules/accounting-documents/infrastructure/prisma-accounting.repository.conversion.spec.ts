import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { PrismaAccountingRepository } from './prisma-accounting.repository';

const VERSION = new Date('2026-08-09T10:00:00.000Z');
const NEXT_VERSION = new Date('2026-08-09T10:01:00.000Z');

function sourceRow(status = 'ISSUED') {
  return {
    id: 'quotation-1', companyId: 'company-1', branchId: null, documentType: 'QUOTATION', documentNumber: 'QT-1',
    status, documentDate: new Date('2026-08-01T00:00:00.000Z'), dueDate: null, counterpartyId: null,
    counterpartySnapshotJson: null, sourceDocumentId: null, sourceDocumentType: null, convertedFromDocumentId: null,
    currency: 'THB', vatMode: 'NO_VAT', outputTaxCode: null, subtotalAmount: '100', discountAmount: '0',
    taxableAmount: '100', vatAmount: '0', whtAmount: '0', grandTotalAmount: '100', paidAmount: '0',
    outstandingAmount: '100', unappliedCreditAmount: null, paymentStatus: 'UNPAID', taxStatus: null,
    taxInvoiceType: null, taxInvoiceId: null, postingStatus: 'not_required', journalEntryId: null, postingError: null,
    note: null, internalMemo: null, issuedByUserId: 'issuer-1', issuedAt: VERSION, voidedByUserId: null,
    voidedAt: null, voidReason: null, approvalStatus: null, submittedByUserId: null, submittedAt: null,
    approvedByUserId: null, approvedAt: null, rejectedByUserId: null, rejectedAt: null, approvalNote: null,
    createdByUserId: 'sales-1', updatedByUserId: 'issuer-1', createdAt: VERSION, updatedAt: VERSION,
    lines: [],
  };
}

function convertedRow(documentType = 'INVOICE') {
  return {
    ...sourceRow('DRAFT'), id: 'converted-1', documentType, documentNumber: null,
    convertedFromDocumentId: 'quotation-1', issuedByUserId: null, issuedAt: null,
  };
}

const input = {
  companyId: 'company-1', documentType: 'INVOICE' as const, documentDate: '2026-08-01', currency: 'THB',
  vatMode: 'NO_VAT' as const, convertedFromDocumentId: 'quotation-1', createdByUserId: 'sales-1',
  lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice: '100.00' }],
};

function harness(options: { status?: string; targets?: any[]; failCreate?: boolean } = {}) {
  const state = { source: sourceRow(options.status), targets: options.targets ?? [] };
  let createCalls = 0;
  let updateCalls = 0;
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async () => 0,
        accountingDocument: {
          findFirst: async ({ where }: any) => where.id === draft.source.id ? draft.source : null,
          findMany: async () => draft.targets.slice(0, 2),
          updateMany: async ({ where, data }: any) => {
            updateCalls += 1;
            if (where.id !== draft.source.id || where.companyId !== draft.source.companyId
              || where.status !== draft.source.status || where.updatedAt.getTime() !== draft.source.updatedAt.getTime()) {
              return { count: 0 };
            }
            Object.assign(draft.source, data, { updatedAt: NEXT_VERSION });
            return { count: 1 };
          },
          create: async ({ data }: any) => {
            createCalls += 1;
            if (options.failCreate) throw new Error('target create failed');
            const target = {
              ...convertedRow(data.documentType), ...data, id: 'converted-new', createdAt: NEXT_VERSION,
              updatedAt: NEXT_VERSION, lines: data.lines.create.map((line: any, index: number) => ({
                ...line, id: `line-${index + 1}`, companyId: data.companyId, documentId: 'converted-new',
                createdAt: NEXT_VERSION, updatedAt: NEXT_VERSION,
              })),
            };
            draft.targets.push(target);
            return target;
          },
        },
      };
      const result = await work(tx);
      state.source = draft.source;
      state.targets = draft.targets;
      return result;
    },
  };
  return {
    state,
    repo: new PrismaAccountingRepository({ client } as any),
    createCalls: () => createCalls,
    updateCalls: () => updateCalls,
  };
}

describe('PrismaAccountingRepository quotation conversion', () => {
  it('claims the loaded quotation and creates its target in one transaction', async () => {
    const { repo, state, createCalls, updateCalls } = harness();
    const result = await repo.convertQuotation('quotation-1', VERSION, input, 'sales-1');

    assert.equal(result.didConvert, true);
    assert.equal(result.document.convertedFromDocumentId, 'quotation-1');
    assert.equal(state.source.status, 'CLOSED');
    assert.equal(state.targets.length, 1);
    assert.equal(updateCalls(), 1);
    assert.equal(createCalls(), 1);
  });

  it('returns the same target without another mutation after a completed retry', async () => {
    const { repo, createCalls, updateCalls } = harness({ status: 'CLOSED', targets: [convertedRow()] });
    let gateCalls = 0;
    const result = await repo.convertQuotation('quotation-1', VERSION, input, 'sales-1', async () => {
      gateCalls += 1;
      throw new Error('a completed retry must not need the launch gate');
    });

    assert.equal(result.didConvert, false);
    assert.equal(result.document.id, 'converted-1');
    assert.equal(updateCalls(), 0);
    assert.equal(createCalls(), 0);
    assert.equal(gateCalls, 0);
  });

  it('rejects a different or duplicate target without changing the source', async () => {
    const { repo, state, createCalls, updateCalls } = harness({ targets: [convertedRow('BILLING_NOTE')] });
    await assert.rejects(
      () => repo.convertQuotation('quotation-1', VERSION, input, 'sales-1'),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'accounting_document_already_converted',
    );
    assert.equal(state.source.status, 'ISSUED');
    assert.equal(updateCalls(), 0);
    assert.equal(createCalls(), 0);
  });

  it('rolls the source claim back when target creation fails', async () => {
    const { repo, state } = harness({ failCreate: true });
    await assert.rejects(() => repo.convertQuotation('quotation-1', VERSION, input, 'sales-1'), /target create failed/);
    assert.equal(state.source.status, 'ISSUED');
    assert.equal(state.targets.length, 0);
  });
});

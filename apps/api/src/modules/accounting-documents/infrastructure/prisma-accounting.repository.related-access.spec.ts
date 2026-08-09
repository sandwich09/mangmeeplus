import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaAccountingRepository } from './prisma-accounting.repository';

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  if (where.AND && !(where.AND as Row[]).every((condition) => matches(row, condition))) return false;
  if (where.OR && !(where.OR as Row[]).some((condition) => matches(row, condition))) return false;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND' || key === 'OR') return true;
    if (condition && typeof condition === 'object' && 'in' in condition) return condition.in.includes(row[key]);
    return row[key] === condition;
  });
}

function repoWithGraph() {
  const deepChain = Array.from({ length: 12 }, (_, index) => ({
    id: `deep-${index + 1}`,
    companyId: 'company-1',
    branchId: 'branch-a',
    createdByUserId: 'finance-1',
    sourceDocumentId: index === 0 ? 'credit-note' : `deep-${index}`,
    convertedFromDocumentId: null,
  }));
  const documents = [
    { id: 'quote', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'sales-1', sourceDocumentId: null, convertedFromDocumentId: null },
    { id: 'invoice', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: null, convertedFromDocumentId: 'quote' },
    { id: 'tax-invoice', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: 'invoice', convertedFromDocumentId: null },
    { id: 'credit-note', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: 'tax-invoice', convertedFromDocumentId: null },
    { id: 'paid-document', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: null, convertedFromDocumentId: null },
    { id: 'payment-child', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: 'paid-document', convertedFromDocumentId: null },
    { id: 'co-allocated-document', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: null, convertedFromDocumentId: null },
    { id: 'other-branch-child', companyId: 'company-1', branchId: 'branch-b', createdByUserId: 'finance-1', sourceDocumentId: 'quote', convertedFromDocumentId: null },
    { id: 'unrelated', companyId: 'company-1', branchId: 'branch-a', createdByUserId: 'finance-1', sourceDocumentId: null, convertedFromDocumentId: null },
    ...deepChain,
  ];
  const payments: Row[] = [
    { id: 'payment-1', createdByUserId: 'finance-1', updatedByUserId: null, voidedByUserId: null },
    { id: 'payment-shared', createdByUserId: 'finance-1', updatedByUserId: null, voidedByUserId: null },
  ];
  const allocations = [
    { id: 'allocation-1', companyId: 'company-1', documentId: 'paid-document', paymentId: 'payment-1', createdByUserId: 'sales-1' },
    { id: 'allocation-2', companyId: 'company-1', documentId: 'quote', paymentId: 'payment-shared', createdByUserId: 'finance-1' },
    { id: 'allocation-3', companyId: 'company-1', documentId: 'co-allocated-document', paymentId: 'payment-shared', createdByUserId: 'finance-1' },
  ];
  const client = {
    accountingPaymentAllocation: {
      findMany: async ({ where, select }: any) => allocations
        .filter((row) => {
          if (row.companyId !== where.companyId) return false;
          if (where.documentId?.in) return where.documentId.in.includes(row.documentId);
          if (where.paymentId?.in) return where.paymentId.in.includes(row.paymentId);
          if (where.OR) {
            const payment = payments.find((candidate) => candidate.id === row.paymentId);
            return row.createdByUserId === 'sales-1'
              || payment?.createdByUserId === 'sales-1'
              || payment?.updatedByUserId === 'sales-1'
              || payment?.voidedByUserId === 'sales-1';
          }
          return true;
        })
        .map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof typeof row]]))),
    },
    accountingDocument: {
      findMany: async ({ where }: any) => documents.filter((row) => matches(row, where)).map((row) => ({
        id: row.id, sourceDocumentId: row.sourceDocumentId, convertedFromDocumentId: row.convertedFromDocumentId,
      })),
    },
  };
  return new PrismaAccountingRepository({ client } as any);
}

describe('accounting related-record visibility', () => {
  it('follows direct, payment-allocation, source, and conversion links transitively in both directions', async () => {
    const repo = repoWithGraph();
    for (const id of [
      'quote', 'invoice', 'tax-invoice', 'credit-note', 'paid-document', 'payment-child',
      'co-allocated-document', 'deep-12',
    ]) {
      assert.equal(await repo.isDocumentRelatedToUser('company-1', id, 'sales-1', ['branch-a']), true, id);
    }
    assert.equal(await repo.isDocumentRelatedToUser('company-1', 'unrelated', 'sales-1', ['branch-a']), false);
  });

  it('never crosses branch scope even when an in-scope document points to the other branch', async () => {
    const repo = repoWithGraph();
    assert.equal(await repo.isDocumentRelatedToUser('company-1', 'other-branch-child', 'sales-1', ['branch-a']), false);
  });
});

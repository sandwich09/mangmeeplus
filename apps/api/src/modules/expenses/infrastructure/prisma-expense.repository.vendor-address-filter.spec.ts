// GAP-11 / §8: the way an old tax invoice with no seller address gets found and filled in. It is
// the ONLY thing a missing address does — it never changes `taxEvidenceStatus`, claimability or
// posting, so this filter is the whole feature on the list side.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaExpenseRepository } from './prisma-expense.repository';

function repoSpy() {
  const queries: any[] = [];
  const repo = new PrismaExpenseRepository({ client: {
    expenseRecord: {
      findMany: async (query: any) => { queries.push(query.where); return []; },
      count: async () => 0,
    },
    expenseReimbursementLink: { findMany: async () => [] },
    reimbursementRequest: { findMany: async () => [] },
    reimbursementLine: { findMany: async () => [] },
  } } as any);
  return { queries, repo };
}

describe('listExpenses vendorAddressMissing filter', () => {
  it('asks for full tax invoices whose seller address is null', async () => {
    const { queries, repo } = repoSpy();

    await repo.listExpenses({ companyId: 'company-1', vendorAddressMissing: true });

    assert.equal(queries[0].vendorAddressSnapshot, null);
    assert.equal(queries[0].sourceDocumentType, 'TAX_INVOICE',
      'only a full tax invoice has to carry a seller address');
  });

  it('is off unless asked for, so the ordinary list is byte-for-byte what it was', async () => {
    const { queries, repo } = repoSpy();

    await repo.listExpenses({ companyId: 'company-1' });

    assert.equal('vendorAddressSnapshot' in queries[0], false);
    assert.equal('sourceDocumentType' in queries[0], false);
  });

  it('pins TAX_INVOICE over a contradicting document-type filter rather than returning nothing', async () => {
    const { queries, repo } = repoSpy();

    await repo.listExpenses({ companyId: 'company-1', sourceDocumentType: 'RECEIPT', vendorAddressMissing: true });

    assert.equal(queries[0].sourceDocumentType, 'TAX_INVOICE');
    assert.equal(queries[0].vendorAddressSnapshot, null);
  });

  it('still narrows by the other filters it is combined with', async () => {
    const { queries, repo } = repoSpy();

    await repo.listExpenses({ companyId: 'company-1', vendorAddressMissing: true, status: 'CONFIRMED' });

    assert.equal(queries[0].status, 'CONFIRMED');
    assert.equal(queries[0].vendorAddressSnapshot, null);
  });
});

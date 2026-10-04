import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaTaxRepository } from './prisma-tax.repository.js';

const issueInput = {
  companyId: 'company-1',
  taxPeriodId: 'period-1',
  severity: 'BLOCKING' as const,
  issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
  description: 'Input VAT recorded as non-claimable',
  sourceType: 'expense.record',
  sourceId: 'expense-1',
};

const existingRow = {
  id: 'issue-1', companyId: 'company-1', taxPeriodId: 'period-1', taxEventId: null,
  severity: 'BLOCKING', status: 'OPEN', issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
  description: 'Input VAT recorded as non-claimable', sourceType: 'expense.record', sourceId: 'expense-1',
  resolvedAt: null, resolvedNote: null, resolvedByUserId: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'), updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

function repoWith(findFirstResult: unknown) {
  let findFirstWhere: any;
  const created: any[] = [];
  const client = {
    taxReviewIssue: {
      findFirst: async (query: any) => { findFirstWhere = query.where; return findFirstResult; },
      create: async (query: any) => { created.push(query.data); return { ...existingRow, ...query.data, id: 'issue-new' }; },
    },
  };
  return { repo: new PrismaTaxRepository({ client } as any), created, whereUsed: () => findFirstWhere };
}

describe('PrismaTaxRepository createIssue dedupe', () => {
  it('returns the existing OPEN issue with the same (company, period, code, source) without creating', async () => {
    const h = repoWith(existingRow);

    const record = await h.repo.createIssue(issueInput);

    assert.equal(h.created.length, 0);
    assert.equal(record.id, 'issue-1');
    assert.deepEqual(h.whereUsed(), {
      companyId: 'company-1', taxPeriodId: 'period-1', issueCode: 'INPUT_VAT_NOT_CLAIMABLE',
      sourceType: 'expense.record', sourceId: 'expense-1', status: 'OPEN',
    });
  });

  it('creates a new OPEN issue when no open duplicate exists', async () => {
    const h = repoWith(null);

    const record = await h.repo.createIssue(issueInput);

    assert.equal(h.created.length, 1);
    assert.equal(h.created[0]?.status, 'OPEN');
    assert.equal(h.created[0]?.issueCode, 'INPUT_VAT_NOT_CLAIMABLE');
    assert.equal(record.id, 'issue-new');
  });
});


describe('expense tax events cannot cross correction', () => {
  for (const [status, version] of [['NEEDS_REVIEW', 1], ['REJECTED', 1], ['VOIDED', 1], ['CONFIRMED', 2]] as const) {
    it(`refuses stale synchronization at ${status}/${version}`, async () => {
      let writes = 0;
      const client: any = {
        $transaction: async (work: any) => work({ ...client }), $executeRaw: async () => 0,
        expenseRecord: { findFirst: async () => ({ status, confirmedAt: new Date(version), updatedAt: new Date(100) }) },
        taxEvent: { upsert: async ({ create }: any) => { writes++; return { id: 'event', ...create }; } },
      };
      await assert.rejects(new PrismaTaxRepository({ client } as any).upsertEvent({ companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', expectedExpenseConfirmedAt: new Date(1), idempotencyKey: 'old' } as any), (e: any) => e.getResponse?.().code === 'expense_tax_source_changed');
      assert.equal(writes, 0);
      // A fresh confirmation still syncs when posting has stamped an unrelated write time.
      client.expenseRecord.findFirst = async () => ({ status: 'CONFIRMED', confirmedAt: new Date(3), updatedAt: new Date(100) });
      await new PrismaTaxRepository({ client } as any).upsertEvent({ companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', expectedExpenseConfirmedAt: new Date(3), idempotencyKey: 'current' } as any);
      assert.equal(writes, 1);
    });
  }
});

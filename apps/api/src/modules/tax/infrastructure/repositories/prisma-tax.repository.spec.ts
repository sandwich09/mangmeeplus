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

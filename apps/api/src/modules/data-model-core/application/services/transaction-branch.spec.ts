import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireTransactionBranchId, resolveTransactionBranchId } from './transaction-branch';

describe('transaction source branch policy', () => {
  const branches = [
    { id: 'b1', companyId: 'c1', status: 'ACTIVE' },
    { id: 'b2', companyId: 'c1', status: 'ACTIVE' },
    { id: 'archived', companyId: 'c1', status: 'ARCHIVED' },
    { id: 'foreign', companyId: 'c2', status: 'ACTIVE' },
  ];
  const db = {
    branch: {
      findMany: async ({ where, take }: any) => branches.filter((branch) =>
        branch.companyId === where.companyId && branch.status === where.status
        && (!where.id || where.id.in.includes(branch.id))).slice(0, take),
      findFirst: async ({ where }: any) => branches.find((branch) =>
        branch.id === where.id && branch.companyId === where.companyId && branch.status === where.status) ?? null,
    },
  } as any;
  const missing = (error: any) => error.getStatus() === 422 && error.getResponse().code === 'TRANSACTION_BRANCH_REQUIRED';

  it('uses the selected branch even when it is not first', async () => {
    assert.equal(await resolveTransactionBranchId(db, 'c1', {}, 'b2'), 'b2');
  });

  it('requires a choice for both unrestricted and multi-branch members', async () => {
    await assert.rejects(() => resolveTransactionBranchId(db, 'c1', {}), missing);
    await assert.rejects(() => resolveTransactionBranchId(db, 'c1', { branchIds: ['b1', 'b2'] }), missing);
  });

  it('defaults only the single ACTIVE accessible branch in the same company', async () => {
    assert.equal(await resolveTransactionBranchId(db, 'c1', { branchIds: ['archived', 'b2', 'foreign'] }), 'b2');
    assert.equal(await resolveTransactionBranchId(db, 'c2', {}), 'foreign');
  });

  it('does not default a member who has no available branches', async () => {
    await assert.rejects(() => resolveTransactionBranchId(db, 'c1', { branchIds: [] }), missing);
    await assert.rejects(() => resolveTransactionBranchId(db, 'c1', { branchIds: ['archived'] }), missing);
  });

  it('rejects a selected inactive, foreign or forbidden branch instead of silently choosing another', async () => {
    for (const branchId of ['archived', 'foreign', 'missing']) {
      await assert.rejects(() => resolveTransactionBranchId(db, 'c1', {}, branchId),
        (error: any) => error.getResponse().code === 'TRANSACTION_BRANCH_INVALID');
    }
    await assert.rejects(() => resolveTransactionBranchId(db, 'c1', { branchIds: ['b1'] }, 'b2'),
      (error: any) => error.getStatus() === 403);
  });

  it('requires a persisted source branch for follow-up actions', () => {
    for (const branchId of [null, undefined, '', '  ']) assert.throws(() => requireTransactionBranchId(branchId), missing);
    assert.equal(requireTransactionBranchId('b2'), 'b2');
  });
});

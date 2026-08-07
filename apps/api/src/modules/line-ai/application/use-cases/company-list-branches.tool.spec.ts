// company.list_branches LINE read tool: permission-checked branch list for AI answers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompanyListBranchesTool } from './erp-dashboard-tools.use-case';

const BRANCHES = [
  { id: 'b-ho', code: 'HO', name: 'Head Office', type: 'HEAD_OFFICE' },
  { id: 'b-1', code: 'BKK01', name: 'สาขาลาดพร้าว', type: 'BRANCH' },
];

function makeTool() {
  const prisma = { client: { branch: { findMany: async () => BRANCHES } } } as any;
  return new CompanyListBranchesTool(prisma);
}

const baseCtx = { companyId: 'c1', userId: 'u1', locale: 'th-TH' } as any;

describe('CompanyListBranchesTool', () => {
  it('fails closed without company.branch.read', async () => {
    const result = await makeTool().execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
    assert.equal(result.data, undefined);
  });

  it('returns total, bounded branch list, and a settings web link', async () => {
    const result = await makeTool().execute({ ...baseCtx, permissions: ['company.branch.read'] });
    assert.equal(result.status, 'ok');
    const data = result.data as { total: number; branches: Array<{ code: string; name: string }>; scopedBranchNames: string[] };
    assert.equal(data.total, 2);
    assert.deepEqual(data.branches.map((b) => b.code), ['HO', 'BKK01']);
    assert.deepEqual(data.scopedBranchNames, []);
    assert.equal(result.sourceRefs[0]!.webPath, '/companies/c1/settings/branches');
  });

  it('reports the caller branch scope names when restricted', async () => {
    const result = await makeTool().execute({ ...baseCtx, permissions: ['company.branch.read'], branchIds: ['b-1'] });
    const data = result.data as { scopedBranchNames: string[] };
    assert.deepEqual(data.scopedBranchNames, ['สาขาลาดพร้าว']);
  });
});

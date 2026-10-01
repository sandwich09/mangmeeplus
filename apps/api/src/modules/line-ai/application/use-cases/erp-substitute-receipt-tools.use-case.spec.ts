import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseListSubstituteReceiptsToSignTool } from './erp-substitute-receipt-tools.use-case';
import { lineReadResultHash } from '../line-read-evidence.service';

const baseCtx = {
  requestId: 'req-1', companyId: 'co-1', userId: 'owner-1', membershipId: 'mem-1', roles: ['OWNER'],
  permissions: ['ai.tool.invoke', 'expense.read_own', 'expense.confirm'], branchIds: ['branch-1'], locale: 'th',
} as any;

const item = (documentNumber: string, stepLabel: string) => ({
  documentNumber, payeeName: 'ร้านป้าแดง', amount: '350', currency: 'THB', expenseDate: '2026-09-12', preparedOn: '2026-09-12', stepLabel,
});

function queue(result: Record<string, unknown> = {
  asPayer: { count: 2, items: [item('SR-1', 'รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน'), item('SR-2', 'รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน')] },
  asApprover: { count: 3, items: [item('SR-3', 'รอคุณอนุมัติ')] },
}) {
  const seen: Array<{ ctx: any; input: any }> = [];
  return { seen, useCase: { execute: async (ctx: any, input: any) => { seen.push({ ctx, input }); return structuredClone(result); } } as any };
}

describe('ExpenseListSubstituteReceiptsToSignTool', () => {
  it('hands the use case the caller REAL roles and branch scope (a one-person shop self-approves by role)', async () => {
    const { seen, useCase } = queue();
    await new ExpenseListSubstituteReceiptsToSignTool(useCase).execute(baseCtx, {});
    assert.deepEqual(seen[0]!.ctx.roles, ['OWNER']);
    assert.deepEqual(seen[0]!.ctx.scopes, { branchIds: ['branch-1'], locationIds: undefined });
    assert.equal(seen[0]!.ctx.userId, 'owner-1');
    assert.deepEqual(seen[0]!.input, { limit: 10 });
  });

  it('returns the caller-own queue with its sum, the queue page link and an own access scope', async () => {
    const { useCase } = queue();
    const result = await new ExpenseListSubstituteReceiptsToSignTool(useCase).execute(baseCtx, {});
    const data = result.data as any;
    assert.equal(result.status, 'ok');
    assert.equal(data.total, 5, 'payer 2 + approver 3, so "5 ใบ" is a grounded number');
    assert.equal(data.accessScope, 'own');
    assert.equal(result.queryApplied?.accessScope, 'own');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/expenses/substitute-receipts');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.deepEqual(result.completeness?.rows, { returned: 3, hasMore: true, nextCursor: null });
    const json = JSON.stringify(result);
    for (const forbidden of ['payeeTaxId', 'payeeAddress', 'PREPARED', 'PAYER_CERTIFIED']) assert.ok(!json.includes(forbidden), forbidden);
  });

  it('passes one side and a clamped limit through', async () => {
    const { seen, useCase } = queue({ asApprover: { count: 0, items: [] } });
    const tool = new ExpenseListSubstituteReceiptsToSignTool(useCase);
    const result = await tool.execute(baseCtx, { role: 'approver', limit: 50 });
    await tool.execute(baseCtx, { role: 'payer', limit: '3' });
    await tool.execute(baseCtx, { role: 'nobody', limit: 0 });
    assert.deepEqual(seen.map((call) => call.input), [{ role: 'approver', limit: 10 }, { role: 'payer', limit: 3 }, { limit: 1 }]);
    assert.deepEqual(result.queryApplied?.filters, { role: 'approver' });
    assert.equal((result.data as any).total, 0);
  });

  it('fails closed for a caller with none of the certify/approve permissions', async () => {
    const { seen, useCase } = queue();
    const result = await new ExpenseListSubstituteReceiptsToSignTool(useCase).execute({ ...baseCtx, permissions: ['ai.tool.invoke', 'expense.read'] }, {});
    assert.equal(result.status, 'forbidden');
    assert.equal(result.data, undefined);
    assert.equal(seen.length, 0);
  });

  it('re-reads to the same delivery hash (the read is re-verified before the reply is sent)', async () => {
    const tool = new ExpenseListSubstituteReceiptsToSignTool(queue().useCase);
    const first = await tool.execute(baseCtx, {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await tool.execute(baseCtx, {});
    assert.notEqual(first.asOf, second.asOf);
    assert.equal(lineReadResultHash(first), lineReadResultHash(second));
  });
});

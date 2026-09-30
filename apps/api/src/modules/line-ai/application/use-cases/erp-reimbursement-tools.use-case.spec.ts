import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReimbursementGetApprovalBacklogTool, ReimbursementListPendingApprovalsTool } from './erp-reimbursement-tools.use-case';

const baseCtx = {
  companyId: 'co-1',
  userId: 'approver-1',
  membershipId: 'mem-1',
  roles: ['MANAGER'],
  permissions: ['reimbursement.approve'],
  branchIds: ['branch-1'],
  locale: 'th-TH',
} as any;

function queueItem(index: number) {
  return {
    id: `rb-${index}`,
    companyId: 'co-1',
    branchId: index === 0 ? 'branch-1' : undefined,
    requestNo: `RB-2026-${index}`,
    requesterDisplayNameSnapshot: `Requester ${index}`,
    amount: `${100 + index}.00`,
    currency: 'THB',
    submittedAt: '2026-07-12T03:00:00.000Z',
    status: 'PENDING_APPROVAL',
    ageHours: 4,
    slaRisk: false,
  };
}

describe('ReimbursementListPendingApprovalsTool', () => {
  it('returns a bounded redacted summary with source references', async () => {
    const queue = { execute: async () => Array.from({ length: 12 }, (_, i) => queueItem(i)) } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx);
    const data = result.data as any;

    assert.equal(result.status, 'ok');
    assert.equal(data.total, 12);
    assert.equal(data.items.length, 10);
    assert.deepEqual(data.items[0], {
      id: 'rb-0',
      documentNumber: 'RB-2026-0',
      requesterDisplayName: 'Requester 0',
      amount: '100.00',
      currency: 'THB',
      submittedAt: '2026-07-12T03:00:00.000Z',
      status: 'PENDING_APPROVAL',
      branch: 'branch-1',
    });
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/reimbursements');
  });

  // The web queue requires `reimbursement.approve`; gating this tool on `reimbursement.read` let a
  // reader list a queue they cannot see on the web.
  it('fails closed for a reader without reimbursement.approve', async () => {
    let called = false;
    const queue = { execute: async () => { called = true; return []; } } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue)
      .execute({ ...baseCtx, permissions: ['reimbursement.read'] });

    assert.equal(result.status, 'forbidden');
    assert.equal(called, false);
    // Item 3 (T-143): a bare 'forbidden' gave the gateway nothing to render, so a STAFF user asking
    // for the approval queue could end up shown their own claims summary instead with no statement
    // that they cannot see the queue. A typed errorCode survives enforceSourceHonesty (the gateway's
    // non-'ok' passthrough keeps only toolName/status/sourceRefs/asOf/errorCode/errorMessage) so it
    // can render an honest denial instead of any answer shaped like the approval queue.
    assert.equal(result.errorCode, 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED');
    assert.deepEqual(result.sourceRefs, []);
    assert.equal(result.data, undefined);
  });

  // Approver eligibility and branch scope live in the use case, so the tool must hand it the
  // caller's own roles and scopes rather than re-querying the repository with a bare companyId.
  it('delegates to the approval queue with the caller roles and branch scope', async () => {
    let captured: any;
    const queue = { execute: async (ctx: any) => { captured = ctx; return []; } } as any;

    await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx, { companyId: 'other-company' } as any);

    assert.equal(captured.companyId, 'co-1');
    assert.equal(captured.userId, 'approver-1');
    assert.deepEqual(captured.roles, ['MANAGER']);
    assert.deepEqual(captured.permissions, ['reimbursement.approve']);
    assert.deepEqual(captured.scopes, { branchIds: ['branch-1'], locationIds: undefined });
  });

  it('returns an empty summary when no approvals are pending', async () => {
    const queue = { execute: async () => [] } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx);

    assert.deepEqual(result.data, { total: 0, items: [] });
    assert.equal(result.sourceRefs.length, 1);
  });
});

describe('ReimbursementGetApprovalBacklogTool', () => {
  const backlog = {
    accessScope: 'company', total: 12, totalsByCurrency: [{ currency: 'THB', amount: '1200.00' }],
    byApprover: [{ name: 'สมศรี', count: 2, totalsByCurrency: [], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 }],
    sharedPile: { label: 'กองกลาง (อนุมัติได้หลายคน)', count: 3, totalsByCurrency: [], oldestSubmittedOn: '2026-09-24', longestWaitDays: 6 },
    desks: [], items: Array.from({ length: 10 }, (_, i) => ({ id: `rb-${i}` })),
  };

  // Scope, branch and active-approver rules live in the use case: the adapter hands it the caller's
  // own roles/scopes and only "requester: me" from the model, never anything else it sent.
  it('delegates with the caller context and passes only requester "me" through', async () => {
    const seen: any[] = [];
    const tool = new ReimbursementGetApprovalBacklogTool({ execute: async (ctx: any, input: any) => { seen.push({ ctx, input }); return backlog; } } as any);

    await tool.execute(baseCtx, { requester: 'me' });
    await tool.execute(baseCtx, { requester: 'someone-else', companyId: 'other' } as any);

    assert.deepEqual(seen.map((call) => call.input), [{ requester: 'me' }, {}]);
    assert.equal(seen[0].ctx.companyId, 'co-1');
    assert.deepEqual(seen[0].ctx.roles, ['MANAGER']);
    assert.deepEqual(seen[0].ctx.scopes, { branchIds: ['branch-1'], locationIds: undefined });
  });

  it('links the claim list, states its own scope, and reports the item cap as more rows', async () => {
    const result = await new ReimbursementGetApprovalBacklogTool({ execute: async () => backlog } as any).execute(baseCtx, { requester: 'me' });

    assert.equal(result.status, 'ok');
    assert.equal(result.data, backlog);
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/reimbursements');
    assert.equal(result.queryApplied?.accessScope, 'company');
    assert.deepEqual(result.queryApplied?.filters, { requester: 'me' });
    assert.deepEqual(result.completeness?.rows, { returned: 10, hasMore: true, nextCursor: null });
    assert.equal(result.completeness?.groups.returned, 2);
  });

  it('answers forbidden instead of throwing when the caller cannot read claims', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    const result = await new ReimbursementGetApprovalBacklogTool({ execute: async () => { throw new ForbiddenException('no'); } } as any)
      .execute(baseCtx);
    assert.equal(result.status, 'forbidden');
    assert.equal(result.data, undefined);
  });
});

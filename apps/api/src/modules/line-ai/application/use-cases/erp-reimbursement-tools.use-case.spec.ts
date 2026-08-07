import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReimbursementListPendingApprovalsTool } from './erp-reimbursement-tools.use-case';

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

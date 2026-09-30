import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { GetReimbursementApprovalBacklogUseCase, SHARED_PILE_LABEL } from './reimbursement-summary.use-case';

// 2026-09-30 10:00 Bangkok.
const NOW = new Date('2026-09-30T03:00:00.000Z');

const ctx = (overrides: Partial<RequestContext> = {}): RequestContext => ({
  userId: 'owner', companyId: 'co', authSubject: 'owner', membershipId: 'm', authProvider: 'watchdog',
  roles: ['OWNER'], permissions: ['reimbursement.read'], scopes: { branchIds: ['b1', 'b2'] }, requestId: 'r', ...overrides,
});

let seq = 0;
function claim(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `rb-${seq}`, companyId: 'co', branchId: 'b1', requestNo: `RB-${String(seq).padStart(3, '0')}`,
    requesterUserId: 'staff', requesterDisplayNameSnapshot: 'สมหญิง', amount: '100.0000', outstandingAmount: '100.0000',
    currency: 'THB', status: 'PENDING_APPROVAL', financeReviewStatus: 'NOT_REQUIRED',
    // 2026-09-22T18:00Z is already 23 Sep in Bangkok: a UTC-day count would say 8, not 7.
    submittedAt: new Date('2026-09-22T18:00:00.000Z'), createdAt: new Date('2026-09-20T00:00:00.000Z'), ...overrides,
  };
}
const step = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  id: `step-${requestId}`, companyId: 'co', reimbursementRequestId: requestId, sequenceNo: 1, status: 'PENDING',
  approverRoleSnapshot: 'MANAGER', ...overrides,
});

const NAMES: Record<string, string> = { mgrA: 'สมศรี', mgrB: 'สมชาย', gone: 'ปรีชา', owner: 'เจ้าของ' };

/** `active[branch]` = who can still act there; everyone else has left or lost that branch. */
function repo(rows: any[], steps: any[], active: Record<string, string[]>) {
  const calls: any = { list: undefined, active: [] as any[], names: [] as string[][] };
  return {
    calls,
    listRequests: async (where: any) => { calls.list = where; return rows; },
    findPendingApprovalSteps: async (_companyId: string, ids: string[]) => steps.filter((s) => ids.includes(s.reimbursementRequestId)),
    findActiveApproverUserIds: async (_companyId: string, ids: string[], branchId?: string) => {
      calls.active.push({ ids, branchId });
      return new Set(ids.filter((id) => (active[branchId ?? ''] ?? []).includes(id)));
    },
    getUserDisplayNames: async (_companyId: string, ids: string[]) => {
      calls.names.push(ids);
      return Object.fromEntries(ids.map((id) => [id, NAMES[id]!]));
    },
  };
}
const audit = { log: async () => undefined } as any;
const run = (r: any, context = ctx(), input = {}) => new GetReimbursementApprovalBacklogUseCase(r, audit).execute(context, input as any, NOW);

describe('GetReimbursementApprovalBacklogUseCase — whose desk (advisor spec §5.3)', () => {
  it('counts single-approver claims per person and keeps several-approver claims in a separate pile', async () => {
    const one = claim(), two = claim(), shared1 = claim({ submittedAt: new Date('2026-09-25T02:00:00.000Z') }), shared2 = claim();
    const r = repo([one, two, shared1, shared2], [
      step(one.id, { assignedApproverUserIds: ['mgrA'] }),
      step(two.id, { assignedApproverUserIds: ['mgrA'] }),
      step(shared1.id, { assignedApproverUserIds: ['mgrA', 'mgrB'] }),
      step(shared2.id, { assignedApproverUserIds: ['mgrA', 'mgrB'] }),
    ], { b1: ['mgrA', 'mgrB'] });
    const result = await run(r);

    assert.deepEqual(result.byApprover, [{ name: 'สมศรี', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '200.00' }],
      oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 }]);
    // Owner 2026-09-30: never added to สมศรี or สมชาย, and nobody is named for it.
    assert.deepEqual(result.sharedPile, { label: SHARED_PILE_LABEL, count: 2, totalsByCurrency: [{ currency: 'THB', amount: '200.00' }],
      oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 });
    assert.equal(JSON.stringify(result).includes('สมชาย'), false);
    assert.deepEqual(r.calls.names, [['mgrA', 'mgrA']]);
    assert.equal(result.total, 4);
  });

  it('never counts or names someone who left: one active assignee is a single approver, none is its own group', async () => {
    const withGone = claim(), onlyGone = claim(), legacyNamedGone = claim();
    const r = repo([withGone, onlyGone, legacyNamedGone], [
      step(withGone.id, { assignedApproverUserIds: ['mgrA', 'gone'] }),
      step(onlyGone.id, { assignedApproverUserIds: ['gone'] }),
      step(legacyNamedGone.id, { approverUserId: 'gone' }),
    ], { b1: ['mgrA'] });
    const result = await run(r);

    assert.deepEqual(result.byApprover.map((row) => [row.name, row.count]), [['สมศรี', 1]]);
    assert.equal(result.sharedPile, null);
    assert.deepEqual(result.desks.map((row) => [row.kind, row.label, row.count]), [['no_active_approver', 'ไม่มีผู้อนุมัติที่ยังใช้งานอยู่', 2]]);
    assert.equal(JSON.stringify(result).includes('ปรีชา'), false);
    assert.equal(r.calls.names.flat().includes('gone'), false);
  });

  it('checks who can act per branch, so an approver outside a claim\'s branch does not count there', async () => {
    const inB1 = claim({ branchId: 'b1' }), inB2 = claim({ branchId: 'b2' }), noBranch = claim({ branchId: undefined });
    const r = repo([inB1, inB2, noBranch], [
      step(inB1.id, { assignedApproverUserIds: ['mgrA'] }),
      step(inB2.id, { assignedApproverUserIds: ['mgrA'] }),
      step(noBranch.id, { assignedApproverUserIds: ['mgrA'] }),
    ], { b1: ['mgrA'], '': ['mgrA'] });
    const result = await run(r);

    assert.deepEqual(r.calls.active.map((call: any) => call.branchId).sort(), ['b1', 'b2', undefined].sort());
    assert.deepEqual(result.byApprover.map((row) => [row.name, row.count]), [['สมศรี', 2]]);
    assert.deepEqual(result.desks.map((row) => [row.kind, row.count]), [['no_active_approver', 1]]);
  });

  it('puts finance, payment and a decided-but-not-moved claim on their own desks, dated from approval', async () => {
    const finance = claim({ status: 'FINANCE_REVIEW', approvedAt: new Date('2026-09-27T05:00:00.000Z') });
    const handOffToFinance = claim({ status: 'APPROVED', financeReviewStatus: 'PENDING', approvedAt: new Date('2026-09-29T05:00:00.000Z') });
    const ready = claim({ status: 'READY_FOR_PAYMENT', approvedAt: new Date('2026-09-26T05:00:00.000Z'), currency: 'USD', outstandingAmount: '40.5000' });
    const partial = claim({ status: 'PARTIALLY_PAID', approvedAt: new Date('2026-09-28T05:00:00.000Z'), outstandingAmount: '60.0000' });
    const handOffToPayment = claim({ status: 'APPROVED', approvedAt: new Date('2026-09-30T01:00:00.000Z') });
    const decided = claim();
    const r = repo([finance, handOffToFinance, ready, partial, handOffToPayment, decided], [], {});
    const result = await run(r);

    assert.deepEqual(result.desks, [
      { kind: 'finance', label: 'ฝ่ายการเงิน', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '200.00' }], oldestApprovedOn: '2026-09-27', longestWaitDays: 3 },
      { kind: 'payment', label: 'ฝ่ายการเงิน (รอบันทึกจ่าย)', count: 3,
        totalsByCurrency: [{ currency: 'THB', amount: '160.00' }, { currency: 'USD', amount: '40.50' }], oldestApprovedOn: '2026-09-26', longestWaitDays: 4 },
      { kind: 'status_pending', label: 'รอระบบปรับสถานะ', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 },
    ]);
    // Currencies are never added together.
    assert.deepEqual(result.totalsByCurrency, [{ currency: 'THB', amount: '460.00' }, { currency: 'USD', amount: '40.50' }]);
    assert.deepEqual(r.calls.list.statuses, ['PENDING_APPROVAL', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'APPROVED']);
  });

  it('treats a legacy role-routed step as the shared pile', async () => {
    const legacy = claim();
    const result = await run(repo([legacy], [step(legacy.id)], {}));
    assert.equal(result.sharedPile?.count, 1);
    assert.deepEqual(result.byApprover, []);
  });

  it('follows web read scope: company, related, own, and "ของฉัน" narrows any of them', async () => {
    const scopeOf = async (permissions: string[], input = {}) => {
      const r = repo([], [], {});
      const result = await run(r, ctx({ userId: 'u1', permissions }), input);
      return [result.accessScope, r.calls.list.requesterUserId, r.calls.list.relatedUserId, r.calls.list.scopes];
    };
    assert.deepEqual(await scopeOf(['reimbursement.read', 'reimbursement.read_own']), ['company', undefined, undefined, { branchIds: ['b1', 'b2'] }]);
    assert.deepEqual(await scopeOf(['reimbursement.read_related', 'reimbursement.read_own']), ['related', undefined, 'u1', { branchIds: ['b1', 'b2'] }]);
    assert.deepEqual(await scopeOf(['reimbursement.read_own']), ['own', 'u1', undefined, { branchIds: ['b1', 'b2'] }]);
    assert.deepEqual(await scopeOf(['reimbursement.read'], { requester: 'me' }), ['own', 'u1', undefined, { branchIds: ['b1', 'b2'] }]);
    await assert.rejects(run(repo([], [], {}), ctx({ permissions: ['reimbursement.approve'] })), /Missing permission/);
  });

  it('lists at most 10 claims, longest wait first, each with the desk it waits at', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => claim({ submittedAt: new Date(Date.UTC(2026, 8, 18 + index, 3)) }));
    const r = repo(rows, rows.map((row) => step(row.id, { assignedApproverUserIds: ['mgrA'] })), { b1: ['mgrA'] });
    const result = await run(r);

    assert.equal(result.items.length, 10);
    assert.deepEqual(result.items[0], { id: rows[0]!.id, documentNumber: rows[0]!.requestNo, requesterName: 'สมหญิง', amount: '100.00',
      currency: 'THB', waitingOn: 'สมศรี', submittedOn: '2026-09-18', waitDays: 12 });
    assert.deepEqual(result.items.map((item) => item.waitDays), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    // Same data on a re-read the same day: the delivery hash compares it.
    assert.deepEqual(await run(r), result);
  });
});

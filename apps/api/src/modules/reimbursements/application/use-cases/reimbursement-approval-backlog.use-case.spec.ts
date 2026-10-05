import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REIMBURSEMENT_DESK_LABELS, type RequestContext } from '@watchdog-bms/contracts';
import { GetReimbursementApprovalBacklogUseCase, NO_ACTIVE_APPROVER_NOTE, SHARED_PILE_LABEL } from './reimbursement-summary.use-case';

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
function repo(rows: any[], steps: any[], active: Record<string, string[]>, anyOwn: any[] = []) {
  const calls: any = { list: undefined, own: undefined, active: [] as any[], names: [] as string[][] };
  return {
    calls,
    findPolicy: async () => null,
    // The backlog read filters by status; the only other read is "does the caller have any claim at all".
    listRequests: async (where: any) => {
      if (where.statuses) { calls.list = where; return rows; }
      calls.own = where;
      return anyOwn;
    },
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
    assert.equal(result.awaitingApprovalCount, 4);
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
    assert.deepEqual(result.desks.map((row) => [row.kind, row.label, row.count, row.note]), [['no_active_approver', 'ไม่มีผู้อนุมัติที่ยังใช้งานอยู่', 2, NO_ACTIVE_APPROVER_NOTE]]);
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
      { kind: 'finance', label: 'ฝ่ายการเงิน (รอตรวจสอบ)', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '200.00' }], oldestApprovedOn: '2026-09-27', longestWaitDays: 3 },
      // Before: "ฝ่ายการเงิน (รอบันทึกจ่าย)", also for the two claims here that never had a finance-review step.
      { kind: 'payment', label: 'ผู้มีสิทธิ์บันทึกจ่าย', count: 3,
        totalsByCurrency: [{ currency: 'THB', amount: '160.00' }, { currency: 'USD', amount: '40.50' }], oldestApprovedOn: '2026-09-26', longestWaitDays: 4 },
      { kind: 'status_pending', label: 'รอระบบปรับสถานะ', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 },
    ]);
    // Currencies are never added together.
    assert.deepEqual(result.totalsByCurrency, [{ currency: 'THB', amount: '460.00' }, { currency: 'USD', amount: '40.50' }]);
    // Eval 2026-09-30: the total spans every stage; only this part still waits for an approver ("ค้างอนุมัติ").
    assert.equal(result.total, 6);
    assert.equal(result.awaitingApprovalCount, 0);
    assert.deepEqual(r.calls.list.statuses, ['PENDING_APPROVAL', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'APPROVED']);
  });

  // Owner rule 2026-10-01: the answer names the same party the web names for the same claim state. The web prints
  // REIMBURSEMENT_DESK_LABELS (reimbursements.logic.spec.ts checks its three surfaces); this is the fourth.
  it('names the web\'s own desk for a claim with no finance step and for one finance reviews', async () => {
    const approvedAt = new Date('2026-09-28T05:00:00.000Z');
    const noFinanceReady = claim({ status: 'READY_FOR_PAYMENT', approvedAt });
    const noFinanceRouting = claim({ status: 'APPROVED', approvedAt });
    const underReview = claim({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', approvedAt });
    const handOffToFinance = claim({ status: 'APPROVED', financeReviewStatus: 'PENDING', approvedAt });
    const reviewedReady = claim({ status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT', approvedAt });
    const single = claim();
    const result = await run(repo([noFinanceReady, noFinanceRouting, underReview, handOffToFinance, reviewedReady, single],
      [step(single.id, { assignedApproverUserIds: ['mgrA'] })], { b1: ['mgrA'] }));
    const waitingOn = Object.fromEntries(result.items.map((item) => [item.id, item.waitingOn]));

    // Waiting for payment is whoever holds the pay right, finance reviewed or not: never "ฝ่ายการเงิน".
    for (const row of [noFinanceReady, noFinanceRouting, reviewedReady]) assert.equal(waitingOn[row.id], REIMBURSEMENT_DESK_LABELS.PAYMENT);
    assert.equal(result.desks.find((row) => row.kind === 'payment')?.label, REIMBURSEMENT_DESK_LABELS.PAYMENT);
    assert.doesNotMatch(REIMBURSEMENT_DESK_LABELS.PAYMENT, /การเงิน/);
    // Finance review keeps the web's word and says what it waits for.
    for (const row of [underReview, handOffToFinance]) assert.equal(waitingOn[row.id], `${REIMBURSEMENT_DESK_LABELS.FINANCE} (รอตรวจสอบ)`);
    assert.equal(result.desks.find((row) => row.kind === 'finance')?.label, 'ฝ่ายการเงิน (รอตรวจสอบ)');
    // One assigned approver: the person, as the web's "อยู่ที่ สมศรี".
    assert.equal(waitingOn[single.id], 'สมศรี');
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

  // Eval R-20: a manager with no claims of their own heard "all of yours were processed".
  it('says whether the caller has any claim at all when none of their own is waiting', async () => {
    const none = repo([], [], {});
    const noClaims = await run(none, ctx({ userId: 'mgr', permissions: ['reimbursement.read'] }), { requester: 'me' });
    assert.equal(noClaims.hasOwnClaims, false);
    assert.deepEqual(none.calls.own, { companyId: 'co', requesterUserId: 'mgr', scopes: { branchIds: ['b1', 'b2'] }, take: 1 });

    const paidOnly = await run(repo([], [], {}, [claim({ status: 'PAID' })]), ctx({ userId: 'mgr', permissions: ['reimbursement.read'] }), { requester: 'me' });
    assert.equal(paidOnly.hasOwnClaims, true);

    // Only asked for the caller's own empty list; a shop-wide or non-empty answer never carries it.
    const shop = repo([], [], {});
    assert.equal('hasOwnClaims' in await run(shop), false);
    assert.equal(shop.calls.own, undefined);
    const waiting = claim();
    assert.equal('hasOwnClaims' in await run(repo([waiting], [step(waiting.id, { assignedApproverUserIds: ['mgrA'] })], { b1: ['mgrA'] }),
      ctx({ permissions: ['reimbursement.read_own'] })), false);
  });

  // Payout spec §14.7, §17.3: sent back to have its payout account corrected. No step is open while it is
  // with its requester, and that is not a decided claim the system has yet to move on.
  it('puts a claim that waits for its requester to correct the payout account on its own desk, and counts it for no approver', async () => {
    const sentBackAt = new Date('2026-09-28T03:00:00.000Z');
    // Both claims carry an account of their own: the desk and its words are those of an account to correct.
    const account = { payoutMethod: 'BANK_TRANSFER', payoutFingerprint: 'f'.repeat(64) };
    const withRequester = claim({ ...account, payoutCorrectionRequestedAt: sentBackAt });
    // The account was given on the 29th: it waits for its approver again, since then.
    const withApprover = claim({ ...account, payoutCorrectionRequestedAt: sentBackAt, payoutCorrectionSubmittedAt: new Date('2026-09-29T03:00:00.000Z') });
    const decided = claim();
    const result = await run(repo([withRequester, withApprover, decided], [step(withApprover.id, { assignedApproverUserIds: ['mgrA'] })], { b1: ['mgrA'] }));

    assert.deepEqual(result.desks, [
      { kind: 'status_pending', label: 'รอระบบปรับสถานะ', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 },
      { kind: 'requester_correction', label: 'รอผู้เบิกแก้บัญชีรับเงิน', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }],
        oldestSentBackOn: '2026-09-28', longestWaitDays: 2,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้' },
    ]);
    assert.deepEqual(result.byApprover, [{ name: 'สมศรี', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }], oldestSubmittedOn: '2026-09-29', longestWaitDays: 1 }]);
    assert.deepEqual(result.items.map((item) => [item.id, item.waitingOn, item.submittedOn, item.sentBackOn ?? item.resubmittedOn ?? null, item.waitDays]), [
      [decided.id, 'รอระบบปรับสถานะ', '2026-09-23', null, 7],
      [withRequester.id, 'รอผู้เบิกแก้บัญชีรับเงิน', '2026-09-23', '2026-09-28', 2],
      [withApprover.id, 'สมศรี', '2026-09-23', '2026-09-29', 1],
    ]);
    assert.deepEqual([result.total, result.awaitingApprovalCount], [3, 1]);
  });
});

it('confirmed duplicates wait for cancellation, separate from payable claims in the LINE backlog', async () => {
  const blocked = claim({ status: 'READY_FOR_PAYMENT', confirmedDuplicateExpenseCount: 1 });
  const payable = claim({ status: 'READY_FOR_PAYMENT' });
  const partial = claim({ status: 'PARTIALLY_PAID', confirmedDuplicateExpenseCount: 1 });
  const result = await run(repo([blocked, partial, payable], [], {}));
  assert.equal(result.items.find(row => row.id === blocked.id)!.waitingOn, 'ติดรายการซ้ำ');
  assert.equal(result.desks.length, 3);
  assert.equal(result.items.find(row => row.id === partial.id)!.waitingOn, 'ติดรายการซ้ำ');
  assert.equal(result.desks.filter(row => row.kind === 'payment').reduce((sum, row) => sum + row.count, 0), 1);
  const blocks = result.desks.filter(row => row.kind === 'duplicate_blocked');
  assert.equal(blocks.reduce((sum, row) => sum + row.count, 0), 2);
  assert.match(blocks.find(row => row.note?.includes('รอยกเลิกคำขอ'))!.note!, /รอยกเลิกคำขอ เพราะใบเสร็จยืนยันว่าซ้ำ/);
});

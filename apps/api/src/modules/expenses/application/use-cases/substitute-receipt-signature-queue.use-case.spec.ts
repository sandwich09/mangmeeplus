/**
 * Advisor S1 (spec §5.2): the caller's own substitute-receipt signature queue applies the SAME gates the web
 * certify/approve/accept paths apply — payer permission, expense.confirm, policy mode and designation,
 * eligibility, branch scope, self-approval by the caller's REAL roles, and the original approver of a
 * correction. The Prisma translation of each filter is proven against real Postgres in
 * substitute-receipt-signature-queue.pg.spec.ts; this spec pins which filter each caller gets.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { ListMySubstituteReceiptSignaturesUseCase } from './substitute-receipt.use-case';

type QueueFilter = { step: 'PAYER' | 'APPROVER'; userId: string; branchIds?: string[]; excludeSelf?: boolean; excludeEvidenceIds?: readonly string[] };

function row(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: 'SR-2026-0001', payeeName: 'ร้านป้าแดง', status: 'PREPARED', signatureMode: 'DIGITAL',
    preparedAt: new Date('2026-09-11T20:00:00.000Z'),
    expense: { expenseDate: new Date('2026-09-10T17:30:00.000Z'), vendorNameSnapshot: 'ร้านป้าแดง (บิล)', currency: 'THB', grandTotalAmount: { toString: () => '350' } },
    ...overrides,
  };
}

function harness(options: {
  policy?: { approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS'; approverUserIds: string[] } | null;
  eligible?: string[];
  corrections?: Array<{ id: string; originalApproverUserId: string | null }>;
  pages?: Partial<Record<'PAYER' | 'APPROVER', { rows: unknown[]; count: number }>>;
} = {}) {
  const calls: Array<{ filter: QueueFilter; take: number }> = [];
  const correctionScopes: Array<string[] | undefined> = [];
  const repo = {
    listSubstituteReceiptsAwaitingSignature: async (_companyId: string, filter: QueueFilter, take: number) => {
      calls.push({ filter, take });
      return options.pages?.[filter.step] ?? { rows: [], count: 0 };
    },
    getSubstituteReceiptPolicy: async () => options.policy === undefined ? null : options.policy,
    listEligibleSubstituteReceiptApprovers: async () => (options.eligible ?? ['me']).map((userId) => ({ userId, displayName: userId })),
    listPendingSubstituteCorrections: async (_companyId: string, branchIds?: string[]) => { correctionScopes.push(branchIds); return options.corrections ?? []; },
  };
  return { useCase: new ListMySubstituteReceiptSignaturesUseCase(repo as never), calls, correctionScopes };
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'r1', authSubject: 'me', userId: 'me', companyId: 'co-1', membershipId: 'm1',
    roles: ['OWNER'], permissions: ['expense.read_own', 'expense.read_related', 'expense.confirm'],
    scopes: { branchIds: ['branch-1'] }, authProvider: 'line', ...overrides,
  };
}

describe('ListMySubstituteReceiptSignaturesUseCase — the caller\'s own signature queue', () => {
  it('maps the payer step to plain facts only: document number, payee, amount, currency, civil dates, a Thai step', async () => {
    const { useCase, calls } = harness({ pages: { PAYER: { rows: [row(), row({ payeeName: null, documentNumber: 'SR-2026-0002' })], count: 5 } } });
    const result = await useCase.execute(ctx(), { role: 'payer', limit: 10 });
    assert.deepEqual(calls, [{ filter: { step: 'PAYER', userId: 'me', branchIds: ['branch-1'] }, take: 10 }]);
    assert.equal(result.asApprover, undefined);
    assert.equal(result.asPayer!.count, 5, 'the database count, not the page length');
    assert.deepEqual(result.asPayer!.items[0], {
      documentNumber: 'SR-2026-0001', payeeName: 'ร้านป้าแดง', amount: '350', currency: 'THB',
      // Bangkok civil dates: 17:30Z is 00:30 the next day in Bangkok.
      expenseDate: '2026-09-11', preparedOn: '2026-09-12', stepLabel: 'รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน',
    });
    assert.equal(result.asPayer!.items[1]!.payeeName, 'ร้านป้าแดง (บิล)', 'falls back to the expense vendor');
    const json = JSON.stringify(result);
    for (const forbidden of ['payeeTaxId', 'payeeAddress', 'Signature', 'attachment']) assert.ok(!json.includes(forbidden), forbidden);
  });

  it('never reads the payer step for a caller the web certify route would refuse', async () => {
    const { useCase, calls } = harness();
    const result = await useCase.execute(ctx({ permissions: ['expense.confirm'] }), { role: 'payer', limit: 10 });
    assert.deepEqual(result, { asPayer: { count: 0, items: [] } });
    assert.equal(calls.length, 0);
  });

  it('never reads the approver step without expense.confirm', async () => {
    const { useCase, calls } = harness();
    const result = await useCase.execute(ctx({ permissions: ['expense.read_own'] }), { limit: 10 });
    assert.deepEqual(result.asApprover, { count: 0, items: [] });
    assert.deepEqual(calls.map((call) => call.filter.step), ['PAYER']);
  });

  it('a one-person shop (OWNER_SELF, OWNER role) keeps the receipts it paid itself', async () => {
    const { useCase, calls } = harness({ policy: { approvalMode: 'OWNER_SELF', approverUserIds: [] } });
    await useCase.execute(ctx({ roles: ['OWNER'] }), { role: 'approver', limit: 10 });
    assert.equal(calls[0]!.filter.step, 'APPROVER');
    assert.equal(calls[0]!.filter.excludeSelf, false, 'selfApprovalPermitted: OWNER_SELF + OWNER role');
  });

  it('without real roles the same owner would lose them — which is why the roles must reach this use case', async () => {
    const { useCase, calls } = harness({ policy: null });
    await useCase.execute(ctx({ roles: [] }), { role: 'approver', limit: 10 });
    assert.equal(calls[0]!.filter.excludeSelf, true);
  });

  it('a non-exempt role never counts what it paid itself, even under OWNER_SELF', async () => {
    const { useCase, calls } = harness({ policy: { approvalMode: 'OWNER_SELF', approverUserIds: [] } });
    await useCase.execute(ctx({ roles: ['ACCOUNTANT'] }), { role: 'approver', limit: 10 });
    assert.equal(calls[0]!.filter.excludeSelf, true);
  });

  it('DESIGNATED_APPROVERS: an undesignated confirmer has nothing to approve; a designated owner still cannot self-approve', async () => {
    const outsider = harness({ policy: { approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['someone-else'] } });
    assert.deepEqual((await outsider.useCase.execute(ctx(), { role: 'approver', limit: 10 })).asApprover, { count: 0, items: [] });
    assert.equal(outsider.calls.length, 0);

    const designated = harness({ policy: { approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['me'] } });
    await designated.useCase.execute(ctx({ roles: ['OWNER'] }), { role: 'approver', limit: 10 });
    assert.equal(designated.calls[0]!.filter.excludeSelf, true, 'selfApprovalPermitted is OWNER_SELF only');
  });

  it('a confirmer who is not an eligible approver (no ACTIVE role with expense.confirm) has nothing to approve', async () => {
    const { useCase, calls } = harness({ eligible: ['someone-else'] });
    assert.deepEqual((await useCase.execute(ctx(), { role: 'approver', limit: 10 })).asApprover, { count: 0, items: [] });
    assert.equal(calls.length, 0);
  });

  it('a correction counts only for the approver of the receipt it corrects', async () => {
    const { useCase, calls, correctionScopes } = harness({ corrections: [
      { id: 'mine', originalApproverUserId: 'me' }, { id: 'theirs', originalApproverUserId: 'other' }, { id: 'unknown', originalApproverUserId: null },
    ] });
    await useCase.execute(ctx(), { role: 'approver', limit: 3 });
    assert.deepEqual(calls[0]!.filter.excludeEvidenceIds, ['theirs', 'unknown']);
    assert.equal(calls[0]!.take, 3);
    assert.deepEqual(correctionScopes, [['branch-1']], 'corrections are read inside the caller branch scope');
  });

  it('labels a payer-certified receipt and a paper copy waiting to be accepted in plain Thai', async () => {
    const { useCase } = harness({ pages: { APPROVER: { rows: [row({ status: 'PAYER_CERTIFIED' }), row({ status: 'PREPARED', signatureMode: 'PAPER' })], count: 2 } } });
    const result = await useCase.execute(ctx(), { limit: 10 });
    assert.deepEqual(result.asApprover!.items.map((item) => item.stepLabel), ['รอคุณอนุมัติ', 'ฉบับกระดาษรอคุณตรวจรับ']);
  });
});

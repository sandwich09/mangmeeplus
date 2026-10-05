import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaExpenseRepository } from './prisma-expense.repository.js';

type CandidateRow = {
  id: string;
  companyId: string;
  expenseId: string;
  candidateExpenseId: string;
  status: string;
  resolvedByUserId: string | null;
  resolvedAt?: Date | null;
  resolutionReason?: string | null;
  reasonCodesJson?: string[];
  score?: number;
};
type ExpenseRow = {
  id: string;
  companyId: string;
  branchId: string | null;
  status: string;
  duplicateStatus: string;
  postingStatus: string;
  duplicateOfExpenseId: string | null;
  duplicateOverrideReason: string | null;
};

function harness() {
  const lockKeys: string[] = [];
  const store = {
    candidates: [
      { id: 'cand-own', companyId: 'co-1', expenseId: 'expense-1', candidateExpenseId: 'expense-existing', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-own-2', companyId: 'co-1', expenseId: 'expense-1', candidateExpenseId: 'expense-existing-2', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-other-company', companyId: 'co-2', expenseId: 'expense-2', candidateExpenseId: 'expense-other', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-other-expense', companyId: 'co-1', expenseId: 'expense-9', candidateExpenseId: 'expense-existing', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-posted', companyId: 'co-1', expenseId: 'expense-posted', candidateExpenseId: 'expense-existing', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-posting-locked', companyId: 'co-1', expenseId: 'expense-posting-locked', candidateExpenseId: 'expense-existing', status: 'OPEN', resolvedByUserId: null },
      { id: 'cand-cross-branch', companyId: 'co-1', expenseId: 'expense-1', candidateExpenseId: 'expense-branch-b', status: 'OPEN', resolvedByUserId: null },
    ] as CandidateRow[],
    expenses: [
      { id: 'expense-1', companyId: 'co-1', branchId: 'branch-a', status: 'NEEDS_REVIEW', duplicateStatus: 'POSSIBLE_DUPLICATE', postingStatus: 'pending', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-2', companyId: 'co-2', branchId: 'branch-a', status: 'NEEDS_REVIEW', duplicateStatus: 'POSSIBLE_DUPLICATE', postingStatus: 'pending', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-posted', companyId: 'co-1', branchId: 'branch-a', status: 'CONFIRMED', duplicateStatus: 'POSSIBLE_DUPLICATE', postingStatus: 'posted', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-posting-locked', companyId: 'co-1', branchId: 'branch-a', status: 'NEEDS_REVIEW', duplicateStatus: 'POSSIBLE_DUPLICATE', postingStatus: 'posted', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-existing', companyId: 'co-1', branchId: 'branch-a', status: 'NEEDS_REVIEW', duplicateStatus: 'NO_MATCH', postingStatus: 'pending', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-existing-2', companyId: 'co-1', branchId: 'branch-a', status: 'NEEDS_REVIEW', duplicateStatus: 'NO_MATCH', postingStatus: 'pending', duplicateOfExpenseId: null, duplicateOverrideReason: null },
      { id: 'expense-branch-b', companyId: 'co-1', branchId: 'branch-b', status: 'NEEDS_REVIEW', duplicateStatus: 'NO_MATCH', postingStatus: 'pending', duplicateOfExpenseId: null, duplicateOverrideReason: null },
    ] as ExpenseRow[],
  };
  const matchesValue = (actual: unknown, expected: any): boolean => {
    if (expected && typeof expected === 'object') {
      if (Array.isArray(expected.in)) return expected.in.includes(actual);
      if (Array.isArray(expected.notIn)) return !expected.notIn.includes(actual);
      if ('not' in expected) return !matchesValue(actual, expected.not);
    }
    return actual === expected;
  };
  const matchesWhere = (row: any, where: Record<string, any>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return Array.isArray(value) && value.some((clause) => matchesWhere(row, clause));
    if (key === 'candidateExpense') {
      const target = store.expenses.find((expense) => expense.id === row.candidateExpenseId);
      return !!target && matchesWhere(target, value);
    }
    return matchesValue(row[key], value);
  });
  const select = (row: any, projection?: Record<string, boolean>) => projection
    ? Object.fromEntries(Object.keys(projection).filter((key) => projection[key]).map((key) => [key, row[key]]))
    : row;
  const table = (rows: any[]) => ({
    findFirst: async ({ where, select: projection }: any) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      return row ? select(row, projection) : null;
    },
    findMany: async ({ where, select: projection }: any) => rows.filter((row) => matchesWhere(row, where)).map((row) => select(row, projection)),
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((row) => matchesWhere(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
  });
  const candidateTable = {
    ...table(store.candidates),
    upsert: async ({ where, create, update }: any) => {
      const key = where.companyId_expenseId_candidateExpenseId;
      const existing = store.candidates.find((row) => row.companyId === key.companyId
        && row.expenseId === key.expenseId
        && row.candidateExpenseId === key.candidateExpenseId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const created = { id: `cand-${store.candidates.length + 1}`, status: 'OPEN', resolvedByUserId: null, ...create } as CandidateRow;
      store.candidates.push(created);
      return created;
    },
  };
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const snapshot = structuredClone({ candidates: store.candidates, expenses: store.expenses });
      try {
        return await work(client);
      } catch (err) {
        store.candidates.splice(0, store.candidates.length, ...snapshot.candidates);
        store.expenses.splice(0, store.expenses.length, ...snapshot.expenses);
        throw err;
      }
    },
    $executeRaw: async (_query: TemplateStringsArray, lockKey: string) => { lockKeys.push(lockKey); },
    expenseDuplicateCandidate: candidateTable,
    expenseRecord: table(store.expenses),
  };
  return { repo: new PrismaExpenseRepository({ client } as any), store, lockKeys, client };
}

const base = {
  companyId: 'co-1', expenseId: 'expense-1', actorUserId: 'user-1', action: 'confirm' as const,
  scopes: { branchIds: ['branch-a'] },
};
const noopAudit = async () => undefined;

describe('PrismaExpenseRepository duplicate-candidate resolution', () => {
  it('takes the company reconciliation lock before the expense lock for scans and resolutions', async () => {
    const scan = harness();
    await scan.repo.runDuplicateCheck(base, async () => []);
    assert.deepEqual(scan.lockKeys.slice(0, 2), [
      'co-1:duplicate-reconciliation',
      'co-1:expense-1:substitute-receipt',
    ]);

    const resolution = harness();
    await resolution.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit);
    assert.deepEqual(resolution.lockKeys.slice(0, 2), [
      'co-1:duplicate-reconciliation',
      'co-1:expense-1:substitute-receipt',
    ]);
  });

  it('resolves an owned open candidate and records the duplicate expense', async () => {
    const { repo, store } = harness();
    await repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit);
    assert.equal(store.candidates.find((c) => c.id === 'cand-own')?.status, 'CONFIRMED_DUPLICATE');
    const expense = store.expenses.find((e) => e.id === 'expense-1');
    assert.equal(expense?.duplicateStatus, 'CONFIRMED_DUPLICATE');
    assert.equal(expense?.duplicateOfExpenseId, 'expense-existing');
    assert.equal(expense?.postingStatus, 'not_required');
    assert.equal(store.candidates.find((c) => c.id === 'cand-own-2')?.status, 'DISMISSED');
    assert.equal(store.candidates.filter((c) => c.expenseId === 'expense-1' && c.status === 'OPEN').length, 0);
  });

  it('rejects candidate ids belonging to another company or expense', async () => {
    for (const candidateId of ['cand-other-company', 'cand-other-expense']) {
      const { repo, store } = harness();
      await assert.rejects(() => repo.resolveDuplicateCandidate({ ...base, candidateId }, noopAudit), /not found on expense/);
      assert.equal(store.candidates.find((c) => c.id === candidateId)?.status, 'OPEN');
      assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateStatus, 'POSSIBLE_DUPLICATE');
    }
  });

  it('revalidates branch scope after taking the transaction lock', async () => {
    const { repo, store } = harness();
    store.expenses.find((e) => e.id === 'expense-1')!.branchId = 'branch-b';
    await assert.rejects(() => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit), /branch scope/i);
    assert.equal(store.candidates.find((c) => c.id === 'cand-own')?.status, 'OPEN');
  });

  it('rejects a candidate whose target expense is outside the caller branch scope', async () => {
    const { repo, store } = harness();
    await assert.rejects(
      () => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-cross-branch' }, noopAudit),
      /Duplicate target .* not found/,
    );
    assert.equal(store.candidates.find((c) => c.id === 'cand-cross-branch')?.status, 'OPEN');
  });

  it('cannot repark a confirmed projection through a duplicate rescan or resolution, even before posting', async () => {
    for (const postingStatus of ['pending', 'posted']) {
      const { repo, store } = harness();
      Object.assign(store.expenses.find((e) => e.id === 'expense-1')!, { status: 'CONFIRMED', postingStatus, sourceReimbursementRequestId: 'claim-1' });
      const before = structuredClone(store);
      await assert.rejects(() => repo.runDuplicateCheck(base, async () => {
        assert.fail('a confirmed projection must not be scanned again');
      }), /status CONFIRMED/);
      await assert.rejects(() => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own', action: 'dismiss' }, noopAudit), /status CONFIRMED/);
      assert.deepEqual(store, before);
    }
  });

  it('rejects duplicate writes on an editable expense whose posting is already locked', async () => {
    const { repo, store } = harness();
    await assert.rejects(
      () => repo.resolveDuplicateCandidate({ ...base, expenseId: 'expense-posting-locked', candidateId: 'cand-posting-locked' }, noopAudit),
      /posting status posted/,
    );
    assert.equal(store.candidates.find((c) => c.id === 'cand-posting-locked')?.status, 'OPEN');
  });

  it('keeps the expense blocked when dismissing one of several open candidates', async () => {
    const { repo, store } = harness();
    await repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own', action: 'dismiss' }, noopAudit);
    assert.equal(store.candidates.find((c) => c.id === 'cand-own')?.status, 'DISMISSED');
    assert.equal(store.candidates.find((c) => c.id === 'cand-own-2')?.status, 'OPEN');
    assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateStatus, 'POSSIBLE_DUPLICATE');
  });

  it('marks the expense overridden only after the final open candidate is dismissed', async () => {
    const { repo, store } = harness();
    store.candidates.find((c) => c.id === 'cand-own-2')!.status = 'DISMISSED';
    store.candidates.find((c) => c.id === 'cand-cross-branch')!.status = 'DISMISSED';
    await repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own', action: 'dismiss', reason: 'not a duplicate' }, noopAudit);
    const expense = store.expenses.find((e) => e.id === 'expense-1');
    assert.equal(expense?.duplicateStatus, 'OVERRIDDEN');
    assert.equal(expense?.duplicateOverrideReason, 'not a duplicate');
  });

  it('does not reopen or flip an already resolved candidate', async () => {
    const { repo, store } = harness();
    store.candidates.find((c) => c.id === 'cand-own')!.status = 'CONFIRMED_DUPLICATE';
    await assert.rejects(
      () => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own', action: 'dismiss' }, noopAudit),
      /already has a confirmed duplicate candidate/,
    );
    assert.equal(store.candidates.find((c) => c.id === 'cand-own')?.status, 'CONFIRMED_DUPLICATE');
  });

  it('rolls the candidate and expense writes back when the audit write fails', async () => {
    const { repo, store } = harness();
    await assert.rejects(
      () => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, async () => { throw new Error('audit_write_failed'); }),
      /audit_write_failed/,
    );
    assert.equal(store.candidates.find((c) => c.id === 'cand-own')?.status, 'OPEN');
    assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateStatus, 'POSSIBLE_DUPLICATE');
  });

  it('blocks an off-scope manual rescan before running detection', async () => {
    const { repo } = harness();
    let scans = 0;
    await assert.rejects(
      () => repo.runDuplicateCheck({ companyId: 'co-1', expenseId: 'expense-1', actorUserId: 'user-1', scopes: { branchIds: ['branch-b'] } }, async () => { scans += 1; return []; }),
      /branch scope/i,
    );
    assert.equal(scans, 0);
  });

  it('preserves a human resolution and closes stale open candidates during rescan', async () => {
    const { repo, store } = harness();
    const resolved = store.candidates.find((c) => c.id === 'cand-own')!;
    resolved.status = 'DISMISSED';
    resolved.resolvedByUserId = 'reviewer-1';
    resolved.resolutionReason = 'not a duplicate';
    store.candidates.find((c) => c.id === 'cand-cross-branch')!.status = 'DISMISSED';
    const state = await repo.runDuplicateCheck(base, async () => ['expense-existing']);
    assert.deepEqual(state, { openCandidates: 0, duplicateStatus: 'OVERRIDDEN' });
    assert.equal(resolved.status, 'DISMISSED');
    assert.equal(resolved.resolutionReason, 'not a duplicate');
    const stale = store.candidates.find((c) => c.id === 'cand-own-2');
    assert.equal(stale?.status, 'DISMISSED');
    assert.equal(stale?.resolvedByUserId, null);
    assert.equal(stale?.resolutionReason, 'system:stale_after_rescan');
    assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateStatus, 'OVERRIDDEN');
  });

  it('does not stale-close a candidate whose target is outside the caller branch scope', async () => {
    const { repo, store } = harness();

    const state = await repo.runDuplicateCheck(base, async () => []);

    assert.equal(store.candidates.find((c) => c.id === 'cand-cross-branch')?.status, 'OPEN');
    assert.deepEqual(state, { openCandidates: 1, duplicateStatus: 'POSSIBLE_DUPLICATE' });
  });

  it('reopens only system-stale evidence when the same match returns', async () => {
    const { repo, store } = harness();
    const systemStale = store.candidates.find((c) => c.id === 'cand-own')!;
    Object.assign(systemStale, {
      status: 'DISMISSED',
      resolvedByUserId: null,
      resolvedAt: new Date('2026-08-01T00:00:00.000Z'),
      resolutionReason: 'system:stale_after_rescan',
    });
    const humanDismissed = store.candidates.find((c) => c.id === 'cand-own-2')!;
    Object.assign(humanDismissed, {
      status: 'DISMISSED',
      resolvedByUserId: 'reviewer-1',
      resolutionReason: 'different purchase',
      score: 10,
    });

    await repo.createDuplicateCandidate('co-1', 'expense-1', 'expense-existing', ['same_checksum'], 40, (repo as any).prisma.client);
    await repo.createDuplicateCandidate('co-1', 'expense-1', 'expense-existing-2', ['same_checksum'], 40, (repo as any).prisma.client);

    assert.equal(systemStale.status, 'OPEN');
    assert.equal(systemStale.resolutionReason, null);
    assert.equal(humanDismissed.status, 'DISMISSED');
    assert.equal(humanDismissed.resolutionReason, 'different purchase');
    assert.equal(humanDismissed.score, 10);
  });

  it('never downgrades a confirmed duplicate during a later empty rescan', async () => {
    const { repo, store } = harness();
    store.candidates.find((c) => c.id === 'cand-own')!.status = 'CONFIRMED_DUPLICATE';
    store.candidates.find((c) => c.id === 'cand-own')!.resolvedByUserId = 'reviewer-1';

    const state = await repo.runDuplicateCheck(base, async () => []);

    assert.deepEqual(state, { openCandidates: 0, duplicateStatus: 'CONFIRMED_DUPLICATE' });
    assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateOfExpenseId, 'expense-existing');
  });

  it('rejects a second confirmed winner without changing the selected target', async () => {
    const { repo, store } = harness();
    await repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own', reason: 'same receipt' }, noopAudit);
    await assert.rejects(
      () => repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own-2', reason: 'same receipt' }, noopAudit),
      /already has a confirmed duplicate candidate/,
    );
    assert.equal(store.expenses.find((e) => e.id === 'expense-1')?.duplicateOfExpenseId, 'expense-existing');
  });

  it('rejects a missing expense before detection', async () => {
    const { repo } = harness();
    let scans = 0;
    await assert.rejects(
      () => repo.runDuplicateCheck({ ...base, expenseId: 'expense-missing' }, async () => { scans += 1; return []; }),
      /Expense expense-missing not found/,
    );
    assert.equal(scans, 0);
  });

  it('redacts a confirmed duplicate target unless the candidate is branch-visible', async () => {
    const makeDetailRepo = (duplicateCandidates: any[]) => new PrismaExpenseRepository({
      client: {
        expenseRecord: { findFirst: async () => ({
          id: 'expense-1', companyId: 'co-1', status: 'NEEDS_REVIEW', paymentStatus: 'UNPAID',
          sourceReimbursementRequestId: null, journalEntryId: null,
          duplicateOfExpenseId: 'expense-other-branch', lines: [], duplicateCandidates,
        }) },
        journalEntry: { findMany: async () => [] },
        attachmentLink: { findMany: async () => [] },
        expenseSubstituteReceiptEvidence: { findFirst: async () => null, findMany: async () => [] },
      },
    } as any);

    const hidden = await makeDetailRepo([])
      .findByIdWithRelations('co-1', 'expense-1', undefined, { branchIds: ['branch-a'] });
    assert.equal(hidden?.duplicateOfExpenseId, null);

    const visible = await makeDetailRepo([{
      id: 'candidate-1', candidateExpenseId: 'expense-other-branch', status: 'CONFIRMED_DUPLICATE',
      reasonCodesJson: [], score: 100, resolvedAt: null, resolutionReason: 'same receipt',
    }]).findByIdWithRelations('co-1', 'expense-1', undefined, { branchIds: ['branch-a'] });
    assert.equal(visible?.duplicateOfExpenseId, 'expense-other-branch');
  });
});


it('a claim-bound dismissal can clear a hidden cross-branch candidate, but cannot claim another source expense', async () => {
  const h = harness();
  Object.assign(h.store.expenses.find(e => e.id === 'expense-1')!, { sourceReimbursementRequestId: 'rb-1' });
  const input: any = { companyId: 'co-1', expenseId: 'expense-1', candidateId: 'cand-cross-branch', actorUserId: 'payer', action: 'dismiss', reason: 'คนละการซื้อ', scopes: { branchIds: ['branch-a'] }, reimbursementRequestId: 'rb-1', reimbursementBranchId: 'branch-a' };
  await assert.rejects(() => h.repo.resolveDuplicateCandidate({ ...input, reimbursementRequestId: 'rb-other' }, async () => undefined), /reimbursement_projection_source_mismatch/);
  await h.repo.resolveDuplicateCandidate(input, async () => undefined);
  assert.equal(h.store.candidates.find(c => c.id === 'cand-cross-branch')!.status, 'DISMISSED');
});

it('D3: confirmed own duplicate commits one claim event, retries once and skips paid or closed claims', async () => {
  for (const status of ['READY_FOR_PAYMENT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'DRAFT', 'PAID', 'CANCELLED', 'VOIDED', 'REJECTED']) {
    const h = harness();
    (h.store.expenses[0] as any).sourceReimbursementRequestId = 'rb-1';
    const claim: any = { id: 'rb-1', companyId: 'co-1', status, branchId: 'branch-a', requesterUserId: 'requester', requestNo: 'RB-1', sourceExpenses: [] };
    h.client.reimbursementRequest = { findFirst: async () => claim, findFirstOrThrow: async () => ({ ...claim, sourceExpenses: [{ ...h.store.expenses[0], duplicateCandidates: h.store.candidates }] }) };
    h.client.reimbursementPolicy = { findFirst: async () => null };
    const events: any[] = [];
    h.client.outboxEvent = { createMany: async ({ data }: any) => { for (const row of data) if (!events.some(e => e.eventKey === row.eventKey)) events.push(row); } };
    await h.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit);
    const open = !['PAID', 'CANCELLED', 'VOIDED', 'REJECTED'].includes(status);
    assert.equal(events.length, open ? 1 : 0, status);
    await h.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit);
    assert.equal(events.length, open ? 1 : 0);
    if (open) { assert.equal(events[0].payloadJson.data.requesterUserId, 'requester'); assert.equal(events[0].payloadJson.actorUserId, base.actorUserId); assert.equal(events[0].aggregateId, 'rb-1'); }
  }
  const standalone = harness();
  await standalone.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit);
  await assert.rejects(() => standalone.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit), /already has a confirmed duplicate/);
});
it('D3: a failed claim event rolls confirmation back', async () => {
  const h = harness(); (h.store.expenses[0] as any).sourceReimbursementRequestId = 'rb-1';
  const claim: any = { id: 'rb-1', status: 'READY_FOR_PAYMENT', requesterUserId: 'requester', branchId: 'branch-a' };
  h.client.reimbursementRequest = { findFirst: async () => claim, findFirstOrThrow: async () => ({ ...claim, sourceExpenses: [{ ...h.store.expenses[0], duplicateCandidates: h.store.candidates }] }) };
  h.client.reimbursementPolicy = { findFirst: async () => null };
  h.client.outboxEvent = { createMany: async () => { throw new Error('outbox_failed'); } };
  await assert.rejects(() => h.repo.resolveDuplicateCandidate({ ...base, candidateId: 'cand-own' }, noopAudit), /outbox_failed/);
  assert.equal(h.store.candidates[0].status, 'OPEN'); assert.equal(h.store.expenses[0].duplicateStatus, 'POSSIBLE_DUPLICATE');
});

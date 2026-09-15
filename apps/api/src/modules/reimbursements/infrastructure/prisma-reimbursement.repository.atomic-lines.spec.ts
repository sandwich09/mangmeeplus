import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';

type State = { headers: Map<string, Record<string, unknown>>; lines: Map<string, Record<string, unknown>> };

function cloneState(state: State): State {
  return {
    headers: new Map([...state.headers].map(([key, value]) => [key, structuredClone(value)])),
    lines: new Map([...state.lines].map(([key, value]) => [key, structuredClone(value)])),
  };
}

function fakePrisma(options: { failLineUpsert?: boolean; failHeaderUpdate?: boolean } = {}) {
  let state: State = { headers: new Map(), lines: new Map() };
  const tx = {
    $queryRaw: async () => [],
    branch: { findFirst: async () => ({ id: 'branch-1' }) },
    companyMembership: { findFirst: async () => ({ id: 'member-1' }) },
    $executeRaw: async () => [{ locked: true }],
    reimbursementRequest: {
      create: async ({ data }: any) => {
        const row = { id: 'request-new', ...data };
        state.headers.set(String(row.id), row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        if (options.failHeaderUpdate) throw new Error('header_update_failed');
        const row = state.headers.get(where.id);
        if (!row || row.companyId !== where.companyId || row.status !== where.status
          || (row.updatedAt as Date).getTime() !== where.updatedAt.getTime()) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findFirstOrThrow: async ({ where }: any) => {
        const row = state.headers.get(where.id);
        if (!row) throw new Error('not_found');
        return { ...row, lines: [...state.lines.values()].filter((line) => line.reimbursementRequestId === where.id) };
      },
    },
    reimbursementLine: {
      deleteMany: async ({ where }: any) => {
        for (const [key, line] of state.lines) {
          const sameAggregate = line.companyId === where.companyId
            && line.reimbursementRequestId === where.reimbursementRequestId;
          const exactFallback = typeof where.id === 'string' && line.id === where.id;
          const removedLineNo = Array.isArray(where.lineNo?.notIn)
            && where.lineNo.notIn.includes(line.lineNo) === false;
          if (sameAggregate && (exactFallback || removedLineNo)) state.lines.delete(key);
        }
      },
      upsert: async ({ where, create, update }: any) => {
        if (options.failLineUpsert) throw new Error('line_upsert_failed');
        const identity = `${where.reimbursementRequestId_lineNo.reimbursementRequestId}:${where.reimbursementRequestId_lineNo.lineNo}`;
        const current = state.lines.get(identity);
        state.lines.set(identity, current ? { ...current, ...update } : { id: `line-${identity}`, ...create });
      },
    },
  };
  const client = {
    $transaction: async (work: (value: typeof tx) => Promise<unknown>) => {
      const before = cloneState(state);
      try { return await work(tx); } catch (error) { state = before; throw error; }
    },
  };
  return {
    repo: new PrismaReimbursementRepository({ client } as any, {} as any),
    seed(header: Record<string, unknown>, line: Record<string, unknown>) {
      state.headers.set(String(header.id), structuredClone(header));
      state.lines.set(`${line.reimbursementRequestId}:${line.lineNo}`, structuredClone(line));
    },
    snapshot: () => cloneState(state),
  };
}

const line = {
  lineNo: 1, incurredDate: new Date('2026-08-03T00:00:00Z'), description: 'Taxi',
  categoryKey: 'travel', amount: '100.0000',
};

describe('PrismaReimbursementRepository aggregate transaction', () => {
  it('rolls a new header back when line replacement fails', async () => {
    const state = fakePrisma({ failLineUpsert: true });
    await assert.rejects(() => state.repo.createRequest({
      companyId: 'company-1', branchId: 'branch-1', requesterUserId: 'user-1', requesterDisplayNameSnapshot: 'User',
      reason: 'Travel', categoryKey: 'travel', amount: '100.0000', currency: 'THB',
      incurredDate: new Date('2026-08-03T00:00:00Z'), receiptRequirementStatus: 'REQUIRED',
      createdByUserId: 'user-1', lines: [line],
    }), /line_upsert_failed/);
    assert.equal(state.snapshot().headers.size, 0);
    assert.equal(state.snapshot().lines.size, 0);
  });

  it('rolls header and prior lines back together when replacement fails', async () => {
    const state = fakePrisma({ failLineUpsert: true });
    const observed = new Date('2026-08-03T01:00:00Z');
    state.seed(
      { id: 'request-1', companyId: 'company-1', amount: '50.0000', status: 'DRAFT', updatedAt: observed },
      { id: 'line-old', companyId: 'company-1', reimbursementRequestId: 'request-1', lineNo: 1, amount: '50.0000' },
    );
    await assert.rejects(() => state.repo.updateDraftRequest(
      'company-1', 'request-1', observed, { amount: '100.0000' }, [line],
    ), /line_upsert_failed/);
    const snapshot = state.snapshot();
    assert.equal(snapshot.headers.get('request-1')?.amount, '50.0000');
    assert.equal(snapshot.lines.get('request-1:1')?.amount, '50.0000');
  });

  it('does not touch prior lines when the header update fails', async () => {
    const state = fakePrisma({ failHeaderUpdate: true });
    const observed = new Date('2026-08-03T01:00:00Z');
    state.seed(
      { id: 'request-1', companyId: 'company-1', amount: '50.0000', status: 'DRAFT', updatedAt: observed },
      { id: 'line-old', companyId: 'company-1', reimbursementRequestId: 'request-1', lineNo: 1, amount: '50.0000' },
    );
    await assert.rejects(() => state.repo.updateDraftRequest(
      'company-1', 'request-1', observed, { amount: '100.0000' }, [line],
    ), /header_update_failed/);
    const snapshot = state.snapshot();
    assert.equal(snapshot.headers.get('request-1')?.amount, '50.0000');
    assert.equal(snapshot.lines.get('request-1:1')?.amount, '50.0000');
  });
});

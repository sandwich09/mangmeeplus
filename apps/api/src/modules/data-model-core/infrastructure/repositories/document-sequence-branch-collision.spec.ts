/**
 * Audit CR-7: a per-branch counter under a branch-blind template issued the same number twice.
 *
 * `DocumentNumber` is unique on `(companyId, documentType, documentNumber)` — company-wide — while
 * the counter was partitioned by `branchId ?? 'GLOBAL'`. None of the 22 default templates contain
 * `{BRANCH}`, so the second scope's counter started at 1 and rendered the string the first scope
 * had already taken. The insert was rejected, and because the rejection rolls the whole reservation
 * transaction back, the `nextNumber` increment went with it: that scope retried the same number on
 * every attempt, forever, and only a hand edit in the database could free it.
 *
 * It needed no second branch. The web sends `branchId: branch?.branchId || undefined`, so simply
 * having a branch selected in the picker moved a company off the `GLOBAL` counter it had been
 * numbering under.
 *
 * The rule now is that the counter may only be split by branch when the number can say which branch
 * it came from. These tests state that rule at the allocator, and — just as importantly — that a
 * company already numbering under a branch scope carries its counter over instead of restarting at
 * 1, which would re-issue numbers it has already given out and cause the exact wedge above.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from './prisma-document-sequence.repository';
import { UpsertDocumentSequenceUseCase } from '../../application/use-cases/upsert-document-sequence.use-case';

const now = new Date('2026-08-10T00:00:00.000Z');

function sequenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seq-1', companyId: 'co-1', branchId: null, branchScopeKey: 'GLOBAL',
    documentType: 'tax.invoice', periodKey: '2026-08', prefixTemplate: 'TAX-{YYYY}{MM}-{SEQ}',
    nextNumber: 1, padding: 5, resetPolicy: 'MONTHLY', status: 'ACTIVE',
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}

/**
 * Stands in for the rows a company already has. `findFirst` answers on the query the way Postgres
 * would, so the allocator's call order is free to change without rewriting the test.
 */
function repoOver(rows: any[]) {
  const created: any[] = [];
  const reserved: any[] = [];
  const match = (row: any, where: any) =>
    (where.companyId === undefined || row.companyId === where.companyId)
    && (where.documentType === undefined || row.documentType === where.documentType)
    && (where.periodKey === undefined || row.periodKey === where.periodKey)
    && (where.branchScopeKey === undefined || row.branchScopeKey === where.branchScopeKey)
    && (where.NOT?.branchScopeKey === undefined || row.branchScopeKey !== where.NOT.branchScopeKey);

  const tx = {
    $executeRaw: async () => undefined,
    $queryRaw: async () => [{ maximum: null }],
    expenseRecord: { findFirst: async () => null },
    documentNumber: {
      findFirst: mock.fn(async () => null),
      create: mock.fn(async ({ data }: any) => { reserved.push(data); return { ...data, id: `num-${reserved.length}`, reservedAt: now }; }),
    },
    documentSequence: {
      findFirst: mock.fn(async ({ where, orderBy }: any) => {
        const hits = rows.filter((row) => match(row, where));
        if (Array.isArray(orderBy) || orderBy?.periodKey) hits.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
        if (orderBy?.nextNumber) hits.sort((a, b) => b.nextNumber - a.nextNumber);
        return hits[0] ?? null;
      }),
      upsert: mock.fn(async ({ create }: any) => {
        const row = { ...create, id: `seq-${rows.length + 1}`, createdAt: now, updatedAt: now };
        // Snapshot, because `update` below mutates the live row the way an increment would.
        created.push({ ...create });
        rows.push(row);
        return row;
      }),
      update: mock.fn(async ({ where, data }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        row.nextNumber += data.nextNumber.increment;
        return row;
      }),
    },
    branch: { findFirst: mock.fn(async () => ({ code: 'BKK' })) },
  };
  const prisma = { client: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } } as any;
  return { repo: new PrismaDocumentSequenceRepository(prisma), created, reserved, rows };
}

const reservation = {
  companyId: 'co-1', documentType: 'tax.invoice', periodKey: '2026-08', reservedByUserId: 'user-1',
};

describe('document number branch collision (audit CR-7)', () => {
  // Interleaved deliberately. Two calls are not enough to prove anything: a second counter seeded
  // from the first still gives a distinct number on its first use, and only collides once the
  // original counter catches up. The third call is where the old behaviour hands out a repeat.
  it('keeps one counter for a template that cannot name the branch', async () => {
    const { repo, reserved, rows } = repoOver([sequenceRow({ nextNumber: 1 })]);

    const issued = [];
    for (const [index, branchId] of [undefined, 'branch-1', undefined, 'branch-1', undefined].entries()) {
      issued.push((await repo.reserveNumber({
        ...reservation, idempotencyKey: `k-${index}`, ...(branchId ? { branchId } : {}),
      })).documentNumber);
    }

    assert.deepEqual(issued, [
      'TAX-202608-00001', 'TAX-202608-00002', 'TAX-202608-00003', 'TAX-202608-00004', 'TAX-202608-00005',
    ]);
    assert.equal(new Set(reserved.map((row) => row.documentNumber)).size, issued.length);
    // One series means one row. A second row is a second counter, which is the finding.
    assert.equal(rows.length, 1, `expected a single counter, found ${rows.map((row) => row.branchScopeKey).join(', ')}`);
  });

  it('still splits the counter per branch once the template names the branch', async () => {
    const branchAware = 'TAX-{BRANCH}-{YYYY}{MM}-{SEQ}';
    const { repo, rows } = repoOver([sequenceRow({ prefixTemplate: branchAware })]);

    const central = await repo.reserveNumber({ ...reservation, idempotencyKey: 'a' });
    const branch = await repo.reserveNumber({ ...reservation, idempotencyKey: 'b', branchId: 'branch-1' });

    assert.equal(central.documentNumber, 'TAX-GLOBAL-202608-00001');
    // Its own counter, and its own number — which is the only reason its own counter is safe.
    assert.equal(branch.documentNumber, 'TAX-BKK-202608-00001');
    assert.deepEqual(rows.map((row) => row.branchScopeKey).sort(), ['GLOBAL', 'branch-1']);
  });

  // The migration case, and the one that would break a live company: today a company whose first
  // document was created with a branch selected is numbering happily under that branch's counter.
  it('carries a live branch counter over instead of restarting the company-wide one at 1', async () => {
    const { repo, created } = repoOver([
      sequenceRow({ id: 'seq-branch', branchId: 'branch-1', branchScopeKey: 'branch-1', nextNumber: 12 }),
    ]);

    const next = await repo.reserveNumber({ ...reservation, idempotencyKey: 'a', branchId: 'branch-1' });

    assert.equal(created[0]?.branchScopeKey, 'GLOBAL');
    assert.equal(created[0]?.nextNumber, 12, 'company-wide counter must resume, not restart');
    assert.equal(next.documentNumber, 'TAX-202608-00012');
  });

  it('keeps a customized template when the counter becomes company-wide', async () => {
    const { repo, created } = repoOver([
      sequenceRow({ id: 'seq-branch', branchId: 'branch-1', branchScopeKey: 'branch-1', prefixTemplate: 'TX-{YYYY}-{SEQ}', nextNumber: 4 }),
    ]);

    await repo.reserveNumber({ ...reservation, idempotencyKey: 'a', branchId: 'branch-1' });

    assert.equal(created[0]?.prefixTemplate, 'TX-{YYYY}-{SEQ}');
  });

  it('refuses to configure a branch sequence whose numbers cannot name the branch', async () => {
    const ctx = { companyId: 'co-1', userId: 'user-1', requestId: 'req-1', permissions: ['document.sequence.manage'] } as any;
    const useCase = new UpsertDocumentSequenceUseCase(
      { upsertConfig: async (input: any) => ({ id: 'seq-1', ...input }) } as any,
      { log: async () => undefined } as any,
    );

    await assert.rejects(
      () => useCase.execute(ctx, { documentType: 'tax.invoice', branchId: 'branch-1', periodKey: '2026-08', prefixTemplate: 'TAX-{YYYY}{MM}-{SEQ}' }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match((error as Error).message, /\{BRANCH\}/);
        return true;
      },
    );

    // The same configuration is fine company-wide, and fine per branch once it names the branch.
    assert.ok(await useCase.execute(ctx, { documentType: 'tax.invoice', periodKey: '2026-08', prefixTemplate: 'TAX-{YYYY}{MM}-{SEQ}' }));
    assert.ok(await useCase.execute(ctx, { documentType: 'tax.invoice', branchId: 'branch-1', periodKey: '2026-08', prefixTemplate: 'TAX-{BRANCH}-{YYYY}{MM}-{SEQ}' }));
  });

  // Every default is what a company gets before anyone configures anything, so every default has to
  // be safe on its own — this is the property whose absence was the finding.
  it('leaves no default template that would split a counter it cannot label', async () => {
    const { repo, reserved } = repoOver([]);

    for (const [index, documentType] of ['accounting.invoice', 'tax.invoice', 'accounting.receipt', 'expense.record'].entries()) {
      const base = { companyId: 'co-1', documentType, periodKey: '2026-08', reservedByUserId: 'u' };
      await repo.reserveNumber({ ...base, idempotencyKey: `x-${index}` });
      await repo.reserveNumber({ ...base, idempotencyKey: `y-${index}`, branchId: 'branch-1' });
      await repo.reserveNumber({ ...base, idempotencyKey: `z-${index}` });
    }

    const numbers = reserved.map((row) => `${row.documentType}:${row.documentNumber}`);
    assert.equal(new Set(numbers).size, numbers.length, `duplicate document numbers: ${numbers.join(', ')}`);
  });
});

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateJournalFromSourceUseCase } from './journal.use-case';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';

// GAP-07: the expense settlement (payment) leg is a real posting source now.
// Each append-only payment is its own source. Generating its expense.payment journal
// posts Dr 2120-01 / Cr 1110-01 without overwriting the accrual status on ExpenseRecord.

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;

function ctx(perms: string[]) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'fin-1', companyId: 'co-1',
    membershipId: 'm', roles: ['FINANCE'], permissions: perms, scopes: {}, authProvider: 'dev',
  } as any;
}

function paidExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1', companyId: 'co-1', branchId: null, status: 'CONFIRMED', expenseNumber: 'EXP-1',
    currency: 'THB', expenseDate: new Date('2026-07-10T00:00:00.000Z'),
    grandTotalAmount: '107.0000', netPayableAmount: '107.0000', paidAmount: '107.0000',
    outstandingAmount: '0.0000', paymentStatus: 'PAID', paidAt: new Date('2026-07-20T00:00:00.000Z'),
    vendorCounterpartyId: null, sourceReimbursementRequestId: null,
    vatAmount: '7.0000', whtAmount: '0.0000', lines: [],
    ...overrides,
  };
}

function generateFakes(expense: Record<string, unknown>) {
  const created: any[] = [];
  const flips: Array<{ id: string; postingStatus: string }> = [];
  const periodKeys: string[] = [];
  const ledgerRepo = {
    findGeneratedJournal: async () => null,
    findPeriod: async (_companyId: string, periodKey: string) => {
      periodKeys.push(periodKey);
      return { id: 'period-1', status: 'OPEN' };
    },
    upsertPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
    findActivePostingRule: async () => null,
    findAccountByCode: async (_c: string, code: string) => ({ id: code, status: 'ACTIVE', isPosting: true, companyId: 'co-1', isSystem: false }),
    createJournalEntry: async (input: any) => {
      const entry = {
        id: 'je-1', companyId: input.companyId, periodId: input.periodId, entryNumber: input.entryNumber,
        entryType: input.entryType, sourceType: input.sourceType, sourceId: input.sourceId,
        reversalOfJournalEntryId: null, status: 'DRAFT', entryDate: input.entryDate, postedAt: null,
        memo: input.memo, createdAt: new Date(),
        lines: input.lines.map((l: any, i: number) => ({
          id: `l${i}`, accountId: l.accountId, branchId: l.branchId ?? null, lineNumber: i + 1,
          description: l.description, debitAmount: String(l.debitAmount ?? '0'), creditAmount: String(l.creditAmount ?? '0'),
          currency: l.currency ?? 'THB', taxCode: l.taxCode ?? null,
        })),
      };
      created.push(entry);
      return entry;
    },
    postJournalEntry: async (id: string) => { const e = created.find((x) => x.id === id); e.status = 'POSTED'; e.postedAt = new Date(); return e; },
  } as any;
  const expenseRepo = {
    findPaymentById: async () => ({
      id: 'payment-1', companyId: 'co-1', expenseId: expense.id, status: 'RECORDED',
      amount: expense.paidAmount, paidAt: expense.paidAt ?? expense.expenseDate, expense,
    }),
    updatePaymentPostingStatus: mock.fn(async (_c: string, id: string, data: any) => { flips.push({ id, postingStatus: data.postingStatus }); }),
  } as any;
  const reserve = { execute: async () => ({ id: 'seq-1', documentNumber: 'JV-1' }) } as any;
  const commit = { execute: async () => undefined } as any;
  const prisma = { client: { company: { findUnique: async () => ({ baseCurrency: 'THB' }) } } } as any;
  const uc = new GenerateJournalFromSourceUseCase(ledgerRepo, noopAudit, reserve, commit, noopOutbox, {} as any, expenseRepo, {} as any, {} as any, prisma);
  return { uc, created, flips, periodKeys, expenseRepo, ledgerRepo };
}

describe('GenerateJournalFromSourceUseCase — expense.payment canonical source', () => {
  it('posts Dr 2120-01 / Cr 1110-01 from the payment event and flips only that payment to posted', async () => {
    const { uc, created, flips } = generateFakes(paidExpense());
    const summary: any = await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);

    assert.equal(summary.sourceType, 'expense.payment');
    const lines = created[0].lines;
    assert.equal(lines.find((l: any) => l.accountId === '2120-01')?.debitAmount, '107.0000');
    assert.equal(lines.find((l: any) => l.accountId === '1110-01')?.creditAmount, '107.0000');
    // pending (pre-generate) then posted (success) — mirrors every other source.
    assert.deepEqual(flips.map((f) => f.postingStatus), ['pending', 'posted']);
    assert.equal(flips.at(-1)?.id, 'payment-1');
  });

  it('uses the settlement (paidAt) date for the posting period, not the expense date', async () => {
    const { uc, created } = generateFakes(paidExpense({
      expenseDate: new Date('2026-06-01T00:00:00.000Z'), paidAt: new Date('2026-07-20T00:00:00.000Z'),
    }));
    await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);
    assert.equal(created[0].entryDate.toISOString(), '2026-07-20T00:00:00.000Z');
  });

  it('posts an early-Bangkok settlement into the next civil day and month', async () => {
    const { uc, created, periodKeys } = generateFakes(paidExpense({
      paidAt: new Date('2026-08-31T19:00:00.000Z'),
    }));
    await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);
    assert.deepEqual(periodKeys, ['2026-09']);
    assert.equal(created[0].entryDate.toISOString(), '2026-09-01T00:00:00.000Z');
  });

  it('uses the migrated payment date when a legacy header had no paid date', async () => {
    const { uc, created } = generateFakes(paidExpense({ paidAt: null, expenseDate: new Date('2026-07-05T00:00:00.000Z') }));
    await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);
    assert.equal(created[0].entryDate.toISOString(), '2026-07-05T00:00:00.000Z');
  });

  it('rejects a claim-born expense (it settles through reimbursement.payment)', async () => {
    const { uc } = generateFakes(paidExpense({ sourceReimbursementRequestId: 'rb-1' }));
    await assert.rejects(
      () => uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any),
      (e: any) => e?.getResponse?.().code === 'claim_expense_settles_via_reimbursement',
    );
  });

  it('rejects a non-CONFIRMED expense', async () => {
    const { uc } = generateFakes(paidExpense({ status: 'READY_FOR_CONFIRMATION' }));
    await assert.rejects(
      () => uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any),
      (e: any) => e?.getResponse?.().code === 'expense_not_confirmed',
    );
  });

  it('posts a partial payment without waiting for the expense to be fully paid', async () => {
    const { uc, created } = generateFakes(paidExpense({ paymentStatus: 'PARTIALLY_PAID', paidAmount: '50.0000' }));
    await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);
    assert.equal(created[0].lines.find((line: any) => line.accountId === '2120-01')?.debitAmount, '50.0000');
  });

  it('returns the existing settlement journal on a repeat generate (idempotent per expense)', async () => {
    const { uc, created } = generateFakes(paidExpense());
    (uc as any).repo.findGeneratedJournal = async () => ({
      id: 'je-existing', companyId: 'co-1', periodId: 'period-1', entryNumber: 'JV-0', entryType: 'GENERATED',
      sourceType: 'expense.payment', sourceId: 'payment-1', reversalOfJournalEntryId: null, status: 'POSTED',
      entryDate: new Date(), postedAt: new Date(), memo: null, createdAt: new Date(), lines: [],
    });
    const summary: any = await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'expense.payment', sourceId: 'payment-1' } as any);
    assert.equal(summary.id, 'je-existing');
    assert.equal(created.length, 0);
  });
});

// ---- countPostingBlockers -------------------------------------------------

type Row = Record<string, any>;

function whereMatch(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ('is' in cond) return whereMatch(row[key] ?? {}, cond.is as Row);
      if ('not' in cond) return row[key] !== cond.not;
      if ('in' in cond) return (cond.in as any[]).includes(row[key]);
      if ('gte' in cond || 'lte' in cond || 'lt' in cond) {
        const v = row[key] as Date;
        if ('gte' in cond && v < cond.gte) return false;
        if ('lte' in cond && v > cond.lte) return false;
        if ('lt' in cond && v >= cond.lt) return false;
        return true;
      }
      return true;
    }
    return row[key] === cond;
  });
}

function blockersClient(expenses: Row[], payments: Row[]) {
  return {
    client: {
      expenseRecord: {
        count: async ({ where }: any) => expenses.filter((r) => whereMatch(r, where)).length,
        findMany: async ({ where }: any) => expenses.filter((r) => whereMatch(r, where)).map((r) => ({ id: r.id })),
      },
      expensePayment: {
        count: async ({ where }: any) => payments.filter((r) => whereMatch(r, where)).length,
      },
    },
  } as any;
}

describe('PrismaExpenseRepository.countPostingBlockers — GAP-07 settlement blockers', () => {
  const CO = 'co-1';
  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-07-31T23:59:59.999Z');
  const D = new Date('2026-07-10T00:00:00.000Z');

  function base(id: string, o: Record<string, unknown>) {
    return { id, companyId: CO, status: 'CONFIRMED', expenseDate: D, paymentStatus: 'UNPAID', sourceReimbursementRequestId: null, postingStatus: 'posted', ...o };
  }

  it('counts a paid plain expense with no settlement journal, without double-counting the pending bucket', async () => {
    const expenses: Row[] = [
      base('e1', { paymentStatus: 'PAID', postingStatus: 'posted' }),          // settlement blocker
      base('e2', { paymentStatus: 'PAID', postingStatus: 'pending' }),         // pending bucket only
      base('e3', { paymentStatus: 'PAID', postingStatus: 'posted' }),          // settled → not a blocker
      base('e4', { paymentStatus: 'PAID', postingStatus: 'posted', sourceReimbursementRequestId: 'rb-1' }), // claim-born → excluded
      base('e5', { postingStatus: 'posting_error' }),                          // error bucket
      base('e6', { postingStatus: 'pending' }),                                // accrual pending
    ];
    const payments: Row[] = [
      { companyId: CO, expenseId: 'e1', status: 'RECORDED', postingStatus: 'pending', paidAt: D, expense: expenses[0] },
      { companyId: CO, expenseId: 'e3', status: 'RECORDED', postingStatus: 'posted', paidAt: D, expense: expenses[2] },
      { companyId: CO, expenseId: 'e4', status: 'RECORDED', postingStatus: 'pending', paidAt: D, expense: expenses[3] },
    ];
    const repo = new PrismaExpenseRepository(blockersClient(expenses, payments));
    const result = await repo.countPostingBlockers(CO, FROM, TO);
    // pending bucket: e2, e6 = 2; settlement blocker: e1 = 1 → 3. errors: e5 = 1.
    assert.deepEqual(result, { pending: 3, errors: 1 });
  });

  it('does not count a claim-born paid expense as a settlement blocker', async () => {
    const expenses: Row[] = [base('c1', { paymentStatus: 'PAID', postingStatus: 'posted', sourceReimbursementRequestId: 'rb-9' })];
    const repo = new PrismaExpenseRepository(blockersClient(expenses, [
      { companyId: CO, expenseId: 'c1', status: 'RECORDED', postingStatus: 'pending', paidAt: D, expense: expenses[0] },
    ]));
    assert.deepEqual(await repo.countPostingBlockers(CO, FROM, TO), { pending: 0, errors: 0 });
  });
});

describe('expense correction and generated journal creation share the mutation boundary', () => {
  for (const [sourceType, expenseStatus, paymentStatus, expectedVersion] of [
    ['expense.record', 'NEEDS_REVIEW', 'RECORDED', undefined],
    ['expense.payment', 'CONFIRMED', 'VOIDED', undefined],
    ['expense.record', 'CONFIRMED', 'RECORDED', new Date('2026-10-03')],
  ] as const) it(`refuses stale ${sourceType}: ${expenseStatus}/${paymentStatus}/${expectedVersion}`, async () => {
    const { PrismaLedgerRepository } = await import('../../infrastructure/prisma-ledger.repository');
    let writes = 0;
    const client: any = {
      $transaction: async (work: any) => work({ ...client }), $executeRaw: async () => 0,
      expenseRecord: { findFirst: async () => ({ status: expenseStatus, confirmedAt: new Date('2026-10-04'), updatedAt: new Date('2026-10-04') }) },
      expensePayment: { findFirst: async () => ({ expenseId: 'exp-1', status: paymentStatus }) },
      journalEntry: { create: async ({ data }: any) => { writes++; return { id: 'j1', ...data, lines: [] }; } },
    };
    const repo = new PrismaLedgerRepository({ client } as any);
    await assert.rejects(() => repo.createJournalEntry({ companyId: 'co-1', periodId: 'p1', entryNumber: 'JV1', entryType: 'GENERATED', sourceType, sourceId: sourceType === 'expense.record' ? 'exp-1' : 'pay-1', expectedExpenseConfirmedAt: expectedVersion, lines: [], entryDate: new Date() } as any), (e: any) => e.getResponse?.().code === 'expense_posting_source_changed');
    assert.equal(writes, 0);
  });
});

// Posting/projection writes updatedAt after canonicalSource; they do not change the confirmation.
describe('expense posting uses confirmation identity rather than row write time', () => {
  for (const [sourceType, status] of [['expense.record', 'CONFIRMED'], ['expense.payment', 'CONFIRMED'], ['expense.record', 'VOIDED']] as const) {
    it(`allows ${sourceType}/${status} after a posting or claim-projection stamp`, async () => {
      const { PrismaLedgerRepository } = await import('../../infrastructure/prisma-ledger.repository');
      const confirmedAt = new Date('2026-10-03T01:00:00Z');
      const readAt = new Date('2026-10-03T02:00:00Z');
      let updatedAt = readAt;
      let writes = 0;
      const client: any = {
        $transaction: async (work: any) => work({ ...client }),
        $executeRaw: async () => { updatedAt = new Date(readAt.getTime() + 1000); return 0; },
        expenseRecord: { findFirst: async () => ({ status, confirmedAt, updatedAt }) },
        expensePayment: { findFirst: async () => ({ expenseId: 'exp-1', status: 'RECORDED' }) },
        journalEntry: { create: async ({ data }: any) => { writes++; return { id: 'j1', ...data, lines: [] }; } },
      };
      await new PrismaLedgerRepository({ client } as any).createJournalEntry({ companyId: 'co-1', periodId: 'p1', entryNumber: 'JV1', entryType: 'GENERATED', sourceType, sourceId: sourceType === 'expense.record' ? 'exp-1' : 'pay-1', expectedExpenseStatus: status, expectedExpenseConfirmedAt: confirmedAt, expectedExpenseUpdatedAt: readAt, lines: [], entryDate: new Date() } as any);
      assert.equal(writes, 1);
      assert.notEqual(updatedAt.getTime(), readAt.getTime());
    });
  }
});


it('canonical payment posting carries the confirmation across its own updatedAt stamp into the real journal writer', async () => {
  const { PrismaLedgerRepository } = await import('../../infrastructure/prisma-ledger.repository');
  const confirmedAt = new Date('2026-10-03T01:00:00Z');
  const readAt = new Date('2026-10-03T02:00:00Z');
  const expense = { ...paidExpense(), confirmedAt, updatedAt: readAt };
  const h = generateFakes(expense);
  h.expenseRepo.updatePaymentPostingStatus = async () => { expense.updatedAt = new Date(readAt.getTime() + 1000); };
  let written = 0;
  const client: any = {
    $transaction: async (work: any) => work({ ...client }), $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => expense },
    expensePayment: { findFirst: async () => ({ expenseId: expense.id, status: 'RECORDED' }) },
    journalEntry: { create: async ({ data }: any) => { written++; return { id: 'real-journal', ...data, lines: [] }; } },
  };
  const fakeCreate = h.ledgerRepo.createJournalEntry;
  h.ledgerRepo.createJournalEntry = async (input: any) => {
    await new PrismaLedgerRepository({ client } as any).createJournalEntry(input);
    return fakeCreate(input);
  };
  await h.uc.execute(ctx(['journal.entry.post']), { sourceType: 'expense.payment', sourceId: 'payment-1' });
  assert.equal(written, 1); assert.notEqual(expense.updatedAt, readAt);
});

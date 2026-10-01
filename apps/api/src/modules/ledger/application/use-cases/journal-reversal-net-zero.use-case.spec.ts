// Pinned before any Date is built. The API container runs UTC, so the local-midnight fault below
// is invisible there — but a developer machine (and this host) is +07, and that is exactly the
// configuration the fix protects. Pinning makes the test discriminate on any host.
process.env.TZ = 'Asia/Bangkok';

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { GenerateJournalFromSourceUseCase, ReverseJournalUseCase } from './journal.use-case';
import { EnsurePeriodUseCase } from './period.use-case';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';

const ctx = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1', membershipId: 'member-1',
  roles: ['ACCOUNTANT'], permissions: ['journal.entry.reverse'], scopes: {}, authProvider: 'watchdog',
} as any;

// In-memory journal store whose balance query mirrors
// PrismaLedgerRepository.getAccountBalances: POSTED entries only.
function ledgerStore() {
  const now = new Date('2026-07-18T00:00:00.000Z');
  let seq = 0;
  const entries: any[] = [];

  const addEntry = (input: any, status: string) => {
    const id = input.id ?? `journal-${++seq}`;
    const entry = {
      id, companyId: input.companyId, periodId: input.periodId ?? 'period-1',
      entryNumber: input.entryNumber ?? `JV-${seq}`, entryType: input.entryType,
      sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
      reversalOfJournalEntryId: input.reversalOfJournalEntryId ?? null,
      status, entryDate: input.entryDate ?? now, postedAt: status === 'POSTED' ? now : null,
      postedByUserId: null, memo: input.memo ?? null, createdByUserId: input.createdByUserId ?? 'user-1',
      createdAt: now, updatedAt: now,
      lines: (input.lines ?? []).map((l: any, idx: number) => ({
        id: `${id}-line-${idx + 1}`, companyId: input.companyId, journalEntryId: id,
        accountId: l.accountId, branchId: l.branchId ?? null, lineNumber: idx + 1,
        description: l.description ?? null, debitAmount: l.debitAmount ?? '0', creditAmount: l.creditAmount ?? '0',
        currency: l.currency ?? 'THB', sourceType: null, sourceId: null, taxCode: l.taxCode ?? null, createdAt: now,
      })),
    };
    entries.push(entry);
    return entry;
  };

  return {
    entries,
    seedPosted: (input: any) => addEntry(input, 'POSTED'),
    seed: addEntry,
    accountBalances() {
      const net = new Map<string, number>();
      for (const entry of entries) {
        if (entry.status !== 'POSTED') continue;
        for (const line of entry.lines) {
          net.set(line.accountId, (net.get(line.accountId) ?? 0) + parseFloat(line.debitAmount) - parseFloat(line.creditAmount));
        }
      }
      return net;
    },
    repo: {
      findJournalById: async (companyId: string, id: string) => entries.find((e) => e.id === id && e.companyId === companyId) ?? null,
      findPeriodById: async () => ({ id: 'period-1', companyId: 'company-1', periodKey: '2026-07', status: 'OPEN' }),
      getJournalLines: async (companyId: string, journalEntryId: string) =>
        entries.find((e) => e.id === journalEntryId && e.companyId === companyId)?.lines ?? [],
      findReversalOfJournal: async (companyId: string, journalEntryId: string) =>
        entries.find((e) => e.companyId === companyId && e.entryType === 'REVERSAL' && e.reversalOfJournalEntryId === journalEntryId) ?? null,
      createJournalEntry: async (input: any) => addEntry(input, 'DRAFT'),
      postJournalEntry: async (id: string) => {
        const entry = entries.find((e) => e.id === id);
        entry.status = 'POSTED';
        entry.postedAt = now;
        return entry;
      },
      // Implemented so a regression that reinstates the status flip corrupts
      // the balances (and fails the net-zero assertion) instead of crashing.
      markJournalReversed: async (id: string) => {
        const entry = entries.find((e) => e.id === id);
        if (entry) entry.status = 'REVERSED';
      },
    } as any,
  };
}

const audit = { log: async () => undefined } as any;
const reservation = async () => ({ id: 'reservation-1', documentNumber: 'JV-R-1' });
const reserve = { execute: reservation, executeInTransaction: reservation } as any;
const commit = { execute: async () => undefined, executeInTransaction: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

describe('ReverseJournalUseCase net-zero regression', () => {
  it('nets every account to zero under POSTED-only report queries and keeps the original POSTED', async () => {
    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-original', companyId: 'company-1', entryType: 'GENERATED',
      sourceType: 'accounting.document', sourceId: 'doc-1',
      lines: [
        { accountId: 'cash', debitAmount: '250.00' },
        { accountId: 'revenue', creditAmount: '250.00' },
      ],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    const summary = await useCase.execute(ctx, original.id, 'void test');

    const balances = store.accountBalances();
    for (const [accountId, net] of balances) {
      assert.equal(net, 0, `account ${accountId} must net to zero after reversal, got ${net}`);
    }
    assert.equal(balances.size, 2);

    assert.equal(original.status, 'POSTED', 'original must stay POSTED so reports net it against the reversal');
    const reversal = store.entries.find((e) => e.id === summary.id);
    assert.equal(reversal.entryType, 'REVERSAL');
    assert.equal(reversal.status, 'POSTED');
    assert.equal(reversal.reversalOfJournalEntryId, original.id);
  });

  it('rejects a second reversal of the same journal without creating another entry', async () => {
    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-original', companyId: 'company-1', entryType: 'MANUAL',
      lines: [
        { accountId: 'cash', debitAmount: '100.00' },
        { accountId: 'revenue', creditAmount: '100.00' },
      ],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    await useCase.execute(ctx, original.id);
    assert.equal(store.entries.length, 2);

    await assert.rejects(() => useCase.execute(ctx, original.id), BadRequestException);
    assert.equal(store.entries.length, 2, 'a rejected re-reversal must not create another entry');
    for (const [accountId, net] of store.accountBalances()) {
      assert.equal(net, 0, `account ${accountId} must still net to zero, got ${net}`);
    }
  });
});

// §5.3 — a reversal used to stamp `entryDate: new Date()` into JournalEntry.entryDate, a
// @db.Date column. Postgres truncates a timestamp to a date in UTC, so a reversal posted
// between 00:00 and 07:00 Bangkok was dated YESTERDAY. Simulated rather than waited for:
// node:test mock timers move the clock to 02:00 Bangkok, which is 19:00 the previous day in UTC.
describe('ReverseJournalUseCase entry date', () => {
  it('dates a 02:00 Bangkok reversal today, as a pure date', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-05T19:00:00.000Z') });

    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-tz', companyId: 'company-1', entryType: 'GENERATED',
      lines: [{ accountId: 'cash', debitAmount: '10.00' }, { accountId: 'revenue', creditAmount: '10.00' }],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    const summary = await useCase.execute(ctx, original.id, 'tz test');
    const reversal = store.entries.find((e) => e.id === summary.id);

    // The old code produced 2026-08-05T19:00:00.000Z: previous day, and carrying a time.
    assert.equal(
      reversal.entryDate.toISOString(),
      '2026-08-06T00:00:00.000Z',
      'a reversal at 02:00 Bangkok belongs to that day, at midnight, not to the UTC day before',
    );
  });
});

// §5.4 — AccountingPeriod.startDate/endDate are @db.Date, and the bounds were built with
// `new Date(y, m - 1, 1)`, which is LOCAL midnight. On the UTC container that happens to equal
// UTC midnight, which is why this fault is invisible in production and needs the pinned TZ above.
describe('EnsurePeriodUseCase bounds', () => {
  it('builds period bounds at UTC midnight even when the host is not UTC', async () => {
    // Guard the premise: if this host were UTC the test could not tell the two apart.
    assert.notEqual(
      new Date(2026, 4, 1).toISOString(),
      '2026-05-01T00:00:00.000Z',
      'TZ pin failed — local and UTC midnight coincide, so this test proves nothing',
    );

    let captured: { start?: Date; end?: Date } = {};
    const repo = {
      upsertPeriod: async (companyId: string, periodKey: string, start: Date, end: Date) => {
        captured = { start, end };
        return { id: 'period-1', companyId, periodKey, startDate: start, endDate: end, status: 'OPEN', closedAt: null, closedByUserId: null };
      },
    } as any;

    await new EnsurePeriodUseCase(repo).execute(
      { ...ctx, permissions: ['ledger.period.read'] } as any,
      '2026-05',
    );

    // Old code on a +07 host: 2026-04-30T17:00:00.000Z — the period starts in the wrong month.
    assert.equal(captured.start?.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(captured.end?.toISOString(), '2026-05-31T00:00:00.000Z');
  });

  it('rejects a malformed or out-of-range month instead of rolling it into another period', async () => {
    const repo = { upsertPeriod: mock.fn(async () => ({})) } as any;
    const useCase = new EnsurePeriodUseCase(repo);

    for (const invalid of ['2026-00', '2026-13', '2026-1', 'not-a-period']) {
      await assert.rejects(
        () => useCase.execute({ ...ctx, permissions: ['ledger.period.read'] } as any, invalid),
        BadRequestException,
      );
    }
    assert.equal(repo.upsertPeriod.mock.callCount(), 0);
  });
});

// Owner instruction 2026-10-01 ("ตรวจดูความ consistency ของข้อมูลด้วย"): one claim payout is stored
// three times — on the claim, on its expense records and in the ledger — and all three must say the
// same number. The REAL repository arithmetic and the REAL posting engine run here; only the
// database underneath is an in-memory fake, with balances read the way the reports read them
// (POSTED entries only). Accounts are the legacy defaults the engine already carries
// (5310-01 / 2130-01 / 1110-01); nothing here chooses a mapping.
describe('claim payout: the claim, its expense records and the ledger agree', () => {
  const AT = new Date('2026-02-01T00:00:00.000Z');
  const postCtx = { ...ctx, permissions: ['journal.entry.post'] } as any;

  function matches(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, want]: [string, any]) => {
      if (want instanceof Date) return row[key]?.getTime() === want.getTime();
      if (want && typeof want === 'object' && Array.isArray(want.in)) return want.in.includes(row[key]);
      return row[key] === want;
    });
  }

  function fixture() {
    const store = ledgerStore();
    const request: any = {
      id: 'rb-1', companyId: 'company-1', branchId: 'br-1', requestNo: 'RB-202602-0001',
      requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย', reason: 'พบลูกค้า', categoryKey: 'travel',
      amount: '500.5000', currency: 'THB', incurredDate: AT, status: 'READY_FOR_PAYMENT',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus: 'UNPAID', paymentTotalAmount: '0.0000',
      outstandingAmount: '500.5000', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'WAIVED_BY_POLICY',
      postingStatus: 'pending', createdByUserId: 'staff-1', createdAt: AT, updatedAt: AT,
    };
    const lines = [['line-1', '289.0000'], ['line-2', '211.5000']].map(([id, amount], index) => ({
      id, companyId: 'company-1', reimbursementRequestId: 'rb-1', lineNo: index + 1, incurredDate: AT,
      description: `รายการ ${index + 1}`, categoryKey: 'travel', amount, createdAt: AT, updatedAt: AT,
    }));
    // One confirmed expense record per claim line, as approval materializes them.
    const projections: any[] = lines.map((line, index) => ({
      id: `exp-${index + 1}`, companyId: 'company-1', branchId: 'br-1', status: 'CONFIRMED',
      expenseNumber: `EXP-202602-0000${index + 1}`, expenseDate: AT, currency: 'THB', vendorCounterpartyId: null,
      sourceReimbursementRequestId: 'rb-1', sourceReimbursementLineId: line.id,
      grandTotalAmount: line.amount, netPayableAmount: line.amount, vatAmount: '0.0000', whtAmount: '0.0000',
      paidAmount: '0.0000', outstandingAmount: line.amount, paymentStatus: 'UNPAID', paymentMethod: null, paidAt: null,
      duplicateStatus: 'NO_MATCH', postingStatus: 'pending', inputVatClaimStatus: 'NON_CLAIMABLE',
      taxEvidenceStatus: 'SUPPORTING_ONLY', lines: [],
    }));
    const payments: any[] = [];
    const requestWith = (include: any = {}) => ({
      ...request,
      ...(include.lines ? { lines } : {}),
      ...(include.payments ? { payments: [...payments] } : {}),
      ...(include.approvalSteps ? { approvalSteps: [] } : {}),
      ...(include.duplicateCandidates ? { duplicateCandidates: [] } : {}),
      ...(include.claimSignatures ? { claimSignatures: [] } : {}),
    });
    const findPayment = ({ where, include }: any) => {
      const row = payments.find((payment) => matches(payment, where));
      return row ? { ...row, ...(include?.request ? { request: requestWith(include.request.include) } : {}) } : null;
    };
    const db: any = {
      $executeRaw: async () => 0,
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(db),
      reimbursementPolicy: { findFirst: async () => null },
      reimbursementDuplicateCandidate: { count: async () => 0 },
      accountingPeriod: { findFirst: async () => ({ id: 'period-1', periodKey: '2026-02', status: 'OPEN' }) },
      reimbursementRequest: {
        findFirst: async ({ where, include }: any) => (matches(request, where) ? requestWith(include) : null),
        findFirstOrThrow: async ({ where, include }: any) => {
          assert.ok(matches(request, where));
          return requestWith(include);
        },
        updateMany: async ({ where, data }: any) => {
          if (!matches(request, where)) return { count: 0 };
          Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
          return { count: 1 };
        },
        update: async ({ data }: any) => Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) }),
      },
      reimbursementPayment: {
        findFirst: async (args: any) => findPayment(args),
        findFirstOrThrow: async (args: any) => findPayment(args) ?? assert.fail('payment not found'),
        create: async ({ data }: any) => {
          const row = { id: `pay-${payments.length + 1}`, status: 'RECORDED', createdAt: AT, updatedAt: AT, ...data };
          payments.push(row);
          return row;
        },
        update: async ({ where, data }: any) => Object.assign(payments.find((payment) => matches(payment, where)), data),
        updateMany: async ({ where, data }: any) => {
          const rows = payments.filter((payment) => matches(payment, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      // The void first makes sure no bank statement line is confirmed against the payment.
      bankReconciliationMatch: { findMany: async () => [] },
      expenseRecord: {
        findMany: async ({ where }: any) => projections.filter((projection) => matches(projection, where)),
        update: async ({ where, data }: any) => Object.assign(projections.find((projection) => matches(projection, where)), data),
      },
      journalEntry: {
        findFirst: async ({ where }: any) => store.entries.find((entry) => matches(entry, where)) ?? null,
        create: async ({ data }: any) => {
          const { lines: journalLines, status, ...entry } = data;
          return store.seed({
            ...entry,
            lines: journalLines.create.map((line: any) => ({ ...line, debitAmount: String(line.debitAmount), creditAmount: String(line.creditAmount) })),
          }, status);
        },
      },
    };
    const numbers = {
      reserveNumberInTransaction: async () => ({ id: 'reservation-void', documentNumber: `JV-VOID-${store.entries.length + 1}` }),
      commitNumberInTransaction: async () => undefined,
    };
    const claims = new PrismaReimbursementRepository({ client: db } as any, numbers as any);
    const expenseRepo = {
      findByIdWithRelations: async (_companyId: string, id: string) => projections.find((projection) => projection.id === id) ?? null,
      updatePostingStatus: async (_companyId: string, id: string, data: any) => {
        Object.assign(projections.find((projection) => projection.id === id), { postingStatus: data.postingStatus });
      },
    };
    const hooks: { beforeClaim?: () => Promise<unknown> } = {};
    const ledgerRepo = {
      ...store.repo,
      findGeneratedJournal: async (companyId: string, sourceType: string, sourceId: string) =>
        store.entries.find((entry) => entry.companyId === companyId && entry.entryType === 'GENERATED'
          && entry.sourceType === sourceType && entry.sourceId === sourceId) ?? null,
      findPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
      findActivePostingRule: async () => null,
      // Resolving the accounts is the generator's last read before it claims the payment row, so
      // a hook here is "something else committed after the payment was read as RECORDED".
      findAccountByCode: async (_companyId: string, code: string) => {
        const hook = hooks.beforeClaim;
        hooks.beforeClaim = undefined;
        await hook?.();
        return { id: code, status: 'ACTIVE', isPosting: true, companyId: 'company-1', isSystem: false };
      },
    };
    // The generator settles a payout inside a transaction of this same store.
    db.company = { findUnique: async () => ({ baseCurrency: 'THB' }) };
    const generate = new GenerateJournalFromSourceUseCase(
      ledgerRepo as any, audit, reserve, commit, outbox, {} as any, expenseRepo as any, {} as any, claims, { client: db } as any,
    );

    const sum = (values: Array<string | number>) => values.reduce<Decimal>((total, value) => total.add(value), new Decimal(0)).toFixed(4);
    /** Debit minus credit of one account over POSTED entries — what a trial balance prints. */
    const net = (accountId: string, entries = store.entries) => sum(entries.filter((entry) => entry.status === 'POSTED')
      .flatMap((entry) => entry.lines.filter((line: any) => line.accountId === accountId)
        .map((line: any) => new Decimal(line.debitAmount).sub(line.creditAmount).toFixed(4))));
    const journalsOf = (sourceType: string, sourceId: string) => store.entries.filter((entry) => entry.sourceType === sourceType && entry.sourceId === sourceId);
    const pay = (idempotencyKey: string) => claims.recordPaymentAtomic({
      companyId: 'company-1', reimbursementRequestId: 'rb-1', idempotencyKey, paymentNo: `RBPAY-${idempotencyKey}`,
      paidAmount: '500.50', currency: 'THB', paymentMethod: 'CASH', paidAt: AT, paidByUserId: 'finance-1',
    });
    const post = (sourceType: string, sourceId: string) => generate.execute(postCtx, { sourceType, sourceId } as any);
    return { store, request, lines, projections, payments, claims, hooks, sum, net, journalsOf, pay, post };
  }

  async function accrued() {
    const f = fixture();
    for (const projection of f.projections) await f.post('expense.record', projection.id);
    return f;
  }

  it('after posting: claim paid total = payment = settlement debit = settlement credit = expense records paid', async () => {
    const f = await accrued();
    // Approval put the money owed on the books: one accrual per expense record, all on 2130-01.
    assert.equal(f.net('2130-01'), '-500.5000');
    assert.equal(f.sum(f.projections.map((projection) => projection.grandTotalAmount)), f.request.amount);

    const { payment } = await f.pay('k-1');
    assert.equal(payment.postingStatus, 'pending', 'recording a payout posts nothing by itself');
    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 0);

    const summary = await f.post('reimbursement.payment', payment.id);
    const [settlement] = f.journalsOf('reimbursement.payment', payment.id);
    assert.equal(settlement.status, 'POSTED');
    assert.equal(settlement.entryType, 'GENERATED');
    const debit = f.sum(settlement.lines.map((line: any) => line.debitAmount));
    const credit = f.sum(settlement.lines.map((line: any) => line.creditAmount));

    // The one number, read from every place that stores it.
    assert.equal(f.request.paymentTotalAmount, '500.5000');
    assert.equal(new Decimal(payment.paidAmount).toFixed(4), '500.5000');
    assert.equal(debit, '500.5000');
    assert.equal(credit, '500.5000');
    assert.equal(new Decimal(summary.totalDebit).toFixed(4), '500.5000');
    assert.equal(f.sum(f.projections.map((projection) => projection.paidAmount)), '500.5000');

    // Which accounts: employee payable cleared, cash out, the expense untouched by the payout.
    assert.deepEqual(settlement.lines.map((line: any) => [line.accountId, line.debitAmount, line.creditAmount]), [
      ['2130-01', '500.5000', '0'],
      ['1110-01', '0', '500.5000'],
    ]);
    assert.deepEqual([...new Set(settlement.lines.map((line: any) => line.branchId))], ['br-1']);
    assert.equal(f.net('2130-01'), '0.0000', 'nothing is owed to the employee any more');
    assert.equal(f.net('1110-01'), '-500.5000');
    assert.equal(f.net('5310-01'), '500.5000');

    // And the states agree with the numbers.
    assert.equal(f.request.status, 'PAID');
    assert.equal(f.request.outstandingAmount, '0.0000');
    assert.equal(f.payments[0].postingStatus, 'posted');
    for (const projection of f.projections) {
      assert.equal(projection.paymentStatus, 'PAID');
      assert.equal(projection.outstandingAmount, '0.0000');
      assert.equal(projection.paidAmount, projection.netPayableAmount);
    }
  });

  it('posting twice (the worker and an accountant at once) leaves one settlement, not two', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    const first = await f.post('reimbursement.payment', payment.id);
    const second = await f.post('reimbursement.payment', payment.id);
    assert.equal(second.id, first.id);
    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 1);
    assert.equal(f.net('2130-01'), '0.0000');
  });

  it('a payout waits for every accrual: nothing is posted and the payment stays pending', async () => {
    const f = fixture();
    await f.post('expense.record', 'exp-1');
    const { payment } = await f.pay('k-1');
    await assert.rejects(() => f.post('reimbursement.payment', payment.id), /reimbursement_accrual_not_posted/);
    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 0);
    assert.equal(f.payments[0].postingStatus, 'pending');
  });

  it('after void: the settlement and its reversal net to zero and everything reads unpaid again', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    await f.post('reimbursement.payment', payment.id);

    const result = await f.claims.voidPaymentTrueReversal('company-1', 'rb-1', payment.id, 'finance-1', 'โอนผิดบัญชี');

    const journals = f.journalsOf('reimbursement.payment', payment.id);
    assert.deepEqual(journals.map((entry) => [entry.entryType, entry.status]), [['GENERATED', 'POSTED'], ['REVERSAL', 'POSTED']]);
    assert.equal(journals[1].id, result.reversalEntryId);
    assert.equal(journals[1].reversalOfJournalEntryId, journals[0].id);
    // Net zero, per account, over exactly the payout's own two journals.
    for (const accountId of ['2130-01', '1110-01']) {
      assert.equal(f.net(accountId, journals), '0.0000', `${accountId} must net to zero across the settlement and its reversal`);
    }
    // The books are back where approval left them: the employee is owed the claim again.
    assert.equal(f.net('1110-01'), '0.0000');
    assert.equal(f.net('2130-01'), '-500.5000');
    assert.equal(f.net('5310-01'), '500.5000');

    assert.equal(f.payments[0].status, 'VOIDED');
    assert.equal(f.payments[0].postingStatus, 'reversed');
    assert.equal(f.request.status, 'READY_FOR_PAYMENT');
    assert.equal(f.request.paymentStatus, 'UNPAID');
    assert.equal(f.request.paymentTotalAmount, '0.0000');
    assert.equal(f.request.outstandingAmount, '500.5000');
    assert.equal(f.sum(f.projections.map((projection) => projection.paidAmount)), '0.0000');
    for (const projection of f.projections) {
      assert.equal(projection.paymentStatus, 'UNPAID');
      assert.equal(projection.outstandingAmount, projection.netPayableAmount);
    }
    // A voided payout can never be posted again — by hand or by the worker.
    await assert.rejects(() => f.post('reimbursement.payment', payment.id), (error: any) => error.getResponse?.().code === 'reimbursement_payment_not_recorded');
    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 2);
  });

  it('voiding a payout that was never posted touches no ledger entry', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    const before = f.store.entries.length;

    const result = await f.claims.voidPaymentTrueReversal('company-1', 'rb-1', payment.id, 'finance-1', 'บันทึกผิด');

    assert.equal(result.reversalEntryId, null);
    assert.equal(f.store.entries.length, before);
    assert.equal(f.payments[0].postingStatus, 'not_required');
    assert.equal(f.net('2130-01'), '-500.5000');
    assert.equal(f.request.paymentTotalAmount, '0.0000');
  });

  // Review finding 2026-10-01: the generator read the payment as RECORDED and posted many queries
  // later with no lock, so a void committing in between left a POSTED settlement on a VOIDED payment
  // with no reversal, and paying again posted a second one. Each order of events, with this store
  // standing in for the database (the row locking itself is proved in the PostgreSQL spec).
  it('void first, after the generator read the payment as RECORDED: the post is refused and writes nothing', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    f.hooks.beforeClaim = () => f.claims.voidPaymentTrueReversal('company-1', 'rb-1', payment.id, 'finance-1', 'โอนผิดบัญชี');

    await assert.rejects(() => f.post('reimbursement.payment', payment.id), (error: any) => error.getResponse?.().code === 'reimbursement_payment_not_recorded');

    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 0, 'no settlement exists, posted or draft');
    assert.deepEqual([f.payments[0].status, f.payments[0].postingStatus], ['VOIDED', 'not_required']);
    assert.equal(f.net('2130-01'), '-500.5000');
    assert.equal(f.net('1110-01'), '0.0000');
    assert.equal(f.request.status, 'READY_FOR_PAYMENT');
    // Paying again posts ONE settlement, where the bug posted a second.
    const again = (await f.pay('k-2')).payment;
    await f.post('reimbursement.payment', again.id);
    assert.deepEqual(f.store.entries.filter((entry) => entry.sourceType === 'reimbursement.payment').map((entry) => [entry.sourceId, entry.entryType, entry.status]), [[again.id, 'GENERATED', 'POSTED']]);
    assert.equal(f.net('2130-01'), '0.0000');
    assert.equal(f.net('1110-01'), '-500.5000');
  });

  it('post first: the void finds the posted settlement and reverses it', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    await f.post('reimbursement.payment', payment.id);
    // The claim stamped the payment in the same step as the journal: never POSTED with a stale flag.
    assert.equal(f.payments[0].postingStatus, 'posted');

    await f.claims.voidPaymentTrueReversal('company-1', 'rb-1', payment.id, 'finance-1', 'โอนผิดบัญชี');

    assert.deepEqual(f.journalsOf('reimbursement.payment', payment.id).map((entry) => [entry.entryType, entry.status]), [['GENERATED', 'POSTED'], ['REVERSAL', 'POSTED']]);
    assert.deepEqual([f.payments[0].status, f.payments[0].postingStatus], ['VOIDED', 'reversed']);
    assert.equal(f.net('1110-01'), '0.0000');
  });

  it('another poster first, after the early idempotency check: the second returns that journal and writes nothing', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    let first: any;
    f.hooks.beforeClaim = async () => { first = await f.post('reimbursement.payment', payment.id); };

    const second = await f.post('reimbursement.payment', payment.id);

    assert.equal(second.id, first.id);
    assert.equal(f.journalsOf('reimbursement.payment', payment.id).length, 1);
    assert.equal(f.payments[0].postingStatus, 'posted');
    assert.equal(f.net('2130-01'), '0.0000');
  });

  it('a late posting stamp never lands on a voided payment', async () => {
    const f = await accrued();
    const { payment } = await f.pay('k-1');
    await f.claims.voidPaymentTrueReversal('company-1', 'rb-1', payment.id, 'finance-1', 'บันทึกผิด');
    // The generator and the worker stamp through this one method. It writes RECORDED payments only
    // and says whether it wrote, so a void's `not_required` cannot become an uncleared error.
    for (const postingStatus of ['pending', 'posted', 'posting_error'] as const) {
      assert.equal(await f.claims.updatePaymentPostingStatus('company-1', payment.id, { postingStatus }), false);
    }
    assert.equal(f.payments[0].postingStatus, 'not_required');
    // A recorded payment is stamped, and the caller is told so.
    const again = (await f.pay('k-2')).payment;
    assert.equal(await f.claims.updatePaymentPostingStatus('company-1', again.id, { postingStatus: 'posting_error' }), true);
    assert.equal(f.payments[1].postingStatus, 'posting_error');
    assert.equal(await f.claims.updatePaymentPostingStatus('other-company', again.id, { postingStatus: 'posted' }), false);
  });

  it('pay, void, pay again: one live payment and one net settlement', async () => {
    const f = await accrued();
    const first = (await f.pay('k-1')).payment;
    await f.post('reimbursement.payment', first.id);
    await f.claims.voidPaymentTrueReversal('company-1', 'rb-1', first.id, 'finance-1', 'โอนผิดบัญชี');

    const second = (await f.pay('k-2')).payment;
    assert.notEqual(second.id, first.id);
    await f.post('reimbursement.payment', second.id);

    const live = f.payments.filter((payment) => payment.status === 'RECORDED');
    assert.equal(live.length, 1);
    assert.equal(f.request.paymentTotalAmount, f.sum(live.map((payment) => payment.paidAmount)));
    assert.equal(f.request.status, 'PAID');
    assert.equal(f.sum(f.projections.map((projection) => projection.paidAmount)), '500.5000');
    // Three payout journals exist (settle, reverse, settle); their net is ONE payout.
    assert.equal(f.store.entries.filter((entry) => entry.sourceType === 'reimbursement.payment').length, 3);
    assert.equal(f.net('2130-01'), '0.0000');
    assert.equal(f.net('1110-01'), '-500.5000');
  });
});

/**
 * Real PostgreSQL proof that a claim payout reaches the ledger and that the claim, its expense
 * records and the books then say the same number. Opt-in; every row is test-owned.
 *
 *   CLAIM_PAYMENT_POSTING_PG_TEST=1 DATABASE_URL=postgresql://…@127.0.0.1:<port>/<throwaway db> \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts
 *
 * The drain reads every ACTIVE company, so point it at a throwaway database only. The repositories,
 * the candidate SQL, the journal generator, the posting engine and the numbering are all real; only
 * the audit/outbox side channels are stubbed, and the confirm saga is shortcut by a fixture update.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Decimal } from 'decimal.js';
import { PrismaClient } from '../../../../generated/prisma/client';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { PrismaDocumentSequenceRepository } from '../../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { MaterializeClaimExpensesService } from '../../../reimbursements/application/services/materialize-claim-expenses.service';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { DrainExpenseAutoPostUseCase, expenseAutoPostCandidateSql } from './expense-auto-post.use-case';
import { GenerateJournalFromSourceUseCase } from './journal.use-case';

const url = process.env.DATABASE_URL;
const enabled = process.env.CLAIM_PAYMENT_POSTING_PG_TEST === '1';

describe('claim payout posting (PostgreSQL)', { skip: !enabled }, () => {
  assert.ok(url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Use a local isolated DB');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const prisma = { client } as any;
  const allocator = new PrismaDocumentSequenceRepository(prisma);
  const claims = new PrismaReimbursementRepository(prisma, allocator);
  const expenses = new PrismaExpenseRepository(prisma, allocator);
  const ledger = new PrismaLedgerRepository(prisma);
  const silent = { log: async () => undefined, append: async () => undefined } as any;
  const generate = new GenerateJournalFromSourceUseCase(
    ledger, silent, new ReserveDocumentNumberUseCase(allocator, silent), new CommitDocumentNumberUseCase(allocator, silent),
    silent, {} as any, expenses, {} as any, claims, prisma,
  );
  const drain = new DrainExpenseAutoPostUseCase(prisma, generate, expenses, claims);
  const companyIds: string[] = [];
  const userIds: string[] = [];
  const incurred = new Date('2026-09-15T00:00:00.000Z');

  after(async () => {
    for (const companyId of companyIds) {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.journalEntry.deleteMany({ where: { companyId, entryType: 'REVERSAL' } });
      await client.company.delete({ where: { id: companyId } });
    }
    if (userIds.length) await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  });

  type Shop = { companyId: string; branchId: string; userId: string; activationAt: Date };

  /** A shop with auto-posting ON. `governed` = on the standard chart template; `reimbursement: null` = no row. */
  async function shop(opts: { governed?: boolean; reimbursement?: boolean | null } = {}): Promise<Shop> {
    const company = await client.company.create({ data: {
      name: `claim-posting-${randomUUID()}`, status: 'ACTIVE',
      ...(opts.governed ? {
        chartOfAccountsTemplateKey: 'TH_SME_COA_V1', chartOfAccountsTemplateVersion: 1,
        chartOfAccountsTemplateChecksum: 'pg-spec', chartOfAccountsTemplateAppliedAt: new Date(),
      } : {}),
    } });
    companyIds.push(company.id);
    const user = await client.user.create({ data: { displayName: 'ผู้ทดสอบลงบัญชี' } });
    userIds.push(user.id);
    // A claim is only accepted from an active member who may work in the branch.
    await client.companyMembership.create({ data: { companyId: company.id, userId: user.id, status: 'ACTIVE' } });
    const branch = await client.branch.create({ data: { companyId: company.id, code: 'HO', name: 'สำนักงานใหญ่' } });
    const activationAt = new Date(Date.now() - 60_000);
    await client.companyFeatureEntitlement.createMany({ data: [
      ...['expense_auto_post', 'expenses', 'double_entry_ledger'].map((featureKey) => ({ companyId: company.id, featureKey, enabled: true, updatedAt: activationAt })),
      ...(opts.reimbursement === null ? [] : [{ companyId: company.id, featureKey: 'reimbursement', enabled: opts.reimbursement ?? true, updatedAt: activationAt }]),
    ] });
    // The accounts the engine's existing legacy mapping names; a governed shop gets its own two.
    for (const [code, nameTh, accountClass, normalBalance] of opts.governed
      ? [['5320-01', 'ค่าใช้จ่ายเดินทาง', 'EXPENSE', 'DEBIT'], ['2131-09', 'ค่าใช้จ่ายค้างจ่าย-อื่น ๆ', 'LIABILITY', 'CREDIT']] as const
      : [['5310-01', 'ค่าใช้จ่าย', 'EXPENSE', 'DEBIT'], ['2130-01', 'เจ้าหนี้พนักงาน', 'LIABILITY', 'CREDIT'], ['1110-01', 'เงินสด', 'ASSET', 'DEBIT']] as const) {
      await client.chartOfAccount.create({ data: { companyId: company.id, code, nameTh, accountClass, normalBalance } });
    }
    return { companyId: company.id, branchId: branch.id, userId: user.id, activationAt };
  }

  /** Takes a shop out of every later drain, so each test's drain counts are its own. */
  const retire = (s: Shop) => client.company.update({ where: { id: s.companyId }, data: { status: 'ARCHIVED' } });

  /** An approved claim whose lines each have a CONFIRMED expense record, ready to be paid. */
  async function claim(s: Shop, amounts: string[]) {
    const total = amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0)).toFixed(2);
    let request = await claims.createRequest({
      companyId: s.companyId, branchId: s.branchId, requesterUserId: s.userId, createdByUserId: s.userId,
      requesterDisplayNameSnapshot: 'สมชาย', reason: 'พบลูกค้า', currency: 'THB', categoryKey: 'travel', amount: total,
      incurredDate: incurred, receiptRequirementStatus: 'WAIVED_BY_POLICY', missingReceiptReason: 'ไม่มีใบเสร็จ',
      lines: amounts.map((amount, index) => ({ lineNo: index + 1, incurredDate: incurred, description: `รายการ ${index + 1}`, categoryKey: 'travel', amount })),
    });
    await client.reimbursementRequest.update({ where: { id: request.id }, data: {
      status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: s.userId,
    } });
    request = (await claims.findRequestById(s.companyId, request.id))!;
    const projections = await claims.prepareClaimProjections({
      companyId: s.companyId, requestId: request.id, decisionKind: 'FINANCE', decisionActorUserId: s.userId,
      scopes: {}, items: new MaterializeClaimExpensesService().buildItems(request),
    });
    // Fixture shortcut for the confirm saga, which is not under test here.
    await client.expenseRecord.updateMany({
      where: { companyId: s.companyId, sourceReimbursementRequestId: request.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), postingStatus: 'pending', duplicateStatus: 'NO_MATCH' },
    });
    await client.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'READY_FOR_PAYMENT' } });
    return { requestId: request.id, total, expenseIds: projections.map((projection) => projection.expenseId) };
  }

  const pay = async (s: Shop, c: { requestId: string; total: string }, paidAt = new Date()) => (await claims.recordPaymentAtomic({
    companyId: s.companyId, reimbursementRequestId: c.requestId, idempotencyKey: randomUUID(), paymentNo: `RBPAY-${randomUUID().slice(0, 8)}`,
    paidAmount: c.total, currency: 'THB', paymentMethod: 'CASH', paidAt, paidByUserId: s.userId,
  })).payment;

  const accountant = (s: Shop) => ({
    requestId: randomUUID(), authSubject: 'pg-spec', userId: s.userId, companyId: s.companyId, membershipId: 'pg-spec',
    roles: [], permissions: ['journal.entry.create', 'journal.entry.post'], scopes: {}, authProvider: 'session',
  }) as any;
  const post = (s: Shop, sourceType: string, sourceId: string) => generate.execute(accountant(s), { sourceType, sourceId } as any);

  /** Net (debit − credit) per account code, from the query the trial balance uses: POSTED entries only. */
  async function books(s: Shop): Promise<Record<string, string>> {
    const periods = await client.accountingPeriod.findMany({ where: { companyId: s.companyId }, select: { id: true } });
    const balances = await ledger.getAccountBalances(s.companyId, periods.map((period) => period.id));
    const accounts = await client.chartOfAccount.findMany({ where: { id: { in: balances.map((balance) => balance.accountId) } }, select: { id: true, code: true } });
    const codeOf = new Map(accounts.map((account) => [account.id, account.code]));
    const net: Record<string, Decimal> = {};
    for (const balance of balances) {
      const code = codeOf.get(balance.accountId)!;
      net[code] = (net[code] ?? new Decimal(0)).add(balance.totalDebit).sub(balance.totalCredit);
    }
    return Object.fromEntries(Object.entries(net).map(([code, value]) => [code, value.toFixed(2)]));
  }

  const money = (value: { toString(): string }) => new Decimal(value.toString()).toFixed(2);
  const claimRow = (c: { requestId: string }) => client.reimbursementRequest.findUniqueOrThrow({ where: { id: c.requestId } });
  const paymentRow = (id: string) => client.reimbursementPayment.findUniqueOrThrow({ where: { id } });
  const expenseRows = (s: Shop, c: { requestId: string }) => client.expenseRecord.findMany({ where: { companyId: s.companyId, sourceReimbursementRequestId: c.requestId }, orderBy: { createdAt: 'asc' } });
  const payoutJournals = (s: Shop, paymentId: string) => client.journalEntry.findMany({
    where: { companyId: s.companyId, sourceType: 'reimbursement.payment', sourceId: paymentId }, include: { lines: true }, orderBy: { createdAt: 'asc' },
  });
  const candidates = async (s: Shop, activationAt = s.activationAt, includeClaimPayments = true) =>
    (await client.$queryRaw<Array<{ sourceType: string; sourceId: string }>>(expenseAutoPostCandidateSql(s.companyId, activationAt, 100, includeClaimPayments)))
      .filter((row) => row.sourceType === 'reimbursement.payment').map((row) => row.sourceId);

  it('the worker posts accruals, then the payout; claim, expense records and books agree; a void nets to zero; a second payout settles once', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['289.00', '211.50']);

      // Pass 1: the two accruals. Nothing has been paid yet.
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 2, posted: 2, failed: 0 });
      assert.deepEqual(await books(s), { '5310-01': '500.50', '2130-01': '-500.50' });

      const first = await pay(s, c);
      assert.equal(first.postingStatus, 'pending');
      assert.deepEqual(await candidates(s), [first.id]);

      // Pass 2: the payout, and only the payout.
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
      const [settlement] = await payoutJournals(s, first.id);
      assert.equal(settlement!.entryType, 'GENERATED');
      assert.equal(settlement!.status, 'POSTED');
      const debit = settlement!.lines.reduce((sum, line) => sum.add(line.debitAmount.toString()), new Decimal(0)).toFixed(2);
      const credit = settlement!.lines.reduce((sum, line) => sum.add(line.creditAmount.toString()), new Decimal(0)).toFixed(2);
      let paidClaim = await claimRow(c);
      let records = await expenseRows(s, c);
      // The one number, read from every table that stores it.
      assert.equal(money(paidClaim.paymentTotalAmount), '500.50');
      assert.equal(money((await paymentRow(first.id)).paidAmount), '500.50');
      assert.equal(debit, '500.50');
      assert.equal(credit, '500.50');
      assert.equal(records.reduce((sum, record) => sum.add(record.paidAmount.toString()), new Decimal(0)).toFixed(2), '500.50');
      assert.deepEqual(records.map((record) => [record.paymentStatus, money(record.outstandingAmount), record.postingStatus]), [['PAID', '0.00', 'posted'], ['PAID', '0.00', 'posted']]);
      assert.equal(paidClaim.status, 'PAID');
      assert.equal(money(paidClaim.outstandingAmount), '0.00');
      assert.equal((await paymentRow(first.id)).postingStatus, 'posted');
      assert.deepEqual([...new Set(settlement!.lines.map((line) => line.branchId))], [s.branchId]);
      // Nothing is owed to the employee; the cash is out; the expense is what approval booked.
      assert.deepEqual(await books(s), { '5310-01': '500.50', '2130-01': '0.00', '1110-01': '-500.50' });
      // Neither path has anything left to do.
      assert.deepEqual(await claims.listUnpostedReimbursementPayments(s.companyId), []);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 0, posted: 0, failed: 0 });
      assert.equal((await payoutJournals(s, first.id)).length, 1);

      // Void: reversed in the void's own transaction, so there is nothing for the worker to post.
      const voided = await claims.voidPaymentTrueReversal(s.companyId, c.requestId, first.id, s.userId, 'โอนผิดบัญชี');
      const journals = await payoutJournals(s, first.id);
      assert.deepEqual(journals.map((entry) => [entry.entryType, entry.status]), [['GENERATED', 'POSTED'], ['REVERSAL', 'POSTED']]);
      assert.equal(journals[1]!.id, voided.reversalEntryId);
      const byAccount = new Map<string, Decimal>();
      for (const line of journals.flatMap((entry) => entry.lines)) {
        byAccount.set(line.accountId, (byAccount.get(line.accountId) ?? new Decimal(0)).add(line.debitAmount.toString()).sub(line.creditAmount.toString()));
      }
      assert.equal(byAccount.size, 2);
      for (const [accountId, net] of byAccount) assert.equal(net.toFixed(2), '0.00', `account ${accountId} must net to zero across the payout and its reversal`);
      assert.deepEqual(await books(s), { '5310-01': '500.50', '2130-01': '-500.50', '1110-01': '0.00' });
      paidClaim = await claimRow(c);
      records = await expenseRows(s, c);
      assert.deepEqual([paidClaim.status, paidClaim.paymentStatus, money(paidClaim.paymentTotalAmount), money(paidClaim.outstandingAmount)], ['READY_FOR_PAYMENT', 'UNPAID', '0.00', '500.50']);
      assert.deepEqual(records.map((record) => [record.paymentStatus, money(record.paidAmount), money(record.outstandingAmount)]), [['UNPAID', '0.00', '289.00'], ['UNPAID', '0.00', '211.50']]);
      const voidedRow = await paymentRow(first.id);
      assert.deepEqual([voidedRow.status, voidedRow.postingStatus], ['VOIDED', 'reversed']);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 0, posted: 0, failed: 0 });
      assert.equal((await payoutJournals(s, first.id)).length, 2);

      // Pay again: exactly one live payment, and the books carry exactly one payout.
      const second = await pay(s, c);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.equal(await client.reimbursementPayment.count({ where: { companyId: s.companyId, reimbursementRequestId: c.requestId, status: 'RECORDED' } }), 1);
      assert.equal(money((await claimRow(c)).paymentTotalAmount), money((await paymentRow(second.id)).paidAmount));
      assert.deepEqual(await books(s), { '5310-01': '500.50', '2130-01': '0.00', '1110-01': '-500.50' });
    } finally { await retire(s); }
  });

  it('the worker and an accountant posting the same payout at once leave one settlement, and a retry settles the flag', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['120.00']);
      await drain.execute();
      const payment = await pay(s, c);
      const [byHand, byWorker] = await Promise.allSettled([post(s, 'reimbursement.payment', payment.id), drain.execute()]);
      assert.ok(byHand.status === 'fulfilled' || byWorker.status === 'fulfilled');
      // The database allows one generated journal per source, whoever wins.
      const journals = await payoutJournals(s, payment.id);
      assert.equal(journals.length, 1);
      assert.equal(journals[0]!.status, 'POSTED');
      assert.deepEqual(await books(s), { '5310-01': '120.00', '2130-01': '0.00', '1110-01': '-120.00' });
      // The loser of the race may have left the status flag behind (as it can for an expense
      // source); posting again finds the existing journal, creates nothing and corrects the flag.
      const again = await post(s, 'reimbursement.payment', payment.id);
      assert.equal(again.id, journals[0]!.id);
      assert.equal((await payoutJournals(s, payment.id)).length, 1);
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posted');
      assert.deepEqual(await books(s), { '5310-01': '120.00', '2130-01': '0.00', '1110-01': '-120.00' });
    } finally { await retire(s); }
  });

  it('selects only payouts that are ready, and leaves the others on the accountant\'s worklist untouched', async () => {
    const s = await shop();
    try {
      const ready = await claim(s, ['100.00']);
      const waitingAccrual = await claim(s, ['60.00', '40.00']);
      const suspectedDuplicate = await claim(s, ['70.00']);
      const confirmedDuplicate = await claim(s, ['50.00', '30.00']);
      const voided = await claim(s, ['90.00']);
      const beforeActivation = await claim(s, ['110.00']);
      const alreadyFailed = await claim(s, ['130.00']);
      const alreadyJournaled = await claim(s, ['150.00']);

      // Accruals: every line of the ready claims; ONE of two for the waiting claim.
      for (const c of [ready, voided, beforeActivation, alreadyFailed, alreadyJournaled]) await post(s, 'expense.record', c.expenseIds[0]!);
      await post(s, 'expense.record', waitingAccrual.expenseIds[0]!);
      await post(s, 'expense.record', confirmedDuplicate.expenseIds[0]!);
      // Finance parked these lines as duplicates: suspected keeps the settlement waiting,
      // confirmed needs no accrual at all.
      await client.expenseRecord.update({ where: { id: suspectedDuplicate.expenseIds[0]! }, data: { status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'POSSIBLE_DUPLICATE' } });
      await client.expenseRecord.update({ where: { id: confirmedDuplicate.expenseIds[1]! }, data: { status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'CONFIRMED_DUPLICATE', postingStatus: 'not_required' } });
      // An evidence warning keeps this accrual for the accountant, so the worker never posts it
      // and the payout behind it has to keep waiting.
      await client.expenseRecord.update({ where: { id: waitingAccrual.expenseIds[1]! }, data: { taxEvidenceStatus: 'NEEDS_REVIEW' } });

      const paid = {
        ready: await pay(s, ready), waitingAccrual: await pay(s, waitingAccrual), suspectedDuplicate: await pay(s, suspectedDuplicate),
        confirmedDuplicate: await pay(s, confirmedDuplicate), voided: await pay(s, voided), beforeActivation: await pay(s, beforeActivation),
        alreadyFailed: await pay(s, alreadyFailed), alreadyJournaled: await pay(s, alreadyJournaled),
      };
      await claims.voidPaymentTrueReversal(s.companyId, voided.requestId, paid.voided.id, s.userId, 'บันทึกผิด');
      // Even if a late status write left a voided payout looking unposted, it is never offered again.
      await client.reimbursementPayment.update({ where: { id: paid.voided.id }, data: { postingStatus: 'pending' } });
      await client.reimbursementPayment.update({ where: { id: paid.beforeActivation.id }, data: { createdAt: new Date(s.activationAt.getTime() - 1000) } });
      await client.reimbursementPayment.update({ where: { id: paid.alreadyFailed.id }, data: { postingStatus: 'posting_error' } });
      await post(s, 'reimbursement.payment', paid.alreadyJournaled.id);
      // The status flag lagging behind the journal must not make the worker try again.
      await client.reimbursementPayment.update({ where: { id: paid.alreadyJournaled.id }, data: { postingStatus: 'pending' } });

      assert.deepEqual((await candidates(s)).sort(), [paid.ready.id, paid.confirmedDuplicate.id].sort());
      // Tenant scope: another shop's ready payout is never offered to this one.
      const neighbour = await shop();
      try {
        const theirs = await claim(neighbour, ['10.00']);
        await post(neighbour, 'expense.record', theirs.expenseIds[0]!);
        const theirPayment = await pay(neighbour, theirs);
        assert.deepEqual(await candidates(neighbour), [theirPayment.id]);
        assert.equal((await candidates(s)).includes(theirPayment.id), false);
      } finally { await retire(neighbour); }
      // A frozen reimbursement family, or a boundary set after these payouts, selects none of them.
      assert.deepEqual(await candidates(s, s.activationAt, false), []);
      assert.deepEqual(await candidates(s, new Date(Date.now() + 3_600_000)), []);

      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 2, posted: 2, failed: 0 });
      const after = async (id: string) => (await paymentRow(id)).postingStatus;
      assert.equal(await after(paid.ready.id), 'posted');
      assert.equal(await after(paid.confirmedDuplicate.id), 'posted');
      // Waiting is not failing: these stay pending, with no journal and no error mark.
      assert.equal(await after(paid.waitingAccrual.id), 'pending');
      assert.equal(await after(paid.suspectedDuplicate.id), 'pending');
      assert.equal(await after(paid.beforeActivation.id), 'pending');
      assert.equal((await payoutJournals(s, paid.waitingAccrual.id)).length, 0);
      assert.equal((await payoutJournals(s, paid.beforeActivation.id)).length, 0);

      // The screen's worklist is the other path: everything still unposted, whatever its age,
      // including the failed one — and never the voided one.
      const listed = (await claims.listUnpostedReimbursementPayments(s.companyId)).map((row) => [row.paymentId, row.postingStatus]);
      assert.deepEqual(listed.sort(), [
        [paid.waitingAccrual.id, 'pending'], [paid.suspectedDuplicate.id, 'pending'], [paid.beforeActivation.id, 'pending'],
        [paid.alreadyFailed.id, 'posting_error'], [paid.alreadyJournaled.id, 'pending'],
      ].sort());
      // A payout recorded before auto-posting was switched on posts from the screen, by hand.
      await post(s, 'reimbursement.payment', paid.beforeActivation.id);
      assert.equal(await after(paid.beforeActivation.id), 'posted');
      // An accountant's attempt on a payout whose accrual is missing is refused and changes nothing.
      await assert.rejects(() => post(s, 'reimbursement.payment', paid.waitingAccrual.id), /reimbursement_accrual_not_posted/);
      assert.equal(await after(paid.waitingAccrual.id), 'pending');
    } finally { await retire(s); }
  });

  it('a frozen reimbursement family stops claim payouts while expenses keep posting; a shop without the row inherits it', async () => {
    const frozen = await shop({ reimbursement: false });
    try {
      const c = await claim(frozen, ['45.00']);
      await post(frozen, 'expense.record', c.expenseIds[0]!);
      const payment = await pay(frozen, c);
      const other = await claim(frozen, ['25.00']);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.equal((await paymentRow(payment.id)).postingStatus, 'pending');
      assert.equal((await expenseRows(frozen, other))[0]!.postingStatus, 'posted');
    } finally { await retire(frozen); }

    const inherited = await shop({ reimbursement: null });
    try {
      const c = await claim(inherited, ['45.00']);
      await post(inherited, 'expense.record', c.expenseIds[0]!);
      const payment = await pay(inherited, c);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posted');
    } finally { await retire(inherited); }
  });

  /** Runs `before` once, in the gap between the worker reading its candidates and generating. */
  async function drainWith(before: () => Promise<void>, after: () => Promise<void> = async () => undefined) {
    const execute = generate.execute.bind(generate);
    let used = false;
    generate.execute = async (...args: Parameters<typeof execute>) => {
      if (used) return execute(...args);
      used = true;
      await before();
      const summary = await execute(...args);
      await after();
      return summary;
    };
    try { return await drain.execute(); } finally { generate.execute = execute; }
  }

  it('a void that commits after the candidates were read keeps its own status: the worker stamps nothing', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['60.00']);
      await post(s, 'expense.record', c.expenseIds[0]!);
      const payment = await pay(s, c);

      const result = await drainWith(async () => { await claims.voidPaymentTrueReversal(s.companyId, c.requestId, payment.id, s.userId, 'โอนผิดบัญชี'); });

      // The candidate vanished under the worker: neither posted nor failed.
      assert.deepEqual(result, { companies: 1, candidates: 1, posted: 0, failed: 0 });
      const row = await paymentRow(payment.id);
      assert.deepEqual([row.status, row.postingStatus], ['VOIDED', 'not_required']);
      assert.equal((await payoutJournals(s, payment.id)).length, 0);
      // The readiness check counts posting errors with no status filter of its own.
      assert.equal(await client.reimbursementPayment.count({ where: { companyId: s.companyId, postingStatus: 'posting_error' } }), 0);
      assert.deepEqual(await claims.listUnpostedReimbursementPayments(s.companyId), []);
    } finally { await retire(s); }
  });

  it('a failure after the settlement was posted is stamped posted, never an error', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['85.00']);
      await post(s, 'expense.record', c.expenseIds[0]!);
      const payment = await pay(s, c);

      const result = await drainWith(async () => undefined, async () => { throw new Error('the bookkeeping after the post failed'); });

      assert.deepEqual(result, { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posted');
      assert.deepEqual((await payoutJournals(s, payment.id)).map((entry) => [entry.entryType, entry.status]), [['GENERATED', 'POSTED']]);
      assert.deepEqual(await claims.listUnpostedReimbursementPayments(s.companyId), []);
    } finally { await retire(s); }
  });

  it('a payout dated in a closed period is refused, marked for the accountant, and posts once the period is open again', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['75.00']);
      await post(s, 'expense.record', c.expenseIds[0]!);
      const closed = await client.accountingPeriod.create({ data: { companyId: s.companyId, periodKey: '2026-08', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31'), status: 'CLOSED' } });
      const payment = await pay(s, c, new Date('2026-08-20T03:00:00.000Z'));

      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 0, failed: 1 });
      // The generator refuses before it touches the payment, so this mark is the worker's own.
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posting_error');
      assert.equal((await payoutJournals(s, payment.id)).length, 0);
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 0, posted: 0, failed: 0 });
      await assert.rejects(() => post(s, 'reimbursement.payment', payment.id), (error: any) => error.getResponse?.().code === 'period_closed');

      await client.accountingPeriod.update({ where: { id: closed.id }, data: { status: 'OPEN' } });
      const journal = await post(s, 'reimbursement.payment', payment.id);
      assert.equal(journal.periodId, closed.id, 'the payout belongs to the month the money left');
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posted');
      assert.deepEqual(await books(s), { '5310-01': '75.00', '2130-01': '0.00', '1110-01': '-75.00' });
    } finally { await retire(s); }
  });

  it('a shop on the standard chart fails closed: no reviewed settlement mapping, so no journal, and the payout waits on the worklist', async () => {
    const s = await shop({ governed: true });
    try {
      const c = await claim(s, ['300.00']);
      // The accrual is a fixture here: what is under test is the settlement of an accrued claim.
      const period = await client.accountingPeriod.create({ data: { companyId: s.companyId, periodKey: '2026-09', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), status: 'OPEN' } });
      const [expense, payable] = await Promise.all(['5320-01', '2131-09'].map((code) => client.chartOfAccount.findFirstOrThrow({ where: { companyId: s.companyId, code } })));
      await client.journalEntry.create({ data: {
        companyId: s.companyId, periodId: period.id, entryNumber: 'JV-ACCRUAL-FIXTURE', entryType: 'GENERATED', sourceType: 'expense.record',
        sourceId: c.expenseIds[0]!, status: 'POSTED', entryDate: incurred, postedAt: new Date(), postedByUserId: s.userId, createdByUserId: s.userId,
        lines: { create: [
          { branchId: s.branchId, accountId: expense!.id, lineNumber: 1, debitAmount: '300', creditAmount: '0' },
          { branchId: s.branchId, accountId: payable!.id, lineNumber: 2, debitAmount: '0', creditAmount: '300' },
        ] },
      } });
      await client.expenseRecord.update({ where: { id: c.expenseIds[0]! }, data: { postingStatus: 'posted' } });
      const payment = await pay(s, c);
      assert.deepEqual(await candidates(s), [payment.id]);

      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 0, failed: 1 });

      assert.equal((await payoutJournals(s, payment.id)).length, 0, 'no legacy account is ever guessed for a governed shop');
      assert.equal((await paymentRow(payment.id)).postingStatus, 'posting_error');
      assert.deepEqual(await books(s), { '5320-01': '300.00', '2131-09': '-300.00' });
      // Cash really left: the claim is paid and says so, whatever the ledger could not record.
      assert.equal((await claimRow(c)).status, 'PAID');
      // It is on the worklist for a retry, counted by the period close, and not retried every minute.
      assert.deepEqual((await claims.listUnpostedReimbursementPayments(s.companyId)).map((row) => [row.paymentId, row.postingStatus]), [[payment.id, 'posting_error']]);
      const blockers = await claims.countReimbursementPostingBlockers(s.companyId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
      assert.deepEqual(blockers, { unconfirmedClaimExpenses: 0, pendingPayments: 0, paymentErrors: 1 });
      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 0, posted: 0, failed: 0 });
      // The accountant's retry is refused with the stable, actionable code, and nothing is written.
      await assert.rejects(() => post(s, 'reimbursement.payment', payment.id), (error: any) => error.getResponse?.().code === 'posting_rule_missing');
      assert.equal((await payoutJournals(s, payment.id)).length, 0);
    } finally { await retire(s); }
  });
});

/**
 * Real PostgreSQL proof that a claim payout reaches the ledger, that the claim, its expense records
 * and the books then say the same number, and that a post and a void of one payout take turns.
 * A release gate: it is the only place the candidate SQL and the row locking actually run.
 *
 *   CLAIM_PAYMENT_POSTING_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_claim_posting_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts
 *
 * It needs a database OF ITS OWN (migrated, otherwise empty): the auto-post drain reads every
 * ACTIVE company, so in a shared database it would also drain companies other specs left behind,
 * and their rows would change the counts asserted here. Every row it writes is test-owned.
 * The repositories, the candidate SQL, the journal generator, the posting engine and the numbering
 * are all real; only the audit/outbox side channels are stubbed, and the confirm saga is shortcut
 * by a fixture update.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { civilPeriodKey, coerceCivilDate } from '@watchdog-bms/contracts';
import { Decimal } from 'decimal.js';
import { PrismaClient } from '../../../../generated/prisma/client';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { PrismaDocumentSequenceRepository } from '../../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { MaterializeClaimExpensesService } from '../../../reimbursements/application/services/materialize-claim-expenses.service';
import { RecordReimbursementPaymentUseCase } from '../../../reimbursements/application/use-cases/reimbursement-finance.use-case';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { DrainExpenseAutoPostUseCase, expenseAutoPostCandidateSql } from './expense-auto-post.use-case';
import { GenerateJournalFromSourceUseCase } from './journal.use-case';

const databaseUrl = process.env.CLAIM_PAYMENT_POSTING_TEST_DATABASE_URL;

describe('claim payout posting (PostgreSQL)', { skip: !databaseUrl }, () => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database of its own');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const prisma = { client } as any;
  const allocator = new PrismaDocumentSequenceRepository(prisma);
  const claims = new PrismaReimbursementRepository(prisma, allocator);
  const expenses = new PrismaExpenseRepository(prisma, allocator);
  const ledger = new PrismaLedgerRepository(prisma);
  const silent = { log: async () => undefined, append: async () => undefined } as any;
  const reserveNumber = new ReserveDocumentNumberUseCase(allocator, silent);
  const commitNumber = new CommitDocumentNumberUseCase(allocator, silent);
  const generate = new GenerateJournalFromSourceUseCase(
    ledger, silent, reserveNumber, commitNumber,
    silent, {} as any, expenses, {} as any, claims, prisma,
  );
  const drain = new DrainExpenseAutoPostUseCase(prisma, generate, expenses, claims);
  // The payer's own entry point, for the one rule that lives there: the date a payout may carry.
  // File names are the only thing its answer reads from outside the database.
  const recordPayment = new RecordReimbursementPaymentUseCase(
    claims, silent, silent, reserveNumber, commitNumber,
    { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any,
  );
  const companyIds: string[] = [];
  const userIds: string[] = [];
  const incurred = new Date('2026-09-15T00:00:00.000Z');

  after(async () => {
    for (const companyId of companyIds) {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.outboxEvent.deleteMany({ where: { companyId } });
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

  // ---- Post versus void (review finding 1) ------------------------------------------------------
  // The generator reads the payment as RECORDED and writes its journal many queries later. The fix
  // writes the settlement under a claim on the payment row; these cases hold one side still at a
  // chosen point and prove the other side WAITS for that row and then sees the committed result.

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  /** Swaps one method for a wrapper until `restore()`; `this` and arguments pass through. */
  function intercept(target: any, method: string, wrap: (original: (...args: any[]) => Promise<any>) => (...args: any[]) => Promise<any>) {
    const original = target[method].bind(target);
    target[method] = wrap(original);
    return () => { target[method] = original; };
  }

  /** Resolves once some backend is blocked on a row lock for a statement on the payment table. */
  async function untilPaymentRowIsAwaited(): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const [row] = await client.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%"ReimbursementPayment"%'`;
      if (Number(row!.waiting) > 0) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.fail('nothing waited for the payment row: the two writers did not take turns');
  }

  const settle = <T>(work: Promise<T>) => work.then((value) => ({ value, error: undefined as any }), (error) => ({ value: undefined as T | undefined, error }));
  const errorCode = (error: any) => { const response = error?.getResponse?.(); return typeof response === 'string' ? response : response?.code ?? response?.message; };

  /** The state the bug produced, and every other inconsistent one, for a payout after any race. */
  async function assertPayoutConsistent(s: Shop, paymentId: string) {
    const row = await paymentRow(paymentId);
    const journals = await payoutJournals(s, paymentId);
    const shape = journals.map((entry) => `${entry.entryType}:${entry.status}`).join(',');
    if (row.status === 'VOIDED') {
      assert.ok(
        (shape === '' && row.postingStatus === 'not_required') || (shape === 'GENERATED:POSTED,REVERSAL:POSTED' && row.postingStatus === 'reversed'),
        `a voided payout must have no settlement or a reversed one, got [${shape}] ${row.postingStatus}`,
      );
    } else {
      assert.ok(
        (shape === 'GENERATED:POSTED' && row.postingStatus === 'posted') || (shape === '' && ['pending', 'posting_error'].includes(row.postingStatus)),
        `a recorded payout must be posted with one settlement or not posted at all, got [${shape}] ${row.postingStatus}`,
      );
    }
    const net = new Map<string, Decimal>();
    for (const line of journals.flatMap((entry) => entry.lines)) net.set(line.accountId, (net.get(line.accountId) ?? new Decimal(0)).add(line.debitAmount.toString()).sub(line.creditAmount.toString()));
    if (row.status === 'VOIDED') for (const [accountId, value] of net) assert.equal(value.toFixed(2), '0.00', `account ${accountId} must net to zero for a voided payout`);
    return { status: row.status, postingStatus: row.postingStatus, shape };
  }

  /** Every journal number this shop has reserved or committed: a refused post must add none. */
  const journalNumbers = async (s: Shop) => (await client.documentNumber.findMany({
    where: { companyId: s.companyId, documentType: 'ledger.journal' }, select: { documentNumber: true, status: true }, orderBy: { documentNumber: 'asc' },
  })).map((row) => `${row.documentNumber}:${row.status}`);

  async function payable(s: Shop, amount: string) {
    const c = await claim(s, [amount]);
    await post(s, 'expense.record', c.expenseIds[0]!);
    return { c, payment: await pay(s, c) };
  }
  const voidPayout = (s: Shop, c: { requestId: string }, paymentId: string) => claims.voidPaymentTrueReversal(s.companyId, c.requestId, paymentId, s.userId, 'โอนผิดบัญชี');

  it('void commits after the generator read the payment as RECORDED: the post is refused and nothing is written', async () => {
    const s = await shop();
    try {
      const { c, payment } = await payable(s, '140.00');
      const numbersBefore = await journalNumbers(s);
      // Resolving the accounts is the generator's last read before it claims the payment.
      let voided = false;
      const restore = intercept(ledger, 'findAccountByCode', (original) => async (...args) => {
        if (!voided) { voided = true; await voidPayout(s, c, payment.id); }
        return original(...args);
      });
      const outcome = await settle(post(s, 'reimbursement.payment', payment.id)).finally(restore);

      assert.equal(voided, true);
      assert.equal(errorCode(outcome.error), 'reimbursement_payment_not_recorded');
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'VOIDED', postingStatus: 'not_required', shape: '' });
      // Nothing at all was written: no journal (not even a draft) and no journal number.
      assert.equal(await client.journalEntry.count({ where: { companyId: s.companyId, sourceType: 'reimbursement.payment' } }), 0);
      assert.deepEqual(await journalNumbers(s), numbersBefore);
      assert.deepEqual(await books(s), { '5310-01': '140.00', '2130-01': '-140.00' });
      // Paying again posts ONE settlement, where the bug posted a second.
      const again = await pay(s, c);
      await post(s, 'reimbursement.payment', again.id);
      assert.equal(await client.journalEntry.count({ where: { companyId: s.companyId, sourceType: 'reimbursement.payment' } }), 1);
      assert.deepEqual(await books(s), { '5310-01': '140.00', '2130-01': '0.00', '1110-01': '-140.00' });
    } finally { await retire(s); }
  });

  it('void in flight, holding the payment row: the claim waits for it, then finds the payment voided and writes nothing', async () => {
    const s = await shop();
    try {
      const { c, payment } = await payable(s, '150.00');
      const numbersBefore = await journalNumbers(s);
      const atClaim = deferred(), goClaim = deferred(), rowWritten = deferred(), goVoid = deferred();
      // The generator is held just before its claim; the void is held just after its own row update.
      let heldOnce = false;
      const restoreRead = intercept(ledger, 'findAccountByCode', (original) => async (...args) => {
        if (!heldOnce) { heldOnce = true; atClaim.resolve(); await goClaim.promise; }
        return original(...args);
      });
      const restoreVoid = intercept(claims, 'reversePaymentJournalInTx', (original) => async (...args) => { rowWritten.resolve(); await goVoid.promise; return original(...args); });
      let posting, voiding;
      try {
        posting = settle(post(s, 'reimbursement.payment', payment.id));
        await atClaim.promise;
        voiding = settle(voidPayout(s, c, payment.id));
        await rowWritten.promise;
        goClaim.resolve();
        await untilPaymentRowIsAwaited();
      } finally { goClaim.resolve(); goVoid.resolve(); restoreRead(); restoreVoid(); }

      assert.equal((await voiding!).error, undefined);
      assert.equal(errorCode((await posting!).error), 'reimbursement_payment_not_recorded');
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'VOIDED', postingStatus: 'not_required', shape: '' });
      assert.deepEqual(await journalNumbers(s), numbersBefore);
      assert.deepEqual(await books(s), { '5310-01': '150.00', '2130-01': '-150.00' });
    } finally { await retire(s); }
  });

  it('settlement in flight, holding the payment row: the void waits for it, then reverses the posted journal', async (t) => {
    const s = await shop();
    try {
      const { c, payment } = await payable(s, '160.00');
      const claimed = deferred(), goPost = deferred();
      // Posting is the last statement of the settlement transaction: the row is claimed and the
      // journal created, and nothing is committed yet.
      let held = false;
      const restore = intercept(ledger, 'postJournalEntry', (original) => async (...args) => {
        if (!held) { held = true; claimed.resolve(); await goPost.promise; }
        return original(...args);
      });
      let posting, voiding;
      try {
        posting = settle(post(s, 'reimbursement.payment', payment.id));
        await claimed.promise;
        assert.equal((await payoutJournals(s, payment.id)).length, 0, 'an uncommitted settlement is invisible to everyone else');
        voiding = settle(voidPayout(s, c, payment.id));
        await untilPaymentRowIsAwaited();
      } finally { goPost.resolve(); restore(); }

      assert.equal((await posting!).error, undefined);
      // The void either re-ran on its own after the conflict, or refused with "it changed, retry".
      const first = await voiding!;
      t.diagnostic(first.error ? 'the void refused with "it changed" and was retried by the caller' : 'the void re-ran by itself after the write conflict');
      if (first.error) {
        assert.equal(errorCode(first.error), 'reimbursement_payment_state_changed');
        assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'posted', shape: 'GENERATED:POSTED' });
        await voidPayout(s, c, payment.id);
      }
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'VOIDED', postingStatus: 'reversed', shape: 'GENERATED:POSTED,REVERSAL:POSTED' });
      assert.deepEqual(await books(s), { '5310-01': '160.00', '2130-01': '-160.00', '1110-01': '0.00' });
    } finally { await retire(s); }
  });

  it('post and void fired together, many times: never a posted settlement on a voided payment', async (t) => {
    const s = await shop();
    try {
      const seen = new Set<string>();
      for (let round = 0; round < 16; round += 1) {
        const { c, payment } = await payable(s, '10.00');
        // Even rounds start the void at the generator's last read, so both arrive at the payment
        // row together whatever the machine's speed; odd rounds simply start both at once.
        let voidStarted: ReturnType<typeof settle> | undefined;
        const startVoid = () => (voidStarted ??= settle(voidPayout(s, c, payment.id)));
        const restore = round % 2 === 0
          ? intercept(ledger, 'findAccountByCode', (original) => async (...args) => { void startVoid(); return original(...args); })
          : () => undefined;
        if (round % 2 === 1) void startVoid();
        const posting = await settle(post(s, 'reimbursement.payment', payment.id)).finally(restore);
        const voiding = await startVoid();
        for (const outcome of [voiding, posting]) {
          if (outcome.error) assert.ok(['reimbursement_payment_not_recorded', 'reimbursement_payment_state_changed'].includes(errorCode(outcome.error)), `unexpected refusal: ${errorCode(outcome.error) ?? outcome.error}`);
        }
        const state = await assertPayoutConsistent(s, payment.id);
        seen.add(`${state.status}/${state.postingStatus}`);
        // Leave the claim paid-and-posted or unpaid; either way the next round starts clean.
        if (state.status === 'RECORDED') await voidPayout(s, c, payment.id);
        await assertPayoutConsistent(s, payment.id);
      }
      t.diagnostic(`end states seen over 16 races: ${[...seen].sort().join(', ')}`);
    } finally { await retire(s); }
  });

  it('a settlement that fails midway leaves nothing behind: its number, journal and stamp go back together, and a retry posts once', async () => {
    const s = await shop();
    try {
      const { payment } = await payable(s, '95.00');
      const numbersBefore = await journalNumbers(s);
      // The journal is created, then posting it fails. By then the payment is stamped and the number taken.
      const restore = intercept(ledger, 'postJournalEntry', () => async () => { throw new Error('connection lost'); });
      try {
        await assert.rejects(() => post(s, 'reimbursement.payment', payment.id), /connection lost/);
      } finally { restore(); }
      assert.deepEqual(await journalNumbers(s), numbersBefore, 'no journal number is left reserved for a settlement that was not written');
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'pending', shape: '' });

      await post(s, 'reimbursement.payment', payment.id);
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'posted', shape: 'GENERATED:POSTED' });
      const numbersAfter = await journalNumbers(s);
      assert.equal(numbersAfter.length, numbersBefore.length + 1);
      assert.ok(numbersAfter.every((number) => number.endsWith(':COMMITTED')), 'the one new number belongs to the one settlement');
    } finally { await retire(s); }
  });

  it('two posters at once take turns on the payment row: one settlement, both answered with it, the flag already right', async () => {
    const s = await shop();
    try {
      const { payment } = await payable(s, '170.00');
      // The month's period already exists, as it does after any earlier posting: creating it is a
      // separate first-use step that these three would otherwise race for, payment or not.
      const periodKey = civilPeriodKey(coerceCivilDate(payment.paidAt));
      const [year, month] = periodKey.split('-').map(Number) as [number, number];
      await ledger.upsertPeriod(s.companyId, periodKey, new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 0)));
      const [byHand, byWorker, again] = await Promise.all([
        settle(post(s, 'reimbursement.payment', payment.id)), settle(drain.execute()), settle(post(s, 'reimbursement.payment', payment.id)),
      ]);
      // Nobody collides: each caller is answered with the one journal.
      assert.equal(byHand.error, undefined);
      assert.equal(again.error, undefined);
      assert.equal(byHand.value!.id, again.value!.id);
      assert.equal(byWorker.error, undefined);
      assert.equal(byWorker.value!.failed, 0);
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'posted', shape: 'GENERATED:POSTED' });
      assert.deepEqual(await books(s), { '5310-01': '170.00', '2130-01': '0.00', '1110-01': '-170.00' });
      // One journal number, committed with the journal.
      assert.equal((await journalNumbers(s)).filter((number) => number.endsWith(':COMMITTED')).length, 2);
      assert.equal((await journalNumbers(s)).length, 2);
    } finally { await retire(s); }
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

  it('the worker fails while an accountant\'s settlement is still in flight: the payout ends posted, never an error', async () => {
    const s = await shop();
    try {
      const { payment } = await payable(s, '180.00');
      const claimed = deferred(), goPost = deferred();
      let held = false;
      const restorePost = intercept(ledger, 'postJournalEntry', (original) => async (...args) => {
        if (!held) { held = true; claimed.resolve(); await goPost.promise; }
        return original(...args);
      });
      // The worker's own attempt fails for a reason of its own; the accountant's runs normally.
      const restoreGenerate = intercept(generate, 'execute', (original) => async (ctx, ...rest) => {
        if (ctx.authSubject === 'expense-auto-post-worker') throw new Error('the worker attempt failed');
        return original(ctx, ...rest);
      });
      let accounting, draining;
      try {
        accounting = settle(post(s, 'reimbursement.payment', payment.id));
        await claimed.promise;
        // The settlement is uncommitted, so the worker still sees a pending payout with no journal.
        draining = settle(drain.execute());
        await untilPaymentRowIsAwaited();
      } finally { goPost.resolve(); restorePost(); }
      const drained = await draining!.finally(restoreGenerate);

      assert.equal((await accounting!).error, undefined);
      assert.equal(drained.error, undefined);
      // The worker's stamp waited for the payment row, then read the journal table: posted.
      assert.deepEqual(drained.value, { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'posted', shape: 'GENERATED:POSTED' });
      assert.equal(await client.reimbursementPayment.count({ where: { companyId: s.companyId, postingStatus: 'posting_error' } }), 0);
    } finally { await retire(s); }
  });

  // Review finding 5. Recording is where a payout gets its date, so that is where a closed month is
  // refused: the real use case, repository, numbering and tables.
  it('recording refuses a payment dated in a closed month and writes nothing; once the month is reopened the same payment records and posts into it', async () => {
    const s = await shop();
    try {
      const c = await claim(s, ['75.00']);
      await post(s, 'expense.record', c.expenseIds[0]!);
      const august = await client.accountingPeriod.create({ data: { companyId: s.companyId, periodKey: '2026-08', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31'), status: 'CLOSED' } });
      const payer = { ...accountant(s), permissions: ['reimbursement.payment.record'] };
      const record = (paidAt: string): Promise<any> => recordPayment.execute(payer, c.requestId, { paidAmount: c.total, paymentMethod: 'CASH', paidAt } as any);
      const locked = (error: any) => error.getStatus?.() === 409 && error.message === 'reimbursement_payment_accounting_period_locked:2026-08';

      // The first and the last instant of August in Thai time.
      await assert.rejects(() => record('2026-07-31T17:00:00.000Z'), locked);
      await assert.rejects(() => record('2026-08-31T16:59:59.999Z'), locked);
      await client.accountingPeriod.update({ where: { id: august.id }, data: { status: 'CLOSING_REVIEW' } });
      await assert.rejects(() => record('2026-08-20T03:00:00.000Z'), locked);

      // Nothing was written: no payment, no payment number, no notice to the requester.
      assert.equal(await client.reimbursementPayment.count({ where: { companyId: s.companyId } }), 0);
      assert.equal(await client.documentNumber.count({ where: { companyId: s.companyId, documentType: 'reimbursement.payment' } }), 0);
      assert.equal(await client.outboxEvent.count({ where: { companyId: s.companyId, eventType: 'reimbursement.payment_recorded' } }), 0);
      assert.equal((await claimRow(c)).status, 'READY_FOR_PAYMENT');
      // Only August refuses: the instant before it and the instant after it are other, unopened months.
      await claims.assertPaymentPeriodOpen(s.companyId, new Date('2026-07-31T16:59:59.999Z'));
      await claims.assertPaymentPeriodOpen(s.companyId, new Date('2026-08-31T17:00:00.000Z'));

      await client.accountingPeriod.update({ where: { id: august.id }, data: { status: 'REOPENED' } });
      const detail = await record('2026-08-20T03:00:00.000Z');
      assert.equal(detail.status, 'PAID');
      const payment = await client.reimbursementPayment.findFirstOrThrow({ where: { companyId: s.companyId } });
      assert.deepEqual([payment.status, payment.postingStatus, payment.paidAt.toISOString()], ['RECORDED', 'pending', '2026-08-20T03:00:00.000Z']);
      assert.equal(await client.outboxEvent.count({ where: { companyId: s.companyId, eventType: 'reimbursement.payment_recorded' } }), 1);

      assert.deepEqual(await drain.execute(), { companies: 1, candidates: 1, posted: 1, failed: 0 });
      assert.equal((await payoutJournals(s, payment.id))[0]!.periodId, august.id, 'the payout belongs to the month the money left');
      assert.deepEqual(await assertPayoutConsistent(s, payment.id), { status: 'RECORDED', postingStatus: 'posted', shape: 'GENERATED:POSTED' });
      assert.deepEqual(await books(s), { '5310-01': '75.00', '2130-01': '0.00', '1110-01': '-75.00' });
    } finally { await retire(s); }
  });

  // Such a row can still exist: one recorded before recording refused the date (the repository is
  // called directly here, as that older code path did).
  it('a payout already sitting in a closed period is refused, marked for the accountant, and posts once the period is open again', async () => {
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

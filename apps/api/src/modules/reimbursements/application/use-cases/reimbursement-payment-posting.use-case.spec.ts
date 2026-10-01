import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RecordReimbursementPaymentUseCase } from './reimbursement-finance.use-case';
import { GenerateJournalFromSourceUseCase } from '../../../ledger/application/use-cases/journal.use-case';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };


// GAP-02 Phase 3: the settlement leg is a real posting source. Record leaves the
// payment 'pending'; generate posts Dr 2130-01 / Cr 1110-01 and flips 'posted'.

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;

function ctx(perms: string[]) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'fin-1', companyId: 'co-1',
    membershipId: 'm', roles: ['FINANCE'], permissions: perms, scopes: {}, authProvider: 'dev',
  } as any;
}

describe('RecordReimbursementPaymentUseCase — postingStatus lifecycle', () => {
  it('leaves the recorded payment in postingStatus pending (it is now a posting source)', async () => {
    const req: any = {
      id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requestNo: 'RB-1', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
      amount: '500.0000', currency: 'THB', categoryKey: 'travel', reason: 'Taxi', status: 'READY_FOR_PAYMENT',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus: 'UNPAID', paymentTotalAmount: '0.0000',
      outstandingAmount: '500.0000', duplicateStatus: 'NO_MATCH', incurredDate: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const payments: any[] = [];
    const repo = {
      findRequestById: async (_c: string, _id: string, withRel?: boolean) => (withRel ? { ...req, approvalSteps: [], payments, duplicateCandidates: [] } : req),
      findPolicy: async () => null,
      getUserDisplayNames: async () => ({}),
      listSignedClaimFormCopies: async () => [],
      listPaymentSlips: async () => ({}),
      listOpenDuplicateCandidates: async () => [],
      // Preflight before the payment number is reserved; the repository repeats it under the lock.
      assertClaimPaymentReady: async () => undefined,
      recordPaymentAtomic: async (data: any) => {
        // Mirrors the real repo: postingStatus starts 'pending'.
        const payment = { id: 'pay-1', ...data, sourcePaymentRef: '{}', status: 'RECORDED', postingStatus: 'pending', createdAt: new Date(), updatedAt: new Date() };
        payments.push(payment);
        Object.assign(req, { status: 'PAID', paymentStatus: 'PAID', paymentTotalAmount: data.paidAmount, outstandingAmount: '0.0000' });
        return { request: { ...req, approvalSteps: [], payments, duplicateCandidates: [] }, payment, created: true };
      },
    } as any;
    const reserve = { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202602-000001' }) } as any;
    const commit = { execute: async () => undefined } as any;

    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    const detail: any = await uc.execute(ctx(['reimbursement.payment.record']), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    assert.equal(detail.payments[0].postingStatus, 'pending');
  });
});

// Review finding 5: a payout dated in a closed month was accepted at recording, and could then never
// be posted until someone reopened that month. Recording refuses it, the way expense confirmation
// does. The readiness check and the period rule below are the real repository's, over the two
// tables they read; only what the use case does before and after them is faked.
describe('RecordReimbursementPaymentUseCase — a payment date in a closed accounting period', () => {
  const AUGUST = '2026-08-20T03:00:00.000Z';
  const locked = (periodKey: string) => (error: any) => error.getStatus?.() === 409
    && error.message === `reimbursement_payment_accounting_period_locked:${periodKey}`;

  function harness(periodStatus: string | null, paid?: { paidAt: string }) {
    const claim: any = {
      id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requestNo: 'RB-1', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
      amount: '500.0000', currency: 'THB', categoryKey: 'travel', reason: 'Taxi', status: paid ? 'PAID' : 'READY_FOR_PAYMENT',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus: paid ? 'PAID' : 'UNPAID', paymentTotalAmount: paid ? '500.0000' : '0.0000',
      outstandingAmount: paid ? '0.0000' : '500.0000', duplicateStatus: 'NO_MATCH', incurredDate: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), lines: [],
    };
    const payments: any[] = paid ? [{
      id: 'pay-0', idempotencyKey: 'legacy:pay-0', status: 'RECORDED', postingStatus: 'pending', paidAmount: '500.0000',
      currency: 'THB', paymentMethod: 'CASH', paidAt: new Date(paid.paidAt),
    }] : [];
    const periodReads: any[] = [];
    const client = {
      reimbursementRequest: { findFirst: async () => claim },
      accountingPeriod: { findUnique: async (args: any) => { periodReads.push(args); return periodStatus ? { status: periodStatus } : null; } },
    };
    const repo: any = new PrismaReimbursementRepository({ client } as any, {} as any);
    // Projection readiness runs its own queries and has its own specs.
    repo.assertClaimProjectionsReady = async () => undefined;
    const written: any[] = [];
    Object.assign(repo, {
      findRequestById: async () => ({ ...claim, approvalSteps: [], payments, duplicateCandidates: [] }),
      findPolicy: async () => null, getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [],
      listPaymentSlips: async () => ({}), listOpenDuplicateCandidates: async () => [],
      recordPaymentAtomic: async (data: any) => {
        written.push(data);
        const payment = { id: 'pay-1', ...data, sourcePaymentRef: '{}', status: 'RECORDED', postingStatus: 'pending', createdAt: new Date(), updatedAt: new Date() };
        return { request: { ...claim, status: 'PAID', paymentStatus: 'PAID', approvalSteps: [], payments: [payment], duplicateCandidates: [] }, payment, created: true };
      },
    });
    const reserve = { execute: mock.fn(async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202608-000001' })) };
    const commit = { execute: mock.fn(async () => undefined) };
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserve as any, commit as any, fakeDetailEvidence as any);
    const record = (paidAt: string): Promise<any> => uc.execute(ctx(['reimbursement.payment.record']), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt });
    return { repo: repo as PrismaReimbursementRepository, record, reserve, commit, written, periodReads };
  }

  for (const status of ['CLOSED', 'CLOSING_REVIEW']) {
    it(`refuses a month that is ${status} before a payment number is reserved, and writes nothing`, async () => {
      const h = harness(status);
      await assert.rejects(() => h.record(AUGUST), locked('2026-08'));
      assert.deepEqual(h.periodReads, [{ where: { companyId_periodKey: { companyId: 'co-1', periodKey: '2026-08' } }, select: { status: true } }]);
      assert.equal(h.reserve.execute.mock.callCount(), 0, 'a refused payment burns no payment number');
      assert.deepEqual(h.written, []);
    });
  }

  for (const status of ['OPEN', 'REOPENED', null]) {
    it(`records in a month that is ${status ?? 'not opened yet'}`, async () => {
      const h = harness(status);
      const detail = await h.record(AUGUST);
      assert.equal(detail.payments[0].postingStatus, 'pending');
      assert.equal(h.periodReads.length, 1, 'the month was still asked about');
      assert.equal(h.written[0].paidAt.toISOString(), AUGUST);
      assert.equal(h.commit.execute.mock.callCount(), 1);
    });
  }

  it('asks about the month the money left in Thai time', async () => {
    const h = harness('CLOSED');
    // 23:59:59.999 on 31 July in Bangkok, and the next instant: 1 August.
    await assert.rejects(() => h.repo.assertPaymentPeriodOpen('co-1', new Date('2026-07-31T16:59:59.999Z')), locked('2026-07'));
    await assert.rejects(() => h.repo.assertPaymentPeriodOpen('co-1', new Date('2026-07-31T17:00:00.000Z')), locked('2026-08'));
    assert.deepEqual(h.periodReads.map((read) => read.where.companyId_periodKey.periodKey), ['2026-07', '2026-08']);
  });

  it('the readiness check reads no period when it is asked about the claim alone', async () => {
    const h = harness('CLOSED');
    await h.repo.assertClaimPaymentReady('co-1', 'rb-1');
    assert.deepEqual(h.periodReads, []);
    await assert.rejects(() => h.repo.assertClaimPaymentReady('co-1', 'rb-1', new Date(AUGUST)), locked('2026-08'));
  });

  it('a replay of the payment already recorded is answered as recorded, though its month has closed since', async () => {
    const h = harness('CLOSED', { paidAt: AUGUST });
    const detail = await h.record(AUGUST);
    assert.equal(detail.payments[0].id, 'pay-0');
    assert.deepEqual(h.periodReads, [], 'the money already left: nothing new is being dated');
    assert.deepEqual(h.written, []);
  });
});

describe('GenerateJournalFromSourceUseCase — reimbursement.payment', () => {
  function fakes(settlementError?: Error) {
    const created: any[] = [];
    const flips: Array<{ id: string; postingStatus: string }> = [];
    const ledgerRepo = {
      findGeneratedJournal: async () => null,
      findPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
      upsertPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
      findActivePostingRule: async () => null,
      // Identity code→account resolution keeps the assertable 2130-01 / 1110-01 codes.
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
    const reimbursementRepo = {
      findPaymentById: async () => ({ id: 'pay-1', companyId: 'co-1', status: 'RECORDED', paidAmount: '500.0000', currency: 'THB', paidAt: new Date('2026-02-01T00:00:00.000Z'), paymentNo: 'RBPAY-1' }),
      // Settlement may only post once every claim-expense accrual is posted; the repository
      // proves that and hands back the claim's branch for the settlement leg.
      assertSettlementPostingReady: async () => {
        if (settlementError) throw settlementError;
        return { branchId: 'br-1' };
      },
      // The stamp writes a RECORDED payment only and says whether it wrote; the generator posts the
      // settlement under that claim, inside one transaction.
      updatePaymentPostingStatus: mock.fn(async (_c: string, id: string, data: any) => { flips.push({ id, postingStatus: data.postingStatus }); return true; }),
    } as any;
    // The journal number is reserved and committed inside that same transaction.
    const reserve = { executeInTransaction: async () => ({ id: 'seq-1', documentNumber: 'JV-1' }) } as any;
    const commit = { executeInTransaction: async () => undefined } as any;
    const prisma = { client: { company: { findUnique: async () => ({ baseCurrency: 'THB' }) }, $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({}) } } as any;
    const uc = new GenerateJournalFromSourceUseCase(ledgerRepo, noopAudit, reserve, commit, noopOutbox, {} as any, {} as any, {} as any, reimbursementRepo, prisma);
    return { uc, created, flips, reimbursementRepo };
  }

  it('posts Dr 2130-01 / Cr 1110-01 and flips the payment to posted', async () => {
    const { uc, created, flips } = fakes();
    const summary: any = await uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'reimbursement.payment', sourceId: 'pay-1' } as any);

    assert.equal(summary.sourceType, 'reimbursement.payment');
    const lines = created[0].lines;
    assert.equal(lines.find((l: any) => l.accountId === '2130-01')?.debitAmount, '500.0000');
    assert.equal(lines.find((l: any) => l.accountId === '1110-01')?.creditAmount, '500.0000');

    // pending (pre-generate) then posted (success) — mirrors every other source.
    assert.deepEqual(flips.map((f) => f.postingStatus), ['pending', 'posted']);
    assert.equal(flips.at(-1)?.postingStatus, 'posted');
    assert.equal(flips.at(-1)?.id, 'pay-1');
    // The settlement leg belongs to the claim's branch, which only the readiness proof knows.
    assert.deepEqual([...new Set(lines.map((l: any) => l.branchId))], ['br-1']);
  });

  it('refuses to post the settlement before the claim accruals are posted', async () => {
    const { uc, created, flips } = fakes(new Error('reimbursement_accrual_not_posted'));
    await assert.rejects(
      () => uc.execute(ctx(['journal.entry.post']), { companyId: 'co-1', sourceType: 'reimbursement.payment', sourceId: 'pay-1' } as any),
      /reimbursement_accrual_not_posted/,
    );
    assert.equal(created.length, 0, 'no journal may exist for an unproven settlement');
    assert.deepEqual(flips, [], 'and the payment must not be marked pending/posted');
  });
});

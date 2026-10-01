import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RecordReimbursementPaymentUseCase } from './reimbursement-finance.use-case';
import { GenerateJournalFromSourceUseCase } from '../../../ledger/application/use-cases/journal.use-case';

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
      updatePaymentPostingStatus: mock.fn(async (_c: string, id: string, data: any) => { flips.push({ id, postingStatus: data.postingStatus }); }),
    } as any;
    const reserve = { execute: async () => ({ id: 'seq-1', documentNumber: 'JV-1' }) } as any;
    const commit = { execute: async () => undefined } as any;
    const prisma = { client: { company: { findUnique: async () => ({ baseCurrency: 'THB' }) } } } as any;
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

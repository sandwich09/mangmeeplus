import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';

// Owner decision 2026-08-10: recording the claim payout mirrors PAID onto the claim's
// CONFIRMED expense projections (no ExpensePayment row), and voiding the payout takes
// the mirror back. These specs pin both directions of that contract.

const PAID_AT = new Date('2026-08-10T04:00:00.000Z');
const VERSION = new Date('2026-08-10T01:00:00.000Z');

// A transfer is recorded with its slip (owner 2026-10-01), so every transfer below carries one:
// the payer's own slip upload for the claim, which the repository proves and links in the same transaction.
const SLIP = 'att-slip-1';
function slipTables(links: any[] = []) {
  return {
    attachmentObject: { findFirst: async () => ({
      id: SLIP, byteSize: 1024, checksumSha256: 'a'.repeat(64), uploadedByUserId: 'finance-1',
      metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-1' },
    }) },
    attachmentLink: { findMany: async () => [], create: async ({ data }: any) => { links.push(data); return data; } },
    // A slip is exclusive: no claim line names the file as its receipt.
    reimbursementLine: { count: async () => 0 },
  };
}

function recordHarness(amount = '289.0000', netPayable = amount) {
  const expenseUpdates: any[] = [];
  const slipLinks: any[] = [];
  const request: any = {
    id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', status: 'READY_FOR_PAYMENT', updatedAt: VERSION,
    amount, paymentTotalAmount: '0.0000', outstandingAmount: amount,
    financeReviewStatus: 'APPROVED_FOR_PAYMENT', requesterDisplayNameSnapshot: 'sandwich',
    lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
    createdAt: VERSION, paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
    requesterUserId: 'staff-1', reason: 'r', categoryKey: 'other', currency: 'THB',
    incurredDate: VERSION, createdByUserId: 'staff-1',
  };
  const tx: any = {
    $executeRaw: async () => 0,
    reimbursementRequest: {
      findFirst: async () => request,
      findFirstOrThrow: async () => request,
      updateMany: async ({ data }: any) => { Object.assign(request, data); return { count: 1 }; },
    },
    reimbursementPayment: {
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'pay-1', ...data, createdAt: VERSION, updatedAt: VERSION, status: 'RECORDED' }),
      update: async ({ data }: any) => ({
        id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount: '289.0000',
        currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, status: 'RECORDED',
        postingStatus: 'pending', paidByUserId: 'finance-1', createdAt: VERSION, updatedAt: VERSION, ...data,
      }),
    },
    reimbursementPolicy: { findFirst: async () => null },
    reimbursementDuplicateCandidate: { count: async () => 0 },
    ...slipTables(slipLinks),
    expenseRecord: {
      findMany: async ({ where }: any) => {
        assert.equal(where.sourceReimbursementRequestId, 'rb-1');
        assert.equal(where.status, 'CONFIRMED');
        return [{ id: 'exp-2', netPayableAmount: netPayable }];
      },
      update: async (args: any) => { expenseUpdates.push(args); return {}; },
    },
  };
  const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
  const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
  // Projection readiness runs its own queries; the mirror is what this spec pins.
  (repo as any).assertClaimProjectionsReady = async () => undefined;
  return { repo, expenseUpdates, request, slipLinks };
}

function voidHarness(amount = '289.0000', paidAmount = amount, netPayable = amount, paymentRow: Record<string, unknown> = {}) {
  const expenseUpdates: any[] = [];
  const request: any = {
    id: 'rb-1', companyId: 'co-1', status: 'PAID', amount,
    paymentTotalAmount: paidAmount, outstandingAmount: '0.0000', paymentStatus: 'PAID',
    requesterDisplayNameSnapshot: 'sandwich', lines: [], approvalSteps: [], payments: [],
    duplicateCandidates: [], claimSignatures: [], createdAt: VERSION, updatedAt: VERSION,
    duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
    financeReviewStatus: 'APPROVED_FOR_PAYMENT', requesterUserId: 'staff-1', reason: 'r',
    categoryKey: 'other', currency: 'THB', incurredDate: VERSION, createdByUserId: 'staff-1',
  };
  const tx: any = {
    $executeRaw: async () => 0,
    reimbursementPayment: {
      findFirst: async () => ({ id: 'pay-1', status: 'RECORDED' }),
      updateMany: async () => ({ count: 1 }),
      findFirstOrThrow: async () => ({
        id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount,
        currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, status: 'VOIDED',
        postingStatus: 'pending', paidByUserId: 'finance-1', createdAt: VERSION, updatedAt: VERSION, ...paymentRow,
      }),
      update: async ({ data }: any) => data,
    },
    journalEntry: { findFirst: async () => null },
    // No bank statement line is confirmed against the payment (a confirmed match refuses the void).
    bankReconciliationMatch: { findFirst: async () => null },
    reimbursementRequest: {
      findFirstOrThrow: async () => request,
      update: async ({ data }: any) => { Object.assign(request, data); return request; },
    },
    expenseRecord: {
      findMany: async ({ where }: any) => {
        assert.equal(where.paymentStatus, 'PAID');
        return [{ id: 'exp-2', netPayableAmount: netPayable }];
      },
      update: async (args: any) => { expenseUpdates.push(args); return {}; },
    },
  };
  const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
  const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
  return { repo, expenseUpdates, request, tx };
}

describe('reimbursement payout mirrors the claim expense projections', () => {
  it('refuses an unassigned claim again under the payment lock without changing its totals', async () => {
    const { repo, expenseUpdates, request } = recordHarness();
    request.branchId = null;
    await assert.rejects(() => repo.recordPaymentAtomic({
      companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'missing-branch',
      paidAmount: '289.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: PAID_AT, paymentReference: 'TRX-123', paidByUserId: 'finance-1',
    }), (error: any) => error.getStatus() === 422 && error.getResponse().code === 'TRANSACTION_BRANCH_REQUIRED');
    assert.equal(request.paymentTotalAmount, '0.0000');
    assert.deepEqual(expenseUpdates, []);
  });

  it('marks confirmed projections PAID with the payout method/date and no ExpensePayment row', async () => {
    const { repo, expenseUpdates, slipLinks } = recordHarness();
    await repo.recordPaymentAtomic({
      companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'k-1',
      paidAmount: '289.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: PAID_AT, paymentReference: 'TRX-123', slipAttachmentId: SLIP, paidByUserId: 'finance-1',
    });

    // The slip is evidence of the payout and nothing else: it reaches the payment, never the expense.
    assert.deepEqual(slipLinks.map((link) => [link.attachmentId, link.targetType, link.targetId, link.purpose]),
      [[SLIP, 'reimbursement_payment', 'pay-1', 'reimbursement.payment.slip']]);
    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].where, { id: 'exp-2' });
    assert.deepEqual(expenseUpdates[0].data, {
      paymentStatus: 'PAID', paidAmount: '289.0000', outstandingAmount: '0.0000',
      paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, updatedByUserId: 'finance-1',
    });
  });

  // AC08 (reimbursement-step-journey spec §10/§16): a PERSONAL_ADVANCE substitute-receipt
  // source stays CONFIRMED and unlinked (sourceReimbursementRequestId null) once its claim
  // line exists — prepareClaimProjections creates a SEPARATE expense row for the claim and
  // never touches the source. This harness models BOTH rows in the same company and filters
  // `findMany` for real (unlike the fixed single-row fakes above), so the mirror's own `where`
  // clause is what proves the source is excluded — a regression that loosens the clause would
  // make this fail rather than passing on a fixture that only ever had one row to return.
  it('AC08: mirrors the payout onto the claim projection only, never onto the PERSONAL_ADVANCE source expense it was claimed from', async () => {
    const request: any = {
      id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', status: 'READY_FOR_PAYMENT', updatedAt: VERSION,
      amount: '289.0000', paymentTotalAmount: '0.0000', outstandingAmount: '289.0000',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT', requesterDisplayNameSnapshot: 'sandwich',
      lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
      createdAt: VERSION, paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
      receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required',
      requesterUserId: 'staff-1', reason: 'r', categoryKey: 'other', currency: 'THB',
      incurredDate: VERSION, createdByUserId: 'staff-1',
    };
    const source = { id: 'exp-1-personal-advance-source', companyId: 'co-1', sourceReimbursementRequestId: null, status: 'CONFIRMED', netPayableAmount: '289.0000' };
    const projection = { id: 'exp-2', companyId: 'co-1', sourceReimbursementRequestId: 'rb-1', status: 'CONFIRMED', netPayableAmount: '289.0000' };
    const rows = [source, projection];
    const expenseUpdates: any[] = [];
    const tx: any = {
      $executeRaw: async () => 0,
      reimbursementRequest: {
        findFirst: async () => request,
        findFirstOrThrow: async () => request,
        updateMany: async ({ data }: any) => { Object.assign(request, data); return { count: 1 }; },
      },
      reimbursementPayment: {
        findFirst: async () => null,
        create: async ({ data }: any) => ({ id: 'pay-1', ...data, createdAt: VERSION, updatedAt: VERSION, status: 'RECORDED' }),
        update: async ({ data }: any) => ({
          id: 'pay-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', paidAmount: '289.0000',
          currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: PAID_AT, status: 'RECORDED',
          postingStatus: 'pending', paidByUserId: 'finance-1', createdAt: VERSION, updatedAt: VERSION, ...data,
        }),
      },
      reimbursementPolicy: { findFirst: async () => null },
      reimbursementDuplicateCandidate: { count: async () => 0 },
      ...slipTables(),
      expenseRecord: {
        // A real filter, unlike the fixed single-row fakes above: proves the source decoy is
        // excluded by the query shape itself, not by the fixture only ever containing one row.
        findMany: async ({ where }: any) => rows.filter((row) => row.companyId === where.companyId
          && row.sourceReimbursementRequestId === where.sourceReimbursementRequestId && row.status === where.status),
        update: async (args: any) => { expenseUpdates.push(args); return {}; },
      },
    };
    const client: any = { $transaction: async (work: (t: any) => Promise<unknown>) => work(tx) };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    (repo as any).assertClaimProjectionsReady = async () => undefined;

    await repo.recordPaymentAtomic({
      companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'ac08-k-1',
      paidAmount: '289.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: PAID_AT, paymentReference: 'TRX-123', slipAttachmentId: SLIP, paidByUserId: 'finance-1',
    });

    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].where, { id: projection.id });
    assert.ok(
      !expenseUpdates.some((update) => update.where.id === source.id),
      'the PERSONAL_ADVANCE source expense must never receive the payout mirror',
    );
  });

  it('reverts projections to unpaid when the payout is voided', async () => {
    const { repo, expenseUpdates, request } = voidHarness();
    await repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี');

    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].data, {
      paymentStatus: 'UNPAID', paidAmount: '0.0000', outstandingAmount: '289.0000',
      paymentMethod: null, paidAt: null, updatedByUserId: 'finance-1',
    });
    assert.equal(request.status, 'READY_FOR_PAYMENT');
  });

  // Owner 2026-10-01: voiding keeps the slip as history. The void transaction has no attachment
  // table in this harness at all, so any write to a slip link would throw here.
  it('voids the payment without touching its slip: the voided record still names it', async () => {
    const { repo, request, tx } = voidHarness('289.0000', '289.0000', '289.0000', { slipAttachmentId: SLIP, slipChecksumSha256: 'a'.repeat(64) });
    assert.equal(tx.attachmentLink, undefined);
    assert.equal(tx.attachmentObject, undefined);

    const result = await repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'บันทึกเลขอ้างอิงผิด');

    assert.equal(result.payment.status, 'VOIDED');
    assert.deepEqual([result.payment.slipAttachmentId, result.payment.slipChecksumSha256], [SLIP, 'a'.repeat(64)]);
    assert.deepEqual([request.status, request.paymentStatus, request.outstandingAmount, request.paymentTotalAmount], ['READY_FOR_PAYMENT', 'UNPAID', '289.0000', '0.0000']);
  });

  // FIN-01: a pre-satang claim stores a 4dp amount whose printed outstanding is the satang
  // rounding. Paying that printed figure must settle claim and projections, and voiding it
  // must reset them to the same printed figure — never to an unpayable 4dp residue.
  it('settles a legacy 4dp claim paid at its displayed satang amount', async () => {
    const { repo, expenseUpdates, request } = recordHarness('580.0042');
    await repo.recordPaymentAtomic({
      companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'k-1',
      paidAmount: '580.00', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt: PAID_AT, paymentReference: 'TRX-123', slipAttachmentId: SLIP, paidByUserId: 'finance-1',
    });

    assert.equal(request.paymentStatus, 'PAID');
    assert.equal(request.status, 'PAID');
    assert.equal(request.outstandingAmount, '0.0000');
    assert.equal(expenseUpdates.length, 1);
    assert.equal(expenseUpdates[0].data.paymentStatus, 'PAID');
    assert.equal(expenseUpdates[0].data.outstandingAmount, '0.0000');
  });

  it('resets a legacy 4dp projection to its satang outstanding on void', async () => {
    const { repo, expenseUpdates, request } = voidHarness('580.0042', '580.00');
    await repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี');

    assert.equal(expenseUpdates.length, 1);
    assert.deepEqual(expenseUpdates[0].data, {
      paymentStatus: 'UNPAID', paidAmount: '0.0000', outstandingAmount: '580.0000',
      paymentMethod: null, paidAt: null, updatedByUserId: 'finance-1',
    });
    assert.equal(request.outstandingAmount, '580.0000');
    assert.equal(request.status, 'READY_FOR_PAYMENT');
  });
});

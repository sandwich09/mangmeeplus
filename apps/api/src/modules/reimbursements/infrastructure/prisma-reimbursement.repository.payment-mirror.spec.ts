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
  return { repo, expenseUpdates, request, slipLinks, tx };
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
    bankReconciliationMatch: { findMany: async () => [] },
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

it('multi payout 2b: refuses another currency under the payment lock before writes', async () => {
  const h = recordHarness();
  await assert.rejects(() => h.repo.recordPaymentAtomic({ companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'currency-2b', paidAmount: '289', currency: 'USD', paymentMethod: 'CASH', paidAt: PAID_AT, paidByUserId: 'finance-1' }), /payment_currency_mismatch/);
  assert.deepEqual([h.request.paymentStatus, h.expenseUpdates.length], ['UNPAID', 0]);
});
it('multi payout 2b: source bank must be active in this company under the payment lock', async () => {
  for (const account of [null, { id: 'bank-1', companyId: 'other', status: 'ACTIVE' }, { id: 'bank-1', companyId: 'co-1', status: 'INACTIVE' }]) {
    const h = recordHarness();
    h.tx.bankAccount = { findFirst: async ({ where }: any) => account && account.companyId === where.companyId && account.status === where.status ? account : null };
    await assert.rejects(() => h.repo.recordPaymentAtomic({ companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'bank-2b', paidAmount: '289', currency: 'THB', paymentMethod: 'CASH', bankAccountId: 'bank-1', paidAt: PAID_AT, paidByUserId: 'finance-1' }), /payment_source_bank_account_invalid/);
    assert.deepEqual([h.request.paymentStatus, h.expenseUpdates.length], ['UNPAID', 0]);
  }
  const h = recordHarness();
  h.tx.bankAccount = { findFirst: async ({ where }: any) => { assert.deepEqual(where, { id: 'bank-1', companyId: 'co-1', status: 'ACTIVE' }); return { id: 'bank-1' }; } };
  await h.repo.recordPaymentAtomic({ companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'active-2b', paidAmount: '289', currency: 'THB', paymentMethod: 'CASH', bankAccountId: 'bank-1', paidAt: PAID_AT, paidByUserId: 'finance-1' });
  assert.equal(h.request.paymentStatus, 'PAID');
});

describe('reimbursement payout mirrors the claim expense projections', () => {
  it('D2: void outbox says what the post-void claim can do, for clear, unresolved and confirmed duplicates', async (t) => {
    for (const block of ['NONE', 'UNRESOLVED', 'CONFIRMED']) await t.test(block, async () => {
      const { repo, request, tx } = voidHarness();
      const events: any[] = [];
      tx.reimbursementPolicy = { findFirst: async () => ({ duplicatePolicy: 'BLOCK_PAYMENT' }) };
      tx.outboxEvent = { create: async ({ data }: any) => { events.push(data); return data; } };
      tx.auditLog = { create: async () => ({}) };
      request.sourceExpenses = block === 'CONFIRMED' ? [{ status: 'CONFIRMED', duplicateStatus: 'CONFIRMED_DUPLICATE' }] : [];
      request.duplicateCandidates = block === 'UNRESOLVED' ? [{ status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' }] : [];
      await repo.voidPaymentTrueReversal('co-1', 'rb-1', 'pay-1', 'finance-1', 'โอนผิดบัญชี', undefined, 'trace-1');
      const data = events.find((event) => event.eventType === 'reimbursement.payment_voided').payloadJson.data;
      assert.equal(data.requesterUserId, 'staff-1');
      assert.equal(request.status, 'READY_FOR_PAYMENT');
      assert.match(data.paymentVoidedNotice, /^การจ่ายเงินที่บันทึกไว้ถูกยกเลิก /);
      if (block === 'NONE') assert.match(data.paymentVoidedNotice, /กลับไปรอจ่าย/);
      else {
        assert.doesNotMatch(data.paymentVoidedNotice, /กลับไปรอจ่าย|โอนผิดบัญชี|[A-Za-z_]/);
        assert.match(data.paymentVoidedNotice, block === 'CONFIRMED' ? /รอยกเลิกคำขอ/ : /ปลดรายการซ้ำ/);
      }
    });
  });
  it('D2: payment-notice facts use transaction-owned candidates, expenses and the submitted policy', async () => {
    const { repo, request, tx } = recordHarness();
    const queries: any[] = [];
    tx.reimbursementRequest.findFirstOrThrow = async (query: any) => { queries.push(query); return request; };
    const snapshot = (duplicatePolicy: string) => ({ schemaVersion: 1, policyId: 'pol', policyVersion: 'v1', approvalRequiredFromAmount: '1', requiresApproval: false,
      route: null, allowSelfApproval: false, requireReceipt: false, allowMissingReceiptWithReason: false, financeReviewRequired: false, duplicatePolicy });
    for (const policy of ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT']) {
      request.approvalPolicySnapshotJson = snapshot(policy);
      request.sourceExpenses = [{ status: 'CONFIRMED', duplicateStatus: 'CONFIRMED_DUPLICATE' }];
      const facts = await (repo as any).paymentNoticeFacts(tx, 'co-1', 'rb-1');
      assert.deepEqual(facts, { paymentDuplicateBlock: 'CONFIRMED', duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] });
    }
    request.sourceExpenses = [];
    request.duplicateCandidates = [{ status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' }];
    assert.equal((await (repo as any).paymentNoticeFacts(tx, 'co-1', 'rb-1')).paymentDuplicateBlock, 'UNRESOLVED');
    request.approvalPolicySnapshotJson = snapshot('WARN');
    assert.equal((await (repo as any).paymentNoticeFacts(tx, 'co-1', 'rb-1')).paymentDuplicateBlock, 'NONE');
    assert.ok(queries.every((query) => query.where.companyId === 'co-1' && query.where.id === 'rb-1' && query.include.sourceExpenses && query.include.duplicateCandidates));
  });
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

  it('refuses an unresolved duplicate under the payment lock and succeeds once it is cleared', async () => {
    const { repo, expenseUpdates, request, tx } = recordHarness();
    request.duplicateStatus = 'POSSIBLE_DUPLICATE';
    let open = 1;
    tx.reimbursementDuplicateCandidate.count = async ({ where }: any) => {
      assert.deepEqual(where, { companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'OPEN' });
      return open;
    };
    let paymentCreates = 0;
    const create = tx.reimbursementPayment.create;
    tx.reimbursementPayment.create = async (input: any) => { paymentCreates++; return create(input); };
    const payment = { companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'duplicate-payment',
      paidAmount: '289.0000', currency: 'THB', paymentMethod: 'CASH', paidAt: PAID_AT, paidByUserId: 'finance-1' };
    await assert.rejects(() => repo.recordPaymentAtomic(payment), (error: any) => error.getResponse().code === 'duplicate_unresolved');
    assert.equal(paymentCreates, 0);
    assert.equal(request.paymentStatus, 'UNPAID');
    assert.deepEqual(expenseUpdates, []);
    open = 0;
    await repo.recordPaymentAtomic(payment);
    assert.equal(paymentCreates, 1);
    assert.equal(request.paymentStatus, 'PAID');
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
    const { ExpenseSourceAdapter } = await import('../../tax/infrastructure/adapters/expense-source.adapter');
    const source = new ExpenseSourceAdapter({ client: {
      company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) }, whtFilingLine: { findMany: async () => [] },
      expenseRecord: { findMany: async () => [{ id: 'exp-2', companyId: 'co-1', ...expenseUpdates[0].data,
        expenseDate: PAID_AT, sourceReimbursementRequestId: 'rb-1', whtAmount: '3', taxableAmount: '100', netPayableAmount: '97',
        vendorEntityKindSnapshot: 'INDIVIDUAL', lines: [], payments: [] }] },
    } } as any);
    assert.deepEqual(await source.findConfirmedWithWhtByCompany('co-1'), [], 'claim payout repays the employee; it is not supplier cash');
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


describe('payment source duplicate gate', () => {
  it('refuses a confirmed own expense under the payment lock for every policy without changing recorded money', async () => {
    for (const duplicatePolicy of ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT']) {
      const h = recordHarness();
      h.tx.reimbursementPolicy.findFirst = async () => ({ duplicatePolicy });
      h.request.sourceExpenses = [{ status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'CONFIRMED_DUPLICATE' }];
      let created = 0;
      const create = h.tx.reimbursementPayment.create;
      h.tx.reimbursementPayment.create = async (input: any) => { created++; return create(input); };
      await assert.rejects(() => h.repo.recordPaymentAtomic({ companyId: 'co-1', reimbursementRequestId: 'rb-1', paidByUserId: 'payer', currency: 'THB', paidAmount: '289', paymentMethod: 'CASH', paidAt: PAID_AT, idempotencyKey: 'confirmed-dup' }), (error: any) => {
        assert.equal(error.getResponse().code, 'duplicate_confirmed');
        assert.deepEqual(error.getResponse().duplicateReasons, ['EXPENSE_CONFIRMED_DUPLICATE']);
        return true;
      });
      assert.equal(created, 0);
      assert.equal(h.request.paymentTotalAmount, '0.0000');
      assert.equal(h.request.paymentStatus, 'UNPAID');
      assert.deepEqual(h.expenseUpdates, []);
    }
  });
  it('refuses an unresolved own expense under the lock, but leaves WARN payable', async () => {
    for (const duplicatePolicy of ['BLOCK_PAYMENT', 'WARN']) {
      const h = recordHarness();
      h.request.approvalPolicySnapshotJson = { schemaVersion: 1, policyId: 'p', policyVersion: 'test', approvalRequiredFromAmount: '1', requiresApproval: false, route: null, allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: true, duplicatePolicy, financeReviewRequired: false };
      h.request.sourceExpenses = [{ status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'POSSIBLE_DUPLICATE' }];
      const result = h.repo.recordPaymentAtomic({ companyId: 'co-1', reimbursementRequestId: 'rb-1', paidByUserId: 'payer', currency: 'THB', paidAmount: '289', paymentMethod: 'CASH', paidAt: PAID_AT, idempotencyKey: 'dup', scopes: {} } as any);
      if (duplicatePolicy === 'BLOCK_PAYMENT') { await assert.rejects(result, (error: any) => error.getResponse().code === 'duplicate_unresolved'); assert.equal(h.expenseUpdates.length, 0); }
      else await result;
    }
  });
  it('queries strong evidence across the company without limiting it to the soft scan', async () => {
    const queries: any[] = [];
    const client: any = { attachmentObject: { findMany: async () => [{ id: 'other-file', checksumSha256: 'same' }] }, reimbursementRequest: {
      findMany: async (query: any) => { queries.push(query); return []; },
    } };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    await (repo.findDuplicateCandidates as any)('co-1', 'one', 'rb-1', { attachmentIds: ['mine'], attachmentChecksums: { mine: 'same' }, expenseIds: ['source'] });
    const strong = queries.find(q => !q.where.requesterUserId);
    assert.ok(strong, 'strong evidence has a separate company-wide query');
    assert.equal(strong.take, undefined);
    assert.equal(strong.where.companyId, 'co-1');
    assert.match(JSON.stringify(strong.where), /other-file/);
    assert.match(JSON.stringify(strong.where), /source/);
    assert.equal(queries.find(q => q.where.requesterUserId === 'one').take, 50);
  });
});

it('D3: shared notice facts name the first own confirmation and its actor, not the last receipt', async () => {
  const { repo, request, tx } = recordHarness();
  const first = new Date('2026-10-05T01:00:00Z'); const last = new Date('2026-10-06T01:00:00Z');
  request.sourceExpenses = [
    { status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'CONFIRMED_DUPLICATE', duplicateCandidates: [{ resolvedAt: last, resolvedByUserId: 'later' }] },
    { status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'CONFIRMED_DUPLICATE', duplicateCandidates: [{ resolvedAt: first, resolvedByUserId: 'first' }] },
  ];
  tx.reimbursementRequest.findFirstOrThrow = async () => request;
  const facts = await repo.paymentNoticeFacts(tx, 'co-1', 'rb-1');
  assert.equal(facts.paymentDuplicateBlock, 'CONFIRMED');
  assert.deepEqual(facts.confirmedDuplicateAt, first); assert.equal(facts.confirmedDuplicateActorUserId, 'first');
});

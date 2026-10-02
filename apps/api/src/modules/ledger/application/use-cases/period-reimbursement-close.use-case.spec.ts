import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunPeriodCloseChecksUseCase } from './period.use-case.js';

// GAP-02 Phase 4: the `reimbursement_postings_complete` close check must fail
// while approved claim money is off the books (unconfirmed claim expenses or
// unposted settlement payments), and pass once all three counts are zero —
// without disturbing the other close checks.

const period = {
  id: 'p-1', companyId: 'co-1', periodKey: '2026-07',
  startDate: new Date('2026-07-01T00:00:00Z'), endDate: new Date('2026-07-31T23:59:59Z'),
  status: 'OPEN', closedAt: null, reopenedAt: null, closeNote: null,
};

function ctx() {
  return { companyId: 'co-1', userId: 'u-1', requestId: 'r-1', permissions: ['ledger.period.close'] } as any;
}

// All non-reimbursement checks pass: no drafts, balanced TB, no source blockers,
// no tax reconciliation issues.
function fakes(reimbursementBlockers: { unconfirmedClaimExpenses: number; pendingPayments: number; paymentErrors: number }) {
  const ledgerRepo = {
    findPeriodById: async () => period,
    countDraftJournals: async () => 0,
    getAccountBalances: async () => [],
    createCloseRun: async () => 'run-1',
    updateCloseRun: async () => undefined,
  } as any;
  const noBlockers = { pending: 0, errors: 0 };
  const accountingRepo = { countPostingBlockers: async () => noBlockers, countPaymentPostingBlockers: async () => noBlockers } as any;
  const expenseRepo = { countPostingBlockers: async () => noBlockers } as any;
  const procurementRepo = { countVendorBillPostingBlockers: async () => noBlockers, countSupplierPaymentPostingBlockers: async () => noBlockers } as any;
  const reimbursementRepo = { countReimbursementPostingBlockers: async () => reimbursementBlockers } as any;
  const prisma = { client: {
    company: { findUnique: async () => ({}) },
    chartOfAccount: { findMany: async () => [] },
    accountingPeriod: { findMany: async () => [{ id: period.id }] },
    purchaseOrder: { count: async () => 0 },
    goodsReceipt: { count: async () => 0 },
    bankAdjustment: { count: async () => 0 },
    reimbursementRequest: { count: async () => 0 },
    taxEvent: { findMany: async () => [] },
    taxReconciliationRun: { findMany: async () => [] },
    taxReviewIssue: { count: async () => 0 },
    vendorBillLine: { findMany: async () => [] },
  } } as any;
  const chartReadiness = {
    inspect: async () => ({
      preview: { rows: [] },
      readiness: {
        taxConfigurationRequired: false,
        requiredTaxAccountRolesMissing: [],
        taxProfilesNeedingReview: 0,
      },
    }),
  } as any;
  return new RunPeriodCloseChecksUseCase(
    ledgerRepo,
    accountingRepo,
    expenseRepo,
    procurementRepo,
    reimbursementRepo,
    prisma,
    chartReadiness,
  );
}

describe('reimbursement period close gate', () => {
  it('FAILS when an unconfirmed claim expense sits in the period', async () => {
    const summary = await fakes({ unconfirmedClaimExpenses: 1, pendingPayments: 0, paymentErrors: 0 }).execute(ctx(), 'p-1');
    const check = summary.checks.find((c) => c.checkKey === 'reimbursement_postings_complete')!;
    assert.equal(check.status, 'FAILED');
    assert.equal(check.severity, 'ERROR');
    assert.equal(check.count, 1);
    assert.equal(summary.status, 'FAILED');
    // The other checks are undisturbed.
    for (const key of [
      'no_draft_journals',
      'trial_balance_balanced',
      'source_postings_complete',
      'no_source_posting_errors',
      'chart_conflict_remediation_clear',
      'chart_semantics_valid',
      'suspense_balance_zero',
      'tax_account_mapping_valid',
      'transaction_tax_reconciliation_clear',
    ]) {
      assert.equal(summary.checks.find((c) => c.checkKey === key)!.status, 'PASSED', key);
    }
  });

  it('FAILS when a RECORDED payment is still pending posting', async () => {
    const summary = await fakes({ unconfirmedClaimExpenses: 0, pendingPayments: 2, paymentErrors: 0 }).execute(ctx(), 'p-1');
    const check = summary.checks.find((c) => c.checkKey === 'reimbursement_postings_complete')!;
    assert.equal(check.status, 'FAILED');
    assert.equal(check.count, 2);
  });

  it('FAILS when a payment posting errored', async () => {
    const summary = await fakes({ unconfirmedClaimExpenses: 0, pendingPayments: 0, paymentErrors: 3 }).execute(ctx(), 'p-1');
    const check = summary.checks.find((c) => c.checkKey === 'reimbursement_postings_complete')!;
    assert.equal(check.status, 'FAILED');
    assert.equal(check.count, 3);
  });

  it('PASSES when all three counts are zero', async () => {
    const summary = await fakes({ unconfirmedClaimExpenses: 0, pendingPayments: 0, paymentErrors: 0 }).execute(ctx(), 'p-1');
    const check = summary.checks.find((c) => c.checkKey === 'reimbursement_postings_complete')!;
    assert.equal(check.status, 'PASSED');
    assert.equal(check.count, 0);
    assert.equal(summary.checks.length, 10);
    assert.equal(summary.checks.at(-1)!.checkKey, 'reimbursement_postings_complete');
    assert.equal(summary.status, 'PASSED');
  });

  // The refusal has to say WHAT is pending. One total cannot tell a payout nobody posted from an
  // expense nobody confirmed, and the two are fixed on different screens.
  it('names each kind of pending claim money, in plain Thai and as numbers a client can render', async () => {
    const summary = await fakes({ unconfirmedClaimExpenses: 1, pendingPayments: 2, paymentErrors: 3 }).execute(ctx(), 'p-1');
    const check = summary.checks.find((c) => c.checkKey === 'reimbursement_postings_complete')!;
    assert.equal(check.count, 6);
    assert.deepEqual(check.breakdown, { unconfirmedClaimExpenses: 1, pendingPayments: 2, paymentErrors: 3 });
    assert.equal(Object.values(check.breakdown!).reduce((sum, part) => sum + part, 0), check.count, 'the parts add up to the total');
    assert.match(check.message, /ค่าใช้จ่ายจากใบเบิกยังไม่ยืนยัน 1 รายการ/);
    assert.match(check.message, /การจ่ายเงินเบิกยังไม่ลงบัญชี 2 รายการ/);
    assert.match(check.message, /ลงบัญชีผิดพลาด 3 รายการ/);
    assert.doesNotMatch(check.message, /[A-Za-z_]{3,}/, 'no machine token in the sentence');
  });
});

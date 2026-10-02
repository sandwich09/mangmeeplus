import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMappedCharge, observeBillingCharges } from './billing-financial';

const account = { id: 'account', companyId: 'company', customerId: 'cus_owner', stripeAccountId: 'acct_owner', livemode: false };
const invoice = { id: 'invoice', providerChargeId: 'ch_paid', paidSatang: 999000 };
const charge = { id: 'ch_paid', customer: 'cus_owner', livemode: false, currency: 'thb', status: 'succeeded', paid: true,
  captured: true, amount: 999000, amount_refunded: 100, disputed: true };

test('financial observations reject malformed or differently owned money evidence', () => {
  assert.doesNotThrow(() => assertMappedCharge(charge, account, invoice));
  for (const patch of [{ id: 'ch_other' }, { customer: 'cus_other' }, { livemode: true }, { currency: 'usd' }, { amount: 1 },
    { amount_refunded: -1 }, { amount_refunded: 999001 }, { amount_refunded: 0.5 }, { disputed: undefined }, { captured: false }]) {
    assert.throws(() => assertMappedCharge({ ...charge, ...patch }, account, invoice), /financial_charge_mismatch/);
  }
});

test('a stale financial observer cannot update an invoice or open a case', async () => {
  let mutations = 0;
  const tx = { $queryRaw: async () => [], company: { findUnique: async () => ({ id: account.companyId }) },
    billingAccount: { findUniqueOrThrow: async () => ({ ...account, leaseToken: 'successor', leaseUntil: new Date(Date.now() + 60000) }) },
    billingInvoice: { update: async () => { mutations++; } } };
  const prisma = { client: { billingInvoice: { findMany: async () => [invoice] }, salesAttribution: { findUnique: async () => null },
    $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx) } };
  const stripe = { accountId: account.stripeAccountId, livemode: false, request: async () => charge };
  await assert.rejects(observeBillingCharges(prisma as any, stripe as any, account as any, 'expired-worker'), /financial_lost_lease/);
  assert.equal(mutations, 0);
});

// ── Sales credit taken back (sales spec §17.1, owner decisions 2026-10-02, RB-37) ─────────────
//
// `observeBillingCharges` is the one place a refund or a dispute is ever observed, and a charge
// only carries a refunded total and a disputed flag. For the one payment per shop that carries
// sales credit it therefore also reads the provider's own refunds and disputes. These drive the
// real observer, the real deduction rule and the real writer over an in-memory stand-in for the
// two sales tables; the SQL side (unique provider id, the report) is `sales-console.pg.spec.ts`.

const DAY = 86_400_000;
/** Whole seconds, because that is all the provider's timestamps carry. */
const paidDaysAgo = (days: number) => new Date(Math.floor(Date.now() / 1000) * 1000 - days * DAY);
const settled = (object: 'refund' | 'dispute', id: string, amount: number, at: Date, status: string) =>
  ({ id, object, charge: charge.id, currency: 'thb', amount, created: at.getTime() / 1000, status });

function creditHarness(input: { paidAt: Date; creditSatang?: number; undatedRefundSatang?: number; attributed?: boolean;
  refundedSatang: number; disputed: boolean; refunds?: unknown[]; disputes?: unknown[] }) {
  const deductions: Array<{ attributionId: string; kind: string; providerRef: string; amountSatang: number; occurredAt: Date }> = [];
  const providerCalls: string[] = [];
  const stored = { ...invoice, billingAccountId: account.id, refundedSatang: 0, disputed: false };
  const salesAttribution = { findUnique: async () => input.attributed === false ? null : { id: 'attribution', sourceInvoiceId: invoice.id,
    paidAt: input.paidAt, amountSatang: input.creditSatang ?? 999000, refundedSatang: input.undatedRefundSatang ?? 0, deductions: [...deductions] } };
  const tx = { $queryRaw: async () => [], $executeRaw: async () => 0,
    billingAccount: { findUniqueOrThrow: async () => ({ ...account, leaseToken: 'worker', leaseUntil: new Date(Date.now() + 60000) }) },
    billingInvoice: { findUniqueOrThrow: async () => ({ ...stored }),
      update: async ({ data }: { data: { refundedSatang: number; disputed: boolean } }) => Object.assign(stored, { refundedSatang: data.refundedSatang, disputed: data.disputed }) },
    auditLog: { create: async () => ({}) },
    billingIssue: { findUnique: async () => ({ id: 'issue', state: 'OPEN', priority: 'HIGH', companyId: account.companyId }), update: async () => ({ id: 'issue' }) },
    salesAttribution,
    // The table's unique provider id, which is what makes a second sighting write nothing.
    salesAttributionDeduction: { createMany: async ({ data }: { data: typeof deductions }) => {
      for (const row of data) if (!deductions.some(known => known.providerRef === row.providerRef)) deductions.push(row);
    } } };
  const prisma = { client: { billingInvoice: { findMany: async () => [{ ...stored }] }, salesAttribution,
    $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx) } };
  const stripe = { accountId: account.stripeAccountId, livemode: false,
    request: async (_method: string, path: string) => { providerCalls.push(path); return { ...charge, amount_refunded: input.refundedSatang, disputed: input.disputed }; },
    list: async (path: string) => { providerCalls.push(path); return path === '/refunds' ? input.refunds ?? [] : input.disputes ?? []; } };
  return { deductions, providerCalls, taken: () => deductions.map(row => [row.kind, row.providerRef, row.amountSatang]),
    observe: () => observeBillingCharges(prisma as any, stripe as any, account as any, 'worker') };
}

test('a refund made on day 59 is deducted when it is only noticed after day 60, one made on day 61 is not, and neither twice', async () => {
  const paidAt = paidDaysAgo(62), day59 = new Date(paidAt.getTime() + 59 * DAY);
  const h = creditHarness({ paidAt, refundedSatang: 30000, disputed: false, refunds: [
    settled('refund', 're_day59', 10000, day59, 'succeeded'),
    settled('refund', 're_day61', 20000, new Date(paidAt.getTime() + 61 * DAY), 'succeeded')] });
  await h.observe();
  assert.deepEqual(h.taken(), [['REFUND', 're_day59', 10000]]);
  // The provider's time of the refund is what is kept, not the time of this observation.
  assert.equal(h.deductions[0]!.occurredAt.getTime(), day59.getTime());
  assert.equal(h.deductions[0]!.attributionId, 'attribution');
  await h.observe();
  assert.deepEqual(h.taken(), [['REFUND', 're_day59', 10000]], 'the same refund seen twice is one deduction');
});

test('a lost dispute is deducted like a refund; a won or open dispute and an unsettled refund are not', async () => {
  const paidAt = paidDaysAgo(40), at = (day: number) => new Date(paidAt.getTime() + day * DAY);
  const h = creditHarness({ paidAt, refundedSatang: 500, disputed: true,
    refunds: [settled('refund', 're_pending', 500, at(1), 'pending'), settled('refund', 're_failed', 500, at(2), 'failed')],
    disputes: [settled('dispute', 'dp_won', 40000, at(8), 'won'), settled('dispute', 'dp_open', 40000, at(9), 'needs_response'),
      settled('dispute', 'dp_lost', 40000, at(10), 'lost'),
      // Not this charge's dispute, and not a dispute at all: neither is a fact about this payment.
      { ...settled('dispute', 'dp_other', 40000, at(11), 'lost'), charge: 'ch_other' }, { id: 'dp_shape', status: 'lost' }] });
  await h.observe();
  assert.deepEqual(h.taken(), [['DISPUTE', 'dp_lost', 40000]]);
  assert.equal(h.deductions[0]!.occurredAt.getTime(), at(10).getTime());
  await h.observe();
  assert.deepEqual(h.taken(), [['DISPUTE', 'dp_lost', 40000]], 'the same dispute seen twice is one deduction');
});

test('a second partial refund is a second deduction, and the provider is not asked again once no credit is left', async () => {
  const paidAt = paidDaysAgo(20), at = (day: number) => new Date(paidAt.getTime() + day * DAY);
  // 999,000 paid, 933,645 credited: what a tax-on-top purchase would leave as sales credit.
  const refunds = [settled('refund', 're_1', 300000, at(3), 'succeeded')];
  const h = creditHarness({ paidAt, creditSatang: 933645, refundedSatang: 999000, disputed: false, refunds });
  await h.observe();
  assert.deepEqual(h.taken(), [['REFUND', 're_1', 300000]]);
  refunds.push(settled('refund', 're_2', 699000, at(6), 'succeeded'));
  await h.observe();
  assert.deepEqual(h.taken(), [['REFUND', 're_1', 300000], ['REFUND', 're_2', 633645]], 'never more than the credit');
  const reads = h.providerCalls.length;
  await h.observe();
  assert.deepEqual(h.providerCalls.slice(reads), ['/charges/ch_paid'], 'only the charge is read once the credit is used up');
});

test('a payment that carries no sales credit costs no extra provider call, and an older row keeps its undated refund', async () => {
  const paidAt = paidDaysAgo(20), at = (day: number) => new Date(paidAt.getTime() + day * DAY);
  const none = creditHarness({ paidAt, attributed: false, refundedSatang: 100, disputed: true,
    refunds: [settled('refund', 're_1', 100, at(1), 'succeeded')], disputes: [settled('dispute', 'dp_1', 100, at(2), 'lost')] });
  await none.observe();
  assert.deepEqual(none.providerCalls, ['/charges/ch_paid']);
  assert.deepEqual(none.taken(), []);

  // A row refunded before deductions were dated: 30,000 is already deducted in its payment month.
  const old = creditHarness({ paidAt, undatedRefundSatang: 30000, refundedSatang: 50000, disputed: false,
    refunds: [settled('refund', 're_old', 30000, at(2), 'succeeded'), settled('refund', 're_new', 20000, at(9), 'succeeded')] });
  await old.observe();
  assert.deepEqual(old.taken(), [['REFUND', 're_new', 20000]]);
});

// ── Admin previews read the SAME budget projection as admission (spec §11.4, R-10) ────────────
//
// Both previews used to compare TOTAL spend with the TOTAL budget, so a `SPLIT` shop whose
// document-reading share was gone still read as "AI has money" — and adding receipts would not
// have helped. Neither method is public, so they are driven exactly like the support-tools spec
// drives `PartnerController`: a prototype instance with only the collaborators the method reaches.
// They live in this file because it is the registered spec of `billing/application`.

type AiState = {
  total?: number; ocrSpent?: number; configuration?: unknown;
  /** Live reservations in the OCR bucket, exactly as `readAiBudgetMonthSnapshot` groups them. */
  heldSatang?: number;
  /** Of those, how many are `UNRESOLVED` (provider outcome still unknown). */
  unresolvedHolds?: number;
};
const aiTx = (state: AiState = {}) => ({
  companyAiConfiguration: { findUnique: async () => state.configuration ?? null },
  companyOcrMonthlyUsage: { findUnique: async () => null },
  companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: state.total ?? 0 }) },
  companyAiMonthlyBucketUsage: {
    findMany: async () => (state.ocrSpent === undefined ? [] : [{ bucket: 'OCR', costSatang: state.ocrSpent }]),
  },
  aiBudgetReservation: {
    groupBy: async () => [
      ...(state.heldSatang === undefined ? [] : [{
        bucket: 'OCR', status: 'ACTIVE', _sum: { upperBoundSatang: state.heldSatang }, _count: { _all: 1 },
      }]),
      ...(state.unresolvedHolds === undefined ? [] : [{
        bucket: 'OCR', status: 'UNRESOLVED', _sum: { upperBoundSatang: 0 }, _count: { _all: state.unresolvedHolds },
      }]),
    ],
    count: async () => 0,
  },
  billingReceiptGrant: { findMany: async () => [] },
  platformAiBudgetConfig: { findUnique: async () => null },
});
/** T=10000, C=3000, O=7000 — the spec §12.1 worked example, in satang. */
const splitConfiguration = {
  monthlyBudgetSatang: 10000, ocrEnabled: true, ocrMonthlyLimit: null, budgetMode: 'SPLIT',
  chatMonthlyBudgetSatang: 3000, ocrMonthlyBudgetSatang: 7000, budgetConfigVersion: 1,
};

test('receipt-grant read warnings follow TOTAL-or-OCR, and never carry money', async () => {
  const { BillingReceiptAdjustmentsService } = await import('./billing-receipt-adjustments.service');
  const warn = (state: AiState) => {
    const service = Object.create(BillingReceiptAdjustmentsService.prototype) as any;
    service.config = { aiMonthlyBudgetSatang: 8000, receiptQuotaEnforced: true };
    return service.readWarnings('co-1', aiTx(state));
  };

  // SHARED, the whole population today: byte-for-byte the two outcomes this list always had.
  assert.deepEqual(await warn({ total: 3000 }), []);
  assert.deepEqual(await warn({ total: 8000 }), ['AI_BUDGET_REACHED']);
  // SPLIT with the OCR share gone: the total still has 3000 satang, but not for reading documents.
  assert.deepEqual(
    await warn({ total: 7000, ocrSpent: 7000, configuration: splitConfiguration }),
    ['AI_OCR_BUDGET_REACHED'],
  );
  // The total itself gone: ONE warning, never both — the OCR line is strictly the total-open case.
  assert.deepEqual(
    await warn({ total: 10000, ocrSpent: 7000, configuration: splitConfiguration }),
    ['AI_BUDGET_REACHED'],
  );
  // Owner/operator copy is words only: no satang value may reach this list (spec §11.4).
  for (const warning of await warn({ total: 7000, ocrSpent: 7000, configuration: splitConfiguration })) {
    assert.doesNotMatch(warning, /[0-9]/);
  }

  // ── Held credit (credit-wording spec §5.3, W-04) ──
  // Money is left in every scope, so the three lines above stay silent — but credit IS held, which
  // is exactly the case this console could not see before.
  assert.deepEqual(await warn({ total: 3000, heldSatang: 500 }), ['AI_CREDIT_HOLDS_PENDING']);
  // A hold whose provider outcome is unknown counts even when it reserves nothing.
  assert.deepEqual(await warn({ total: 3000, unresolvedHolds: 2 }), ['AI_CREDIT_HOLDS_PENDING']);
  // It is orthogonal: it appends to an existing reason rather than replacing it, and it is last.
  assert.deepEqual(await warn({ total: 8000, heldSatang: 500 }), ['AI_BUDGET_REACHED', 'AI_CREDIT_HOLDS_PENDING']);
  assert.deepEqual(
    await warn({ total: 7000, ocrSpent: 7000, configuration: splitConfiguration, heldSatang: 500 }),
    ['AI_OCR_BUDGET_REACHED', 'AI_CREDIT_HOLDS_PENDING'],
  );
  // SHARED and SPLIT answer the same, and the new line names no money either.
  assert.deepEqual(
    await warn({ total: 3000, configuration: splitConfiguration, heldSatang: 500 }),
    ['AI_CREDIT_HOLDS_PENDING'],
  );
  assert.doesNotMatch('AI_CREDIT_HOLDS_PENDING', /[0-9]/);
});

test('the paid-plan "unchanged" panel flags an exhausted document-reading share', async () => {
  const { BillingPlanAdjustmentsService } = await import('./billing-plan-adjustments.service');
  const panel = (state: AiState) => {
    const service = Object.create(BillingPlanAdjustmentsService.prototype) as any;
    service.config = { aiMonthlyBudgetSatang: 8000 };
    const scope = {
      account: { id: 'acct-1', nextChargeAt: null },
      company: { id: 'co-1', planTerm: { termEndsAt: new Date('2026-12-01T00:00:00.000Z') } },
    };
    return service.unchanged(scope, aiTx(state));
  };

  // SHARED keeps exactly today's shape — the additive field is absent, not false.
  const shared = await panel({ total: 3000 });
  assert.equal('aiOcrBudgetReached' in shared, false);
  assert.equal(shared.aiBudgetSatang, 8000);
  assert.equal(shared.aiUsedSatang, 3000);

  // SPLIT with 3000 satang left overall but nothing left for documents.
  const split = await panel({ total: 7000, ocrSpent: 7000, configuration: splitConfiguration });
  assert.equal(split.aiOcrBudgetReached, true);
  // The money already on this panel is unchanged: the flag adds words, not a second money pair.
  assert.equal(split.aiBudgetSatang, 10000);
  assert.equal(split.aiUsedSatang, 7000);

  // ── Held credit (credit-wording spec §5.3, W-04) ──
  // No hold ⇒ neither additive field appears, so the panel is byte-for-byte today's.
  for (const key of ['aiReservedSatang', 'aiUnresolvedHolds']) assert.equal(key in shared, false, key);
  const held = await panel({ total: 3000, heldSatang: 500, unresolvedHolds: 2 });
  assert.equal(held.aiReservedSatang, 500);
  assert.equal(held.aiUnresolvedHolds, 2);
  // Held credit is not spend: the existing money pair does not move because of it.
  assert.equal(held.aiBudgetSatang, 8000);
  assert.equal(held.aiUsedSatang, 3000);
  // An unresolved hold that reserves nothing reports the count alone.
  const unresolvedOnly = await panel({ total: 3000, unresolvedHolds: 1 });
  assert.equal('aiReservedSatang' in unresolvedOnly, false);
  assert.equal(unresolvedOnly.aiUnresolvedHolds, 1);
});

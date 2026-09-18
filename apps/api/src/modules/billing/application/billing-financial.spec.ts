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
  const prisma = { client: { billingInvoice: { findMany: async () => [invoice] }, $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx) } };
  const stripe = { accountId: account.stripeAccountId, livemode: false, request: async () => charge };
  await assert.rejects(observeBillingCharges(prisma as any, stripe as any, account as any, 'expired-worker'), /financial_lost_lease/);
  assert.equal(mutations, 0);
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

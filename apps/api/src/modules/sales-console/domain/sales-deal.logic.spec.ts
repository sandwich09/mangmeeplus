import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SALES_CODE_PATTERN, SALES_DEAL_OFFER_DAYS } from '@watchdog-bms/contracts';
import {
  autoRenewOf,
  buildDealSnapshot,
  canTransitionDeal,
  derivedDealStatus,
  generateSalesCode,
  isOfferLive,
  normalizeSalesCode,
  offerExpiryFrom,
  overLimitCounts,
  requireReason,
  SALES_OFFER_NOTICE_TH,
  salesOfferNoticeText,
  SalesSnapshotError,
  tenantBillingLink,
} from './sales-deal.logic';

const draft = {
  base: 'BASIC_499', priceSatang: 49900, months: 12, branchLimit: 2, employeeLimit: 5,
  monthlySlipLimit: 50, featureKeys: ['crm', 'crm'], aiMonthlyBudgetSatang: null,
  description: 'ข้อเสนอพิเศษสำหรับร้านคุณ',
};

describe('sales deal state machine', () => {
  it('walks the happy path and refuses every shortcut past approval', () => {
    assert.ok(canTransitionDeal('DRAFT', 'PENDING_APPROVAL'));
    assert.ok(canTransitionDeal('PENDING_APPROVAL', 'APPROVED'));
    assert.ok(canTransitionDeal('APPROVED', 'PAID'));
    assert.ok(canTransitionDeal('PAID', 'APPLIED'));
    // Phase 3 pays and applies in one commit, so APPROVED -> APPLIED is a real transition.
    assert.ok(canTransitionDeal('APPROVED', 'APPLIED'));
    // A draft can never become an offer without an approval in between.
    assert.equal(canTransitionDeal('DRAFT', 'APPROVED'), false);
    assert.equal(canTransitionDeal('PENDING_APPROVAL', 'PAID'), false);
  });

  it('keeps APPROVED immutable and every final status terminal (R4)', () => {
    assert.equal(canTransitionDeal('APPROVED', 'DRAFT'), false);
    assert.equal(canTransitionDeal('APPROVED', 'PENDING_APPROVAL'), false);
    for (const final of ['APPLIED', 'EXPIRED', 'CANCELLED'] as const) {
      for (const to of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID'] as const) {
        assert.equal(canTransitionDeal(final, to), false, `${final} -> ${to}`);
      }
    }
  });

  it('lets a rejected deal be edited back into a draft, and cancelled from there', () => {
    assert.ok(canTransitionDeal('REJECTED', 'DRAFT'));
    assert.ok(canTransitionDeal('REJECTED', 'CANCELLED'));
  });
});

describe('offer expiry', () => {
  it('closes the window exactly SALES_DEAL_OFFER_DAYS after approval', () => {
    const approved = new Date('2026-09-21T00:00:00.000Z');
    assert.equal(offerExpiryFrom(approved).toISOString(), '2026-09-24T00:00:00.000Z');
    assert.equal(SALES_DEAL_OFFER_DAYS, 3);
  });

  it('derives EXPIRED on read before any sweep has run (S17)', () => {
    const expiresAt = new Date('2026-09-24T00:00:00.000Z');
    const row = { status: 'APPROVED', offerExpiresAt: expiresAt };
    assert.equal(derivedDealStatus(row, new Date('2026-09-23T23:59:59.000Z')), 'APPROVED');
    assert.equal(derivedDealStatus(row, new Date('2026-09-24T00:00:01.000Z')), 'EXPIRED');
    assert.equal(isOfferLive(row, new Date('2026-09-24T00:00:01.000Z')), false);
  });

  it('never expires a status that carries no offer window', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'PAID', 'APPLIED'] as const) {
      assert.equal(derivedDealStatus({ status, offerExpiresAt: new Date(0) }, new Date()), status);
    }
  });
});

describe('sales code', () => {
  it('generates codes from an alphabet with no lookalike characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateSalesCode();
      assert.match(code, SALES_CODE_PATTERN);
      assert.equal(code.length, 4);
      assert.equal(/[01OI]/.test(code), false, `ambiguous character in ${code}`);
    }
  });

  it('upper-cases what the customer typed and rejects anything off-pattern', () => {
    assert.equal(normalizeSalesCode(' ton '), 'TON');
    assert.equal(normalizeSalesCode('AB'), null);          // too short
    assert.equal(normalizeSalesCode('ABCDEFG'), null);     // too long
    assert.equal(normalizeSalesCode('TON-1'), null);       // punctuation
    assert.equal(normalizeSalesCode(42), null);
  });
});

describe('deal snapshot validation', () => {
  it('freezes a valid draft at version 3 and de-duplicates feature keys', () => {
    const snapshot = buildDealSnapshot(draft);
    // D-P5-1: everything written from now on is v3; a draft with no switch is an explicit no.
    assert.equal(snapshot.version, 3);
    assert.equal(snapshot.autoRenew, false);
    assert.equal(snapshot.cadence, null);
    assert.equal(snapshot.cycles, null);
    assert.equal(snapshot.base, 'BASIC_499');
    assert.deepEqual(snapshot.featureKeys, ['crm']);
    assert.equal(snapshot.aiMonthlyBudgetSatang, null);
  });

  it('accepts any price of at least one satang, with no ceiling (D1)', () => {
    assert.equal(buildDealSnapshot({ ...draft, priceSatang: 1 }).priceSatang, 1);
    assert.equal(buildDealSnapshot({ ...draft, priceSatang: 99_999_900 }).priceSatang, 99_999_900);
    assert.throws(() => buildDealSnapshot({ ...draft, priceSatang: 0 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, priceSatang: -1 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, priceSatang: 1.5 }), SalesSnapshotError);
  });

  it('bounds months to 1..36', () => {
    assert.equal(buildDealSnapshot({ ...draft, months: 36 }).months, 36);
    assert.throws(() => buildDealSnapshot({ ...draft, months: 37 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, months: 0 }), SalesSnapshotError);
  });

  it('accepts only the three tiers that have a Stripe catalog Price (D-P3-1)', () => {
    for (const base of ['STARTER_249', 'BASIC_499', 'PRO_999']) {
      assert.equal(buildDealSnapshot({ ...draft, base }).base, base);
    }
    assert.throws(() => buildDealSnapshot({ ...draft, base: 'FREE_TRIAL_15' }), SalesSnapshotError);
    // ENTERPRISE has no Price, so the one-time Checkout could never bill it.
    assert.throws(() => buildDealSnapshot({ ...draft, base: 'ENTERPRISE_1999' }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, base: 'NOT_A_TIER' }), SalesSnapshotError);
  });

  it('holds the customer-facing note to the S24 rules', () => {
    assert.throws(() => buildDealSnapshot({ ...draft, description: '' }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, description: 'x'.repeat(201) }), SalesSnapshotError);
    // "+" is banned in customer copy; the Owner rule is to write "และ".
    assert.throws(() => buildDealSnapshot({ ...draft, description: 'CRM + สต็อก' }), SalesSnapshotError);
  });

  it('takes a blank AI credit as inherit and refuses zero (D-P3-2)', () => {
    assert.equal(buildDealSnapshot({ ...draft, aiMonthlyBudgetSatang: 1 }).aiMonthlyBudgetSatang, 1);
    // Closing AI is removing the `ai_line_assistant` menu; the platform's only budget writer
    // refuses zero on purpose, so a deal must not be able to store one.
    assert.throws(() => buildDealSnapshot({ ...draft, aiMonthlyBudgetSatang: 0 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, aiMonthlyBudgetSatang: -1 }), SalesSnapshotError);
  });

  it('requires a bounded, non-blank reason', () => {
    assert.equal(requireReason('  ลูกค้าเก่า  '), 'ลูกค้าเก่า');
    assert.throws(() => requireReason('   '), SalesSnapshotError);
    assert.throws(() => requireReason('x'.repeat(501)), SalesSnapshotError);
  });
});

describe('the approval notice pushed to shop owners (S19/R14)', () => {
  // The rule that is easiest to break by accident and hardest to notice: no prices on LINE.
  // Arabic AND Thai digits, because Thai copy can carry ๐-๙ and a regex over 0-9 would miss it.
  const NO_DIGITS = /^[^0-9\u0E50-\u0E59]*$/;

  it('carries no digit of any script, with or without a link', () => {
    assert.match(SALES_OFFER_NOTICE_TH, NO_DIGITS);
    assert.match(salesOfferNoticeText(undefined, 'co-1'), NO_DIGITS);
    // A shop id is allowed to contain digits, so only the SENTENCE is checked once a link exists.
    const [sentence] = salesOfferNoticeText('https://app.example.test', 'co-123').split('\n');
    assert.match(sentence!, NO_DIGITS);
    // Nothing that looks like money, a tier or a countdown.
    assert.equal(/บาท|฿|เดือน|วัน|สาขา|ใบ/.test(SALES_OFFER_NOTICE_TH), false);
  });

  it('links only into the shop own tree on the configured origin', () => {
    assert.equal(
      tenantBillingLink('https://app.example.test', 'co-1'),
      'https://app.example.test/companies/co-1/billing',
    );
    // A shop id that tries to climb out is encoded, never resolved.
    const escaped = tenantBillingLink('https://app.example.test', '../../evil');
    assert.equal(escaped, 'https://app.example.test/companies/..%2F..%2Fevil/billing');
    assert.ok(escaped!.startsWith('https://app.example.test/companies/'));
  });

  it('sends the sentence alone rather than a bad link when no safe base URL exists', () => {
    for (const base of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://app.example.test']) {
      assert.equal(tenantBillingLink(base, 'co-1'), undefined, `base ${String(base)}`);
      assert.equal(salesOfferNoticeText(base, 'co-1'), SALES_OFFER_NOTICE_TH);
    }
  });

  it('puts the link on its own line so the sentence stays readable in a chat bubble', () => {
    const lines = salesOfferNoticeText('https://app.example.test', 'co-1').split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], SALES_OFFER_NOTICE_TH);
    assert.equal(lines[1], 'https://app.example.test/companies/co-1/billing');
  });
});

describe('over-limit preview (S31)', () => {
  it('reports how far the shop already exceeds the deal, never a negative', () => {
    const snapshot = { branchLimit: 2, employeeLimit: 5 };
    assert.deepEqual(overLimitCounts(snapshot, { branchCount: 3, employeeCount: 9 }), { branches: 1, employees: 4 });
    assert.deepEqual(overLimitCounts(snapshot, { branchCount: 1, employeeCount: 2 }), { branches: 0, employees: 0 });
  });
});

// ── Phase 5: the auto-renew switch (D-P5-1) ────────────────────────────────────────────

describe('auto-renewing deal form (D-P5-1)', () => {
  const auto = { ...draft, autoRenew: true, cadence: 'month', cycles: 6 };

  it('freezes the switch, the cadence and the cycle count', () => {
    const snapshot = buildDealSnapshot(auto);
    assert.equal(snapshot.version, 3);
    assert.equal(snapshot.autoRenew, true);
    assert.equal(snapshot.cadence, 'month');
    assert.equal(snapshot.cycles, 6);
    // "จนกว่าจะเพิกถอน" is a real choice, not a missing field.
    assert.equal(buildDealSnapshot({ ...auto, cycles: null }).cycles, null);
    assert.equal(buildDealSnapshot({ ...auto, cadence: 'year' }).cadence, 'year');
  });

  it('refuses a switch the billing side could not charge', () => {
    // Stripe recurring prices are month or year; a "week" deal would fail at Checkout, not here.
    assert.throws(() => buildDealSnapshot({ ...auto, cadence: 'week' }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...auto, cadence: null }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...auto, cycles: 0 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...auto, cycles: 37 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...auto, cycles: 1.5 }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...auto, autoRenew: 'yes' }), SalesSnapshotError);
    // A half-filled form: the switch is off but the cadence stayed behind.
    assert.throws(() => buildDealSnapshot({ ...draft, cadence: 'month' }), SalesSnapshotError);
    assert.throws(() => buildDealSnapshot({ ...draft, cycles: 6 }), SalesSnapshotError);
  });

  it('reads a stored row defensively: a v2 row is a one-time deal, never a charge', () => {
    assert.deepEqual(autoRenewOf(buildDealSnapshot(auto)), { autoRenew: true, cadence: 'month', cycles: 6 });
    assert.deepEqual(autoRenewOf(buildDealSnapshot(draft)), { autoRenew: false, cadence: null, cycles: null });
    assert.deepEqual(autoRenewOf(null), { autoRenew: false, cadence: null, cycles: null });
    // The switch alone is not enough — an unreadable cadence reads as "not auto-renewing".
    assert.deepEqual(autoRenewOf({ autoRenew: true, cadence: 'week' } as never),
      { autoRenew: false, cadence: null, cycles: null });
    assert.deepEqual(autoRenewOf({ autoRenew: true, cadence: 'year', cycles: 999 } as never),
      { autoRenew: true, cadence: 'year', cycles: null });
  });
});

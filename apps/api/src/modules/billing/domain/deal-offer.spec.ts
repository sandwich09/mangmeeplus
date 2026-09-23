import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SalesDealSnapshot } from '@watchdog-bms/contracts';
import { assertDealOfferUnchanged, assertDealSnapshot, autoRenewDealOffer, dealOffer, dealPurchaseModes,
  dealReturnAt, dealSnapshot, dealSnapshotHash, type DealRequestRow, type DealSource } from './deal-offer';
import { fullPackagePurchaseImpact } from './billing-package';

const snapshot: SalesDealSnapshot = { version: 2, base: 'BASIC_499', priceSatang: 149900, months: 6,
  branchLimit: 3, employeeLimit: 10, monthlySlipLimit: 100, featureKeys: ['crm'], aiMonthlyBudgetSatang: null,
  description: 'ข้อเสนอพิเศษสำหรับร้านคุณ' };
const now = new Date('2026-09-21T00:00:00.000Z');
const row: DealRequestRow = { id: 'deal_1', companyId: 'company_1', kind: 'SALES_DEAL', status: 'APPROVED',
  salesUserId: 'sales_1', offerSnapshotJson: snapshot, offerExpiresAt: new Date('2026-09-24T00:00:00.000Z') };
const pinned: DealSource = { requestId: 'deal_1', snapshotHash: dealSnapshotHash(snapshot), months: 6,
  salesUserId: 'sales_1', aiMonthlyBudgetSatang: null };
const code = (error: unknown) => ((error as { getResponse(): { code?: string } }).getResponse()).code;
const throwsWith = (expected: string, run: () => unknown) =>
  assert.throws(run, (error: unknown) => code(error) === expected, expected);

test('a deal is one offer of N months, priced and stocked as the team sold it', () => {
  const offer = dealOffer(snapshot);
  assert.equal(offer.offerKey, 'BASIC_499');
  assert.equal(offer.interval, 'month');
  assert.equal(offer.intervalCount, 6);
  assert.equal(offer.priceSatang, 149900);
  assert.equal(offer.receiptAllowance, 600);
  assert.equal(offer.receiptAllowanceCadence, 'PAID_PERIOD');
  assert.equal(offer.branchLimit, 3);
  assert.equal(offer.employeeLimit, 10);
  assert.equal(offer.monthlySlipLimit, 100);
  assert.equal(offer.availability, 'AVAILABLE');
  assert.equal(offer.reason, null);
  assert.match(offer.label, /ข้อเสนอพิเศษ$/);
});

test('N months are appended once, so the anchor day survives February and short months', () => {
  const paidAt = new Date('2026-01-31T10:00:00.000Z');
  const months = (count: number, start = paidAt, paidThrough: Date | null = null, anchorDay?: number) =>
    fullPackagePurchaseImpact({ tier: 'BASIC_499', interval: 'month', offer: dealOffer({ ...snapshot, months: count }),
      verifiedPaidAt: start, paidThrough, remainingPaidReceipts: 0, anchorDay }).paidThrough.toISOString();
  // 31 Jan + 3 months is 30 Apr, not 30 Apr reached through 28 Feb.
  assert.equal(months(3), '2026-04-30T10:00:00.000Z');
  assert.equal(months(1), '2026-02-28T10:00:00.000Z');
  // Twelve months is the same date next year, leap years included.
  assert.equal(months(12, new Date('2024-02-29T10:00:00.000Z')), '2025-02-28T10:00:00.000Z');
  assert.equal(months(36), '2029-01-31T10:00:00.000Z');
  // Appending after a running one-time term keeps that term's anchor day (§19.3).
  assert.equal(months(2, paidAt, new Date('2026-03-31T10:00:00.000Z'), 31), '2026-05-31T10:00:00.000Z');
});

test('the pinned hash ignores the key order PostgreSQL happens to store', () => {
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
  assert.equal(dealSnapshotHash(reordered), dealSnapshotHash(snapshot));
  assert.notEqual(dealSnapshotHash({ ...snapshot, priceSatang: 1 }), dealSnapshotHash(snapshot));
});

test('only this company\'s live APPROVED row may be quoted, and only at its pinned price', () => {
  assert.equal(assertDealSnapshot(row, 'company_1', now, pinned).priceSatang, 149900);
  assertDealOfferUnchanged(assertDealSnapshot(row, 'company_1', now), dealOffer(snapshot));

  throwsWith('BILLING_DEAL_NOT_FOUND', () => assertDealSnapshot(null, 'company_1', now));
  throwsWith('BILLING_DEAL_NOT_FOUND', () => assertDealSnapshot(row, 'company_2', now));
  throwsWith('BILLING_DEAL_NOT_FOUND', () => assertDealSnapshot({ ...row, kind: 'CUSTOMER_REQUEST' }, 'company_1', now));
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'PAID', 'APPLIED', 'CANCELLED', 'REJECTED'])
    throwsWith('BILLING_DEAL_NOT_FOUND', () => assertDealSnapshot({ ...row, status }, 'company_1', now));
  throwsWith('BILLING_DEAL_NOT_FOUND', () => assertDealSnapshot({ ...row, salesUserId: null }, 'company_1', now));

  // S46: expiry is judged when the quote or the Checkout session is made, to the millisecond.
  assert.ok(assertDealSnapshot(row, 'company_1', new Date('2026-09-23T23:59:59.999Z')));
  throwsWith('BILLING_DEAL_EXPIRED', () => assertDealSnapshot(row, 'company_1', new Date('2026-09-24T00:00:00.000Z')));

  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot({ ...row, offerSnapshotJson: null }, 'company_1', now));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () =>
    assertDealSnapshot({ ...row, offerSnapshotJson: { ...snapshot, version: 1 } }, 'company_1', now));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () =>
    assertDealSnapshot({ ...row, offerSnapshotJson: { ...snapshot, priceSatang: 0 } }, 'company_1', now));
  // A deal edited after the quote was priced cannot be paid at the old snapshot.
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () =>
    assertDealSnapshot({ ...row, offerSnapshotJson: { ...snapshot, priceSatang: 100 } }, 'company_1', now, pinned));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(row, 'company_1', now, { ...pinned, months: 7 }));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(row, 'company_1', now, { ...pinned, requestId: 'deal_2' }));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(row, 'company_1', now, { ...pinned, salesUserId: 'sales_2' }));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(row, 'company_1', now, { ...pinned, aiMonthlyBudgetSatang: 5000 }));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealOfferUnchanged(snapshot, dealOffer({ ...snapshot, priceSatang: 1 })));
});

test('the deal card offers exactly the one-time modes whose gates are open (S37/S39)', () => {
  assert.deepEqual(dealPurchaseModes({ new_sales: true, card_once: true, promptpay_once: true }), ['CARD_ONCE', 'PROMPTPAY_ONCE']);
  assert.deepEqual(dealPurchaseModes({ new_sales: true, card_once: true }), ['CARD_ONCE']);
  assert.deepEqual(dealPurchaseModes({ new_sales: true, promptpay_once: true }), ['PROMPTPAY_ONCE']);
  // Both gates closed: the card says "ติดต่อทีมงาน" rather than opening a Checkout that refuses.
  assert.deepEqual(dealPurchaseModes({ new_sales: true }), []);
  assert.deepEqual(dealPurchaseModes({ card_once: true, promptpay_once: true }), []);
  // Auto-renewing families are never a deal mode in Phase 3.
  assert.deepEqual(dealPurchaseModes({ new_sales: true, promptpay_renew: true }), []);
});

// ── Phase 5: auto-renewing deals (D-P5-1…D-P5-6) ───────────────────────────────────────

const auto: SalesDealSnapshot = { ...snapshot, version: 3, autoRenew: true, cadence: 'month', cycles: 6,
  priceSatang: 29900, months: 1 };

test('an auto-renewing deal is ONE cycle at the cadence, never N months (D-P5-2)', () => {
  const monthly = dealOffer(auto);
  assert.equal(monthly.interval, 'month');
  // `assertStripePrice` refuses anything but 1, so the deal price can only ever be per cycle.
  assert.equal(monthly.intervalCount, 1);
  assert.equal(monthly.priceSatang, 29900);
  assert.equal(monthly.receiptAllowance, 100);

  const yearly = autoRenewDealOffer(auto, 'year');
  assert.equal(yearly.interval, 'year');
  assert.equal(yearly.intervalCount, 1);
  // A yearly cycle buys twelve months of slips at once, exactly like the catalog year offer.
  assert.equal(yearly.receiptAllowance, 1200);
  assert.equal(yearly.priceSatang, 29900);

  // `months` is ignored while the switch is on: 36 of them change nothing.
  assert.equal(dealOffer({ ...auto, months: 36 }).intervalCount, 1);
  // …and a one-time deal is untouched by the new fields being absent.
  assert.equal(dealOffer(snapshot).intervalCount, 6);
});

test('a v3 snapshot reads back whole, and a v2 one reads back as a one-time deal', () => {
  assert.equal(dealSnapshot({ ...auto }).cadence, 'month');
  assert.equal(dealSnapshot({ ...auto }).cycles, 6);
  assert.equal(dealSnapshot({ ...auto, cycles: null }).cycles, null);
  // The Phase 3 row shape is still readable and is NOT auto-renewing.
  assert.equal(dealSnapshot({ ...snapshot }).autoRenew, false);
  assert.equal(dealSnapshot({ ...snapshot }).cadence, null);
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => dealSnapshot({ ...auto, version: 5 }));
  // A switch that is on with an unusable cadence must never become a recurring charge.
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => dealSnapshot({ ...auto, cadence: 'week' }));
});

test('v4 pins CHAT credit while v2/v3 keep their legacy TOTAL meaning', () => {
  const current = { ...auto, version: 4 as const, aiMonthlyBudgetSatang: 8000 };
  assert.equal(dealSnapshot(current).version, 4);
  assert.equal(dealSnapshot(auto).version, 3);
  const currentRow = { ...row, offerSnapshotJson: current };
  const pinnedChat = { ...pinned, snapshotHash: dealSnapshotHash(current), months: current.months,
    aiMonthlyBudgetSatang: 8000, creditScope: 'CHAT' as const, cadence: 'month' as const, cycles: 6 };
  assert.equal(assertDealSnapshot(currentRow, 'company_1', now, pinnedChat).version, 4);
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(currentRow, 'company_1', now,
    { ...pinnedChat, creditScope: 'TOTAL' }));
});

test('the return date is the end of cycle N, on the anchor day (D-P5-6)', () => {
  const start = new Date('2026-01-31T10:00:00.000Z');
  assert.equal(dealReturnAt(start, 'month', 6, 31)!.toISOString(), '2026-07-31T10:00:00.000Z');
  // Walking six months at once keeps 31 Jan -> 31 Jul instead of collapsing on February.
  assert.equal(dealReturnAt(start, 'month', 1, 31)!.toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(dealReturnAt(new Date('2024-02-29T10:00:00.000Z'), 'year', 1)!.toISOString(), '2025-02-28T10:00:00.000Z');
  assert.equal(dealReturnAt(start, 'year', 2, 31)!.toISOString(), '2028-01-31T10:00:00.000Z');
  // Until revoked: there is no date until a lead presses "จบดีล".
  assert.equal(dealReturnAt(start, 'month', null), null);
});

test('an auto deal is sold on the renewing modes, a one-time deal never is (D-P5-4/Q8)', () => {
  const open = { new_sales: true, card_once: true, promptpay_once: true, promptpay_renew: true };
  assert.deepEqual(dealPurchaseModes(open, auto), ['CARD_AUTO', 'PROMPTPAY_RENEW']);
  assert.deepEqual(dealPurchaseModes(open, snapshot), ['CARD_ONCE', 'PROMPTPAY_ONCE']);
  // CARD_AUTO rides `new_sales` itself; only the QR-every-cycle mode has its own gate.
  assert.deepEqual(dealPurchaseModes({ new_sales: true }, auto), ['CARD_AUTO']);
  assert.deepEqual(dealPurchaseModes({ promptpay_renew: true }, auto), []);
  // No snapshot at all is the old call shape and still answers for a one-time deal.
  assert.deepEqual(dealPurchaseModes(open), ['CARD_ONCE', 'PROMPTPAY_ONCE']);
});

test('a quote pinned to one cadence cannot be paid at another (D-P5-1)', () => {
  const autoRow: DealRequestRow = { ...row, offerSnapshotJson: auto };
  const autoPinned: DealSource = { requestId: 'deal_1', snapshotHash: dealSnapshotHash(auto), months: 1,
    salesUserId: 'sales_1', aiMonthlyBudgetSatang: null, cadence: 'month', cycles: 6 };
  assert.equal(assertDealSnapshot(autoRow, 'company_1', now, autoPinned).cadence, 'month');
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(autoRow, 'company_1', now, { ...autoPinned, cadence: 'year' }));
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(autoRow, 'company_1', now, { ...autoPinned, cycles: null }));
  // A one-time quote can never be replayed against a row that has become auto-renewing.
  throwsWith('BILLING_DEAL_SNAPSHOT_MISMATCH', () => assertDealSnapshot(autoRow, 'company_1', now, pinned));
});

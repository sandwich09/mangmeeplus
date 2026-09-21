import { it } from 'node:test';
import assert from 'node:assert/strict';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealMenuLabels } from './billing-deal';

const offer = (over: Record<string, unknown> = {}) => ({
  deal: {
    dealId: 'deal-1', base: 'PRO_999', baseLabel: 'มืออาชีพ · ข้อเสนอพิเศษ', priceSatang: 599_000, months: 12,
    branchLimit: 3, employeeLimit: 10, monthlySlipLimit: 500, featureKeys: ['expenses'], aiMonthlyBudgetSatang: 80_000,
    description: 'ราคาพิเศษ', offerExpiresAt: '2026-09-24T00:00:00.000Z', purchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'],
    ...over,
  },
});
const now = Date.parse('2026-09-21T00:00:00.000Z');

it('shows a deal only while it can still be paid, with its own one-time modes', () => {
  assert.equal(billingDeal(offer(), now)?.dealId, 'deal-1');
  assert.deepEqual(billingDeal(offer(), now)?.purchaseModes, ['CARD_ONCE', 'PROMPTPAY_ONCE']);
  // R4/S46: three days is the whole offer, so an expired card must not keep a button on screen.
  assert.equal(billingDeal(offer({ offerExpiresAt: '2026-09-20T00:00:00.000Z' }), now), null);
  assert.equal(billingDeal(offer({ offerExpiresAt: null }), now), null);
  assert.equal(billingDeal({}, now), null);
  assert.equal(billingDeal(null, now), null);
  assert.equal(billingDeal(offer({ dealId: 12 }), now), null);
  // S39: never the account's `availablePurchaseModes` — renewing and unknown modes are dropped,
  // and dropping them all is what turns the card into "ติดต่อทีมงาน" (S37).
  assert.deepEqual(billingDeal(offer({ purchaseModes: ['CARD_AUTO', 'PROMPTPAY_RENEW', 'CARD_ONCE'] }), now)?.purchaseModes, ['CARD_ONCE']);
  assert.deepEqual(billingDeal(offer({ purchaseModes: [] }), now)?.purchaseModes, []);
  assert.deepEqual(billingDeal(offer({ purchaseModes: undefined }), now)?.purchaseModes, []);
});

it('carries the whole offer, so the card draws from the status alone', () => {
  const card = billingDeal(offer(), now)!;
  assert.equal(card.branchLimit, 3);
  assert.equal(card.monthlySlipLimit, 500);
  assert.deepEqual(card.featureKeys, ['expenses']);
  assert.equal(card.description, 'ราคาพิเศษ');
});

it('reads the deal a quote was priced from — or an attempt paid for — and ignores a catalog one', () => {
  assert.equal(billingQuoteDeal({ deal: { dealId: 'deal-1', months: 12 } })?.months, 12);
  assert.equal(billingQuoteDeal({ deal: { dealId: 'deal-1', baseLabel: 'มืออาชีพ', months: 12 } })?.baseLabel, 'มืออาชีพ');
  assert.equal(billingQuoteDeal({}), null);
  assert.equal(billingQuoteDeal(null), null);
  assert.equal(billingQuoteDeal({ deal: { dealId: 'deal-1' } }), null);
});

it('names the menus and the AI credit the customer is buying', () => {
  assert.deepEqual(dealMenuLabels(['expenses']), ['ค่าใช้จ่ายและใบเสร็จ']);
  // A menu counts only when every key behind it is sold: คู่ค้า needs both of its keys.
  assert.equal(dealMenuLabels(['expenses']).includes('คู่ค้า'), false);
  assert.equal(dealMenuLabels(['expenses', 'sales_documents']).includes('คู่ค้า'), true);
  assert.deepEqual(dealMenuLabels([]), []);
  assert.deepEqual(dealMenuLabels(null), []);

  assert.equal(dealAiCreditText(null), 'ใช้ค่าเริ่มต้นของแพ็กเกจ');
  assert.equal(dealAiCreditText(undefined), 'ใช้ค่าเริ่มต้นของแพ็กเกจ');
  assert.equal(dealAiCreditText(0), 'ปิดการใช้งาน AI');
  assert.equal(dealAiCreditText(80_000), '800.00 บาท / เดือน');
});


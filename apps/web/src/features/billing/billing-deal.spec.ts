import { it } from 'node:test';
import assert from 'node:assert/strict';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealMenuLabels, dealSlip, slipBankAccount } from './billing-deal';

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


it('holds the deal card while a bank slip is being checked, and re-opens it on a refusal (Q9)', () => {
  // Nothing sent yet: the shop may pay online or transfer, and neither is blocked.
  const fresh = dealSlip({});
  assert.equal(fresh.state, null);
  assert.equal(fresh.blocksPayment, false);
  assert.equal(fresh.canUpload, true);

  // Sent: one deal must not be paid twice, so every pay control goes away until a person answers.
  const pending = dealSlip({ slipState: 'PENDING' });
  assert.equal(pending.blocksPayment, true);
  assert.equal(pending.canUpload, false);
  assert.match(pending.message!, /รอทีมงานตรวจ/);
  assert.equal(dealSlip({ slipState: 'VERIFIED' }).blocksPayment, true);

  // Refused: the reviewer's words are the only way the shop learns what to fix, and it may retry.
  const rejected = dealSlip({ slipState: 'REJECTED', slipRejectedReason: 'ยอดไม่ตรง' });
  assert.equal(rejected.canUpload, true);
  assert.equal(rejected.blocksPayment, false);
  assert.equal(rejected.reason, 'ยอดไม่ตรง');
  // A reason only ever belongs to a refusal — never carried over onto a pending slip.
  assert.equal(dealSlip({ slipState: 'PENDING', slipRejectedReason: 'เก่า' }).reason, null);
  assert.equal(dealSlip({ slipState: 'SOMETHING_NEW' }).state, null);
});

it('shows bank details only once the Owner has replaced the masked placeholder', () => {
  const real = { bankName: 'กสิกรไทย', accountName: 'บจก. มั่งมี', accountNumber: '123-4-56789-0', note: 'โอนแล้วแนบสลิป' };
  assert.deepEqual(slipBankAccount(real), real);
  // The contract ships `xxx-x-xxxxx-x` until the Owner fills it in. Showing that to somebody about
  // to transfer money is a support call, so it reads as "no account" and the panel says to call.
  assert.equal(slipBankAccount({ ...real, accountNumber: 'xxx-x-xxxxx-x' }), null);
  assert.equal(slipBankAccount({ ...real, accountNumber: '' }), null);
  // The shipped constant is the default argument, so this asserts what production renders today.
  assert.equal(slipBankAccount(), null);
});

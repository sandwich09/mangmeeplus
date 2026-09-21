import { it } from 'node:test';
import assert from 'node:assert/strict';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealConfirmText, dealMenuLabels, dealRenewalText, dealSlip, slipBankAccount } from './billing-deal';

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
  // The shipped constant is the default argument, so this asserts what production renders today:
  // the Owner has now filled the account in, so the transfer route is offered rather than a phone
  // number. Put a mask back into the contract and the assertions above take over again.
  assert.notEqual(slipBankAccount(), null);
  assert.match(slipBankAccount()!.accountNumber, /^[\d\s-]+$/);
});

it('sells an auto-renewing deal with the renewing modes only, and a one-time deal with neither (D-P5-4)', () => {
  const auto = offer({ autoRenew: true, cadence: 'month', cycles: 12, purchaseModes: ['CARD_AUTO', 'PROMPTPAY_RENEW', 'CARD_ONCE'] });
  assert.deepEqual(billingDeal(auto, now)?.purchaseModes, ['CARD_AUTO', 'PROMPTPAY_RENEW']);
  // A deal is one family or the other: paying an auto-renewing offer once would open a term the
  // shop is then charged for again, so the wrong-family mode is dropped, not offered.
  assert.deepEqual(billingDeal(offer({ purchaseModes: ['CARD_AUTO', 'CARD_ONCE'] }), now)?.purchaseModes, ['CARD_ONCE']);
  const card = billingDeal(auto, now)!;
  assert.equal(card.autoRenew, true);
  assert.equal(card.cycles, 12);
  // A status written before Phase 5 carries none of the three and must read as a one-time deal.
  assert.equal(billingDeal(offer(), now)?.autoRenew, false);
  assert.equal(billingDeal(offer({ autoRenew: true, cadence: 'week', cycles: 0 }), now)?.cadence, 'month');
  assert.equal(billingDeal(offer({ autoRenew: true, cycles: 0 }), now)?.cycles, null);
});

it('promises the customer exactly what their chosen mode does, every cycle (§17.3/Q8)', () => {
  const once = { autoRenew: false, cadence: 'month' as const, cycles: null };
  assert.equal(dealRenewalText(once, 'CARD_ONCE'), 'จ่ายครั้งเดียว ไม่มีหักอัตโนมัติ');
  // Card takes the money by itself; QR only sends a bill somebody has to scan. Same deal, two
  // different promises — so the sentence follows the mode, not the deal alone.
  const monthly = { autoRenew: true, cadence: 'month' as const, cycles: null };
  assert.match(dealRenewalText(monthly, 'CARD_AUTO'), /ตัดบัตรอัตโนมัติทุกเดือน ที่ราคานี้ · ยกเลิกได้จากหน้าแพ็กเกจ/);
  assert.match(dealRenewalText(monthly, 'PROMPTPAY_RENEW'), /ออกบิล QR ทุกเดือน ที่ราคานี้ · สแกนจ่ายเอง/);
  assert.doesNotMatch(dealRenewalText(monthly, 'CARD_AUTO'), /รอบ แล้วกลับราคาปกติ/);
  // A fixed-cycle deal must say when the special price stops, on the card and on the confirm page.
  const yearly = { autoRenew: true, cadence: 'year' as const, cycles: 3 };
  assert.match(dealRenewalText(yearly, 'CARD_AUTO'), /ทุกปี ที่ราคานี้ · ยกเลิกได้จากหน้าแพ็กเกจ · 3 รอบ แล้วกลับราคาปกติ$/);
  assert.equal(dealConfirmText(monthly), 'ต่ออายุอัตโนมัติที่ราคาข้อเสนอพิเศษ ทุกเดือน');
  assert.equal(dealConfirmText(yearly), 'ต่ออายุอัตโนมัติที่ราคาข้อเสนอพิเศษ ทุกปี · 3 รอบ แล้วกลับราคาปกติ');
});

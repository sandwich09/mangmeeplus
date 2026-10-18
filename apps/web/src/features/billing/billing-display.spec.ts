import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingTimelineEntry } from '@watchdog-bms/contracts';
import { billingDeliveryLabel, billingIssueLabel, billingLabel, billingPermissionLabel, billingPurchaseModeLabel, billingRenewalLine, billingSupportReference, billingTimelineLabel,billingLeavesPage,billingMonthlyAllowanceText } from './billing-display';
import type {MouseEvent} from 'react';

test('only navigation in this tab abandons pending billing work; same links and modified clicks remain active',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{location:new URL('https://app.example.test/system/billing?cursor=1')}});
  const event={button:0,currentTarget:{href:'https://app.example.test/system/billing/batches',target:''}};
  try{
    assert.equal(billingLeavesPage(event as MouseEvent<HTMLAnchorElement>),true);
    for(const modifier of ['metaKey','ctrlKey','shiftKey','altKey','defaultPrevented'])assert.equal(billingLeavesPage({...event,[modifier]:true} as MouseEvent<HTMLAnchorElement>),false);
    assert.equal(billingLeavesPage({...event,button:1} as MouseEvent<HTMLAnchorElement>),false);
    assert.equal(billingLeavesPage({...event,currentTarget:{...event.currentTarget,target:'_blank'}} as MouseEvent<HTMLAnchorElement>),false);
    assert.equal(billingLeavesPage({...event,currentTarget:{href:'https://app.example.test/system/billing?cursor=1#details',target:''}} as MouseEvent<HTMLAnchorElement>),false);
    assert.equal(billingLeavesPage({...event,currentTarget:{href:'https://app.example.test/system/billing?cursor=2',target:''}} as MouseEvent<HTMLAnchorElement>),false);
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

test('the number a shop owner reads to the team is short and human, never a row id', () => {
  const short = billingSupportReference('9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f');
  assert.equal(short, '2C3D-4E5F');
  assert.doesNotMatch(short!, /-.*-/);
  assert.equal(billingSupportReference('att_01J9ZK7Q8VXY2ABCDEFGH'), 'ABCD-EFGH');
  // An invoice number is already readable over the phone, so it is shown as it is.
  assert.equal(billingSupportReference('PREVIEW-0001'), 'PREVIEW-0001');
  assert.equal(billingSupportReference(null), null);
  assert.equal(billingSupportReference(''), null);
});

test('every purchase mode has Thai wording, with no enum name left on screen', () => {
  for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'] as const) {
    assert.doesNotMatch(billingPurchaseModeLabel(mode), /[A-Z_]{4,}/);
  }
  assert.equal(billingPurchaseModeLabel('PROMPTPAY_ONCE'), 'พร้อมเพย์ QR · จ่ายครั้งเดียว');
});

// 2026-10-10: the renewal panel also opens for a one-time shop with a prepaid package waiting, and said "ต่ออายุอัตโนมัติเปิดอยู่" to it.
test('the renewal panel states the renewal only for a shop that has one, in the words of its way of renewing', () => {
  const line = (renewalMode: Parameters<typeof billingRenewalLine>[0]['renewalMode'], over: { cancelAtPeriodEnd?: boolean; collectionPause?: boolean } = {}) =>
    billingRenewalLine({ cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false, collectionPause: over.collectionPause ? { behavior: 'keep_as_draft', resumesAt: null } : null, renewalMode });
  assert.equal(line('CARD_AUTO'), 'ต่ออายุอัตโนมัติเปิดอยู่');
  assert.equal(line('PROMPTPAY_RENEW'), 'ระบบออกบิล QR ทุกงวด ต้องสแกนจ่ายเอง');
  assert.equal(line('CARD_AUTO', { cancelAtPeriodEnd: true }), 'หยุดต่ออายุแล้ว');
  assert.equal(line('PROMPTPAY_RENEW', { cancelAtPeriodEnd: true }), 'หยุดออกบิลแล้ว');
  assert.equal(line('CARD_AUTO', { collectionPause: true }), 'พักการเรียกเก็บเงินชั่วคราว');
  for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE', 'NONE', undefined] as const) assert.equal(line(mode), null, String(mode));
});

test('provider acceptance, destination delivery and web recording remain different facts', () => {
  assert.equal(billingDeliveryLabel('ACCEPTED','EMAIL'),'ผู้ให้บริการรับคำขอแล้ว');
  assert.equal(billingDeliveryLabel('ACCEPTED','EMAIL',true),'เซิร์ฟเวอร์ปลายทางรับอีเมลแล้ว');
  assert.equal(billingDeliveryLabel('SUPPRESSED','EMAIL',true),'พักส่งถึงผู้รับนี้');
  assert.equal(billingDeliveryLabel('SENT','WEB'),'บันทึกบนเว็บแล้ว');
  assert.equal(billingDeliveryLabel('SENT','LINE'),'ผู้ให้บริการรับคำขอแล้ว');
});
test('paid invoice with held access never displays a successful grant', () => {
  const entry = {kind:'INVOICE',state:'paid / HELD'} as BillingTimelineEntry;
  assert.equal(billingTimelineLabel(entry).state,'ชำระแล้ว · ต้องตรวจสอบก่อนเปิดสิทธิ์');
  assert.doesNotMatch(billingTimelineLabel({kind:'ATTEMPT',state:'COMPLETED'} as BillingTimelineEntry).state,/ชำระแล้ว|เปิดสิทธิ์แล้ว/);
});
test('unrecognized provider states stay readable without exposing technical content', () => {
  assert.equal(billingLabel('payment','new_provider_payload'),'ต้องตรวจสอบสถานะ');
  assert.equal(billingDeliveryLabel('new_provider_payload','EMAIL',true),'ต้องตรวจสอบสถานะ');
  for(const value of ['constructor','__proto__']) {
    assert.equal(billingIssueLabel(value),'รายการที่ต้องตรวจสอบ');
    assert.equal(billingPermissionLabel(`system.billing.${value}`),'สิทธิ์อื่นที่ต้องตรวจสอบ');
    assert.equal(billingTimelineLabel({kind:'OPERATION',type:value,state:'UNKNOWN'} as BillingTimelineEntry).title,'คำสั่งเกี่ยวกับการชำระเงิน');
  }
});


test('monthly receipts and fixed Admin gifts are described with separate renewal clocks',()=>{
  assert.equal(billingMonthlyAllowanceText({}),null);
  const text=billingMonthlyAllowanceText({monthlyAllowance:{limit:15,used:15,additionalRemaining:4,additionalExpiresAt:'2026-10-01T00:00:00.000Z'}})!;
  assert.match(text,/15 ใบต่อเดือน/);assert.match(text,/เหลือ 4 ใบ/);assert.match(text,/ไม่เติมใหม่ทุกเดือน/);assert.doesNotMatch(text,/19 ใบต่อเดือน/);
});

test('D1 all four purchase modes stay visible; policy, account availability and allowed actions keep their authority', async () => {
  const { billingPurchaseChoices } = await import('./billing-display');
  const status = { enabledPurchaseModes: ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'],
    availablePurchaseModes: ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'], allowedActions: ['new_sales'] } as any;
  assert.equal(billingPurchaseChoices(status).length, 4);
  assert.ok(billingPurchaseChoices(status).every(choice => !choice.disabled && !choice.reason));
  const closed = billingPurchaseChoices({ ...status, enabledPurchaseModes: ['CARD_AUTO'], availablePurchaseModes: ['CARD_AUTO'] });
  assert.equal(closed.length, 4);
  assert.ok(closed.filter(choice => choice.mode !== 'CARD_AUTO').every(choice => choice.disabled && choice.reason === 'ยังไม่เปิดใช้วิธีนี้'));
  const incompatible = billingPurchaseChoices({ ...status, availablePurchaseModes: ['CARD_AUTO'] });
  assert.ok(incompatible.filter(choice => choice.mode !== 'CARD_AUTO').every(choice => choice.disabled && !!choice.reason));
  assert.ok(billingPurchaseChoices({ ...status, allowedActions: [], purchaseBlockCode: 'BILLING_CHECKOUT_PENDING' }).every(choice => choice.disabled && !!choice.reason));
});

test('D1 only the two one-time modes accept by purchase button', async () => {
  const { billingOneTimePurchase } = await import('./billing-display');
  for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE'] as const) assert.equal(billingOneTimePurchase(mode), true);
  for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW', undefined] as const) assert.equal(billingOneTimePurchase(mode), false);
});

test('PAY-2 history separates received money, access, refunds and disputes without exposing provider states', async () => {
  const { billingHistoryStatus } = await import('./billing-display');
  const invoice = { paymentState: 'paid', applyState: 'APPLIED', amountSatang: 49900, refundedSatang: 0, disputed: false };
  assert.equal(billingHistoryStatus(invoice), 'จ่ายแล้ว');
  for (const applyState of ['PENDING', 'HELD', 'FAILED']) assert.equal(billingHistoryStatus({ ...invoice, applyState }), 'จ่ายแล้ว');
  assert.equal(billingHistoryStatus({ ...invoice, paymentState: 'open', applyState: 'APPLIED' }), 'รอผล');
  assert.equal(billingHistoryStatus({ ...invoice, refundedSatang: 100 }), 'คืนบางส่วน');
  assert.equal(billingHistoryStatus({ ...invoice, refundedSatang: 49900 }), 'คืนเงินแล้ว');
  assert.equal(billingHistoryStatus({ ...invoice, refundedSatang: 49900, disputed: true }), 'มีข้อโต้แย้ง');
});

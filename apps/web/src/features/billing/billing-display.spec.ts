import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingTimelineEntry } from '@watchdog-bms/contracts';
import { billingDeliveryLabel, billingIssueLabel, billingLabel, billingPermissionLabel, billingPurchaseModeLabel, billingSupportReference, billingTimelineLabel,billingLeavesPage,billingMonthlyAllowanceText } from './billing-display';
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

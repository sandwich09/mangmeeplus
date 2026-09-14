import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingTimelineEntry } from '@watchdog-bms/contracts';
import { billingDeliveryLabel, billingIssueLabel, billingLabel, billingPermissionLabel, billingTimelineLabel } from './billing-display';

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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { whtCertificateUnsupportedReason, whtFilingRouteHint } from './tax.js';

test('filing hints distinguish each accountant form, other income and separate PND2', () => {
  assert.equal(whtFilingRouteHint({ code: 'WHT_PRIZE', formType: 'PND3', filingRoute: 'SYSTEM_FILLS' }), null);
  assert.equal(whtFilingRouteHint({ code: 'WHT_INTEREST', formType: 'PND2', filingRoute: 'SEPARATE_PND2' }), 'ประเภทนี้ยื่น ภ.ง.ด.2 แยก ไม่อยู่ใน ภ.ง.ด.3');
  for (const [form, label] of [['PND3', 'ภ.ง.ด.3'], ['PND53', 'ภ.ง.ด.53']]) {
    assert.equal(whtFilingRouteHint({ code: 'fixture', formType: form, filingRoute: 'ACCOUNTANT_PREPARES' }), `ระบบยังกรอกประเภทนี้ลงแบบไม่ได้ ผู้ทำบัญชีต้องจัดทำ ${label} ของเดือนนี้เอง`);
  }
  for (const code of ['WHT_OTHER_IND', 'WHT_OTHER_JUR']) assert.equal(whtFilingRouteHint({ code, formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES' }), 'บอกผู้ทำบัญชีว่าเป็นเงินได้อะไร ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง');
});
test('only PND2 and dividend system certificates are blocked', () => {
  for (const code of ['WHT_INTEREST', 'WHT_DIVIDEND_IND', 'WHT_DIVIDEND']) assert.ok(whtCertificateUnsupportedReason(code));
  assert.ok(whtCertificateUnsupportedReason('fixture', 'PND2'));
  for (const code of ['WHT_PRIZE', 'WHT_PRIZE_JUR', 'WHT_INTEREST_JUR', 'WHT_OTHER_IND', 'WHT_OTHER_JUR']) assert.equal(whtCertificateUnsupportedReason(code), null);
});


test('WHT-OUTSIDE-2 payment progress keeps system wording and uses outside words for other shops', async () => {
  const { whtPaymentProgressText, WHT_OUTSIDE_BEFORE_PAYMENT } = await import('./tax.js');
  assert.equal(WHT_OUTSIDE_BEFORE_PAYMENT, 'บันทึกการจ่ายก่อน แล้วค่อยจดเลขที่ใบ 50 ทวิ');
  assert.equal(whtPaymentProgressText(false, false), 'จ่ายครบแล้ว ยังไม่ได้ทำใบ 50 ทวิ');
  assert.equal(whtPaymentProgressText(false, true), 'จ่ายครบ และทำใบ 50 ทวิ นอกระบบแล้ว');
  assert.equal(whtPaymentProgressText(true, false), 'จ่ายครบแล้ว ยังออกหนังสือรับรองไม่ครบ');
  assert.equal(whtPaymentProgressText(true, true), 'จ่ายครบและมีหนังสือรับรองแล้ว');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';
import { canReissueDisbursementVoucher, disbursementCancelledPaymentSentence, disbursementReissueConfirmation } from './disbursement-voucher-reissue.logic';
import { disbursementVoucherMenu } from './disbursement-voucher-journey.logic';
const detail = (canReissue = true, remaining = true): DisbursementVoucherDetail => ({
  header: { status: 'CANCELLED', cancelledAfterPaid: true }, actions: {}, canReissue, reissuedVoucher: null,
  lines: [{ expenseNumber: 'EX-1', expensePaymentId: 'payment-one', paymentInEffect: false },
    ...(remaining ? [{ expenseNumber: 'EX-2', expensePaymentId: 'payment-two', paymentInEffect: true }] : [])],
}) as DisbursementVoucherDetail;
test('reissue follows server authority, an unpaid cancellation cannot offer it, and an issued replacement cannot repeat it', () => {
  assert.equal(canReissueDisbursementVoucher(detail()), true);
  assert.equal(canReissueDisbursementVoucher(detail(false)), false);
  assert.equal(canReissueDisbursementVoucher(detail(true, false)), false);
  const draft = detail(); draft.header.status = 'DRAFT'; assert.equal(canReissueDisbursementVoucher(draft), false);
  const unpaid = detail(); unpaid.header.cancelledAfterPaid = false; assert.equal(canReissueDisbursementVoucher(unpaid), false);
  const replaced = detail(); replaced.reissuedVoucher = { id: null, documentNumber: 'DV-2' }; assert.equal(canReissueDisbursementVoucher(replaced), false);
});
test('cancelled payment sentences distinguish remaining payments and the viewers reissue right', () => {
  const base = 'ใบนี้ถูกยกเลิกเพราะมีการยกเลิกการจ่ายของรายการ EX-1 ';
  assert.equal(disbursementCancelledPaymentSentence(detail()), base + 'การจ่ายรายการอื่นยังอยู่ ออกใบใหม่สำหรับการจ่ายที่เหลือได้');
  assert.equal(disbursementCancelledPaymentSentence(detail(false)), base + 'การจ่ายรายการอื่นยังอยู่ ผู้มีสิทธิ์ออกใบสำคัญจ่ายออกใบใหม่สำหรับการจ่ายที่เหลือได้');
  assert.equal(disbursementCancelledPaymentSentence(detail(true, false)), base + 'ไม่มีการจ่ายที่ยังมีผลเหลือในใบนี้');
  const paid = detail(); paid.header.status = 'PAID'; assert.equal(disbursementCancelledPaymentSentence(paid), null);
  const replaced = detail(); replaced.reissuedVoucher = { id: 'new', documentNumber: 'DV-2' }; assert.equal(disbursementCancelledPaymentSentence(replaced), base.trim());
});
test('the more menu offers reissue only while the server allows an unreplaced paid cancellation', () => {
  assert.ok(disbursementVoucherMenu(detail()).includes('reissue' as never));
  assert.ok(!disbursementVoucherMenu(detail(false)).includes('reissue' as never));
});

test('reissue confirmation counts only payments still in effect and keeps the cancelled original', () => {
  const d = detail(); d.lines.push({ expensePaymentId: null, paymentInEffect: true } as any);
  assert.equal(disbursementReissueConfirmation(d), 'ออกใบสำคัญจ่ายใบใหม่สำหรับการจ่ายที่ยังมีผล 1 รายการ? ระบบจะออกเลขที่ใหม่ ใบเดิมยังอยู่ในสถานะยกเลิก');
  d.lines.push({ expensePaymentId: 'third', paymentInEffect: true } as any);
  assert.match(disbursementReissueConfirmation(d), /ยังมีผล 2 รายการ/);
});

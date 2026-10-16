import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISBURSEMENT_VOUCHER_STATUSES, DISBURSEMENT_VOUCHER_STATUS_LABELS } from '@watchdog-bms/contracts';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { disbursementVoucherDisplayAmount, disbursementSummaryPartial } from './disbursement-vouchers.logic';
import { canPrepareDisbursementVoucher, disbursementVoucherBadge, disbursementVoucherDateLine, disbursementVoucherDraftActions, disbursementVoucherListQuery, disbursementVoucherNextSentence, disbursementVoucherPrimaryLabel, disbursementVoucherSummary } from './disbursement-vouchers.logic';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';

test('summary preserves full source gross and withholding and the selected payout, including a partial payment', () => {
  const detail = { header: { totalAmount: '5200.0000' }, lines: [
    { grandTotalAmount: '10700.0000', whtAmount: '300.0000', amount: '5200.0000' },
  ] } as DisbursementVoucherDetail;
  assert.deepEqual(disbursementVoucherSummary(detail), { gross: '10700.0000', withholding: '300.0000', payout: '5200.0000' });
});

test('summary adds four-decimal source amounts exactly without floating point loss', () => {
  const detail = { header: { totalAmount: '0.3000' }, lines: [
    { grandTotalAmount: '99999999999999.9999', whtAmount: '0.1001' },
    { grandTotalAmount: '0.0001', whtAmount: '0.2002' },
  ] } as DisbursementVoucherDetail;
  assert.deepEqual(disbursementVoucherSummary(detail), { gross: '100000000000000.0000', withholding: '0.3003', payout: '0.3000' });
});

test('only a draft with the server action may be edited or deleted', () => {
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) {
    for (const edit of [false, true]) for (const remove of [false, true]) {
      const detail = { header: { status }, actions: { edit, delete: remove } } as DisbursementVoucherDetail;
      assert.deepEqual(disbursementVoucherDraftActions(detail), { edit: status === 'DRAFT' && edit, delete: status === 'DRAFT' && remove });
    }
  }
});

test('create requires prepare; read, approve and pay do not grant it', () => {
  assert.equal(canPrepareDisbursementVoucher(['expense.disbursement.prepare']), true);
  assert.equal(canPrepareDisbursementVoucher(['expense.disbursement.read', 'expense.disbursement.approve', 'expense.disbursement.pay']), false);
  assert.equal(canPrepareDisbursementVoucher([]), false);
});

test('primary labels follow every server action and paid documents open the voucher', () => {
  for (const [primaryAction, label] of [['submit', 'ส่งอนุมัติ'], ['approve', 'ตรวจและอนุมัติ'], ['pay', 'บันทึกว่าจ่ายแล้ว'], ['view', 'เปิดดู']] as const) {
    for (const status of DISBURSEMENT_VOUCHER_STATUSES.filter((status) => status !== 'PAID')) {
      assert.equal(disbursementVoucherPrimaryLabel({ primaryAction, status }), label);
    }
    assert.equal(disbursementVoucherPrimaryLabel({ primaryAction, status: 'PAID' }), 'ดูใบสำคัญจ่าย');
  }
});

test('web status words shorten approved to รอจ่าย and keep shared badge tones', () => {
  const tones = { DRAFT: 'slate', PENDING_APPROVAL: 'amber', APPROVED: 'sky', PAID: 'brand', CANCELLED: 'danger' };
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) {
    assert.deepEqual(disbursementVoucherBadge(status), { label: status === 'APPROVED' ? 'รอจ่าย' : DISBURSEMENT_VOUCHER_STATUS_LABELS[status], tone: tones[status] });
  }
});

test('list dates use paid, planned, then creation day in Bangkok for every status', () => {
  const row = { status: 'DRAFT' as const, plannedPayDate: null, paidDate: null, createdAt: '2026-10-11T17:30:00Z' };
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'] as const) {
    assert.equal(disbursementVoucherDateLine({ ...row, status }), formatThaiDate('2026-10-12'));
    assert.equal(disbursementVoucherDateLine({ ...row, status, plannedPayDate: '2026-10-01' }), `กำหนดจ่าย ${formatThaiDate('2026-10-01')}`);
  }
  assert.equal(disbursementVoucherDateLine({ ...row, status: 'PAID', plannedPayDate: '2026-10-01' }), null);
  assert.equal(disbursementVoucherDateLine({ ...row, status: 'PAID', paidDate: '2026-10-10' }), formatThaiDate('2026-10-10'));
  assert.equal(disbursementVoucherDateLine({ ...row, plannedPayDate: '2026-10-13' }), `กำหนดจ่าย ${formatThaiDate('2026-10-13')}`);
});

test('URL filters default to all and reject invalid pages or status values', () => {
  assert.deepEqual(disbursementVoucherListQuery(new URLSearchParams()), { filter: 'all', page: 1, q: '', order: 'newest' });
  assert.deepEqual(disbursementVoucherListQuery(new URLSearchParams('status=APPROVED&page=3&q=%20PV-1%20')), { filter: 'APPROVED', page: 3, q: 'PV-1', order: 'newest' });
  for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
    assert.deepEqual(disbursementVoucherListQuery(new URLSearchParams(`status=unknown&page=${page}`)), { filter: 'all', page: 1, q: '', order: 'newest' });
  }
});


test('header sentences use the fixed copy and omit cases whose required facts are absent', () => {
  const detail = { header: { status: 'DRAFT', paidDate: null }, actions: { submit: true, approve: false, pay: false }, revisions: [] } as unknown as DisbursementVoucherDetail;
  assert.equal(disbursementVoucherNextSentence(detail), 'ตรวจรายการ แล้วส่งให้ผู้อนุมัติ');
  detail.header.status = 'PENDING_APPROVAL';
  assert.equal(disbursementVoucherNextSentence(detail), 'รอผู้มีสิทธิ์อนุมัติ');
  detail.actions.approve = true; (detail.actions as any).return = true;
  assert.equal(disbursementVoucherNextSentence(detail), 'ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้');
  detail.header.status = 'APPROVED';
  assert.equal(disbursementVoucherNextSentence(detail), 'อนุมัติแล้ว รอผู้มีสิทธิ์บันทึกจ่าย');
  detail.actions.pay = true;
  assert.equal(disbursementVoucherNextSentence(detail), 'จ่ายเงินให้ผู้รับเงิน แล้วกลับมาบันทึกว่าจ่ายแล้ว');
  detail.header.status = 'PAID';
  assert.equal(disbursementVoucherNextSentence(detail), null);
  detail.header.paidDate = '2026-10-10';
  assert.equal(disbursementVoucherNextSentence(detail), `จ่ายเมื่อ ${formatThaiDate('2026-10-10')}`);
  detail.header.status = 'CANCELLED';
  assert.equal(disbursementVoucherNextSentence(detail), null);
  detail.revisions = [{ decision: 'CANCELLED', decidedAt: '2026-10-11T17:30:00Z', decisionReason: 'รายการซ้ำ' }] as DisbursementVoucherDetail['revisions'];
  assert.equal(disbursementVoucherNextSentence(detail), `ใบนี้ถูกยกเลิกเมื่อ ${formatThaiDate('2026-10-11T17:30:00Z')} เหตุผล: รายการซ้ำ`);
});

test('a draft viewer without send rights waits for the named preparer or sees the plain draft sentence', () => {
  const detail = { header: { status: 'DRAFT' }, actions: {}, preparerName: 'คุณสมใจ' } as DisbursementVoucherDetail;
  assert.equal(disbursementVoucherNextSentence(detail), 'ร่าง ยังไม่ได้ส่งอนุมัติ รอ คุณสมใจ ส่งอนุมัติ');
  detail.preparerName = null;
  assert.equal(disbursementVoucherNextSentence(detail), 'ร่าง ยังไม่ได้ส่งอนุมัติ');
});

test('the summary is flagged only when the amount differs from total less withholding', () => {
  assert.equal(disbursementSummaryPartial({ gross: '17500.0000', withholding: '150.0000', payout: '17350.00' }), false);
  assert.equal(disbursementSummaryPartial({ gross: '17500.0000', withholding: '150.0000', payout: '13350.00' }), true);
  assert.equal(disbursementSummaryPartial({ gross: '0.0000', withholding: '0.0000', payout: '0.00' }), false);
});
test('a numbered draft that someone else must send again does not claim it was never sent', () => {
  const detail = { header: { status: 'DRAFT', documentNumber: 'PV-1' }, actions: {}, preparerName: 'คุณสมใจ' } as DisbursementVoucherDetail;
  assert.equal(disbursementVoucherNextSentence(detail), 'นำกลับมาแก้ไข ยังไม่ได้ส่งอนุมัติอีกครั้ง รอ คุณสมใจ ส่งอนุมัติ');
  detail.preparerName = null;
  assert.equal(disbursementVoucherNextSentence(detail), 'นำกลับมาแก้ไข ยังไม่ได้ส่งอนุมัติอีกครั้ง');
});

test('displayed payout matches the print cancellation, partial and unchanged cases without floating-point rounding', () => {
  for (const cancelled of [false, true]) for (const partial of [false, true]) {
    const second = partial ? '50.0000' : '104.0000';
    const original = partial ? '154.0000' : '208.0000';
    const detail = { header: { status: cancelled ? 'CANCELLED' : 'PAID', cancelledAfterPaid: cancelled, totalAmount: original },
      lines: [{ amount: '104.0000', paymentInEffect: !cancelled }, { amount: second, paymentInEffect: true }] } as any;
    assert.deepEqual(disbursementVoucherDisplayAmount(detail), { amount: cancelled ? second : original, excludesCancelled: cancelled });
  }
  assert.equal(disbursementVoucherDisplayAmount({ header: { status: 'CANCELLED', cancelledAfterPaid: true, totalAmount: '0.3000' }, lines: [{ amount: '0.1000', paymentInEffect: true }, { amount: '0.2000', paymentInEffect: true }] } as any).excludesCancelled, false);
  assert.deepEqual(disbursementVoucherDisplayAmount({ header: { status: 'CANCELLED', cancelledAfterPaid: true, totalAmount: '10' }, lines: [{ amount: '10', paymentInEffect: false }] } as any), { amount: '0.0000', excludesCancelled: true });
  assert.deepEqual(disbursementVoucherDisplayAmount({ header: { status: 'CANCELLED', cancelledAfterPaid: false, totalAmount: '10' }, lines: [] } as any), { amount: '10', excludesCancelled: false });
});

test('date order accepts oldest and defaults every other URL value to newest', () => {
  assert.equal(disbursementVoucherListQuery(new URLSearchParams('order=oldest')).order, 'oldest');
  for (const order of ['', 'newest', 'DESC', 'invalid']) assert.equal(disbursementVoucherListQuery(new URLSearchParams({ order })).order, 'newest');
});

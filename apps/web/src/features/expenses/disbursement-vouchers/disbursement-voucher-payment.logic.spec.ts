import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISBURSEMENT_VOUCHER_STATUSES } from '@watchdog-bms/contracts';
import { disbursementPaymentCorrectionHint, disbursementWithholdingGroups, canPayDisbursementVoucher, disbursementCancelledPaymentLines, disbursementWithholdingLines, initialDisbursementPayment, disbursementPaymentDateError, disbursementPaymentMethodError, disbursementPaymentBody, disbursementVoucherDocumentHref } from './disbursement-voucher-payment.logic';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';

test('pay requires approved status and the server action', () => {
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) for (const pay of [false, true]) {
    const detail = { header: { status }, actions: { pay } } as DisbursementVoucherDetail;
    assert.equal(canPayDisbursementVoucher(detail), status === 'APPROVED' && pay);
  }
});
test('payment defaults use Bangkok today and the planned method', () => {
  for (const [at, day] of [['2026-10-11T16:59:59Z', '2026-10-11'], ['2026-10-11T17:00:00Z', '2026-10-12'], ['2026-10-12T00:00:00Z', '2026-10-12']] as const) {
    assert.deepEqual(initialDisbursementPayment({ plannedMethod: 'BANK_TRANSFER' }, new Date(at)), { paidDate: day, paymentMethod: 'BANK_TRANSFER', paidFromRef: '' });
  }
  assert.equal(initialDisbursementPayment({ plannedMethod: null }).paymentMethod, 'BANK_TRANSFER');
  for (const plannedMethod of ['CASH', 'CARD', 'CHEQUE', 'OTHER'] as const) assert.equal(initialDisbursementPayment({ plannedMethod }).paymentMethod, plannedMethod);
});
test('paying requires a method and uses the server sentence locally', () => {
  assert.equal(disbursementPaymentMethodError(''), 'เลือกวิธีจ่ายก่อนบันทึก');
  assert.equal(disbursementPaymentMethodError('CASH'), undefined);
});
test('future payment dates refuse locally using Bangkok days', () => {
  const now = new Date('2026-10-11T16:59:59Z');
  assert.equal(disbursementPaymentDateError('2026-10-12', now), 'วันที่จ่ายต้องไม่เกินวันนี้');
  assert.equal(disbursementPaymentDateError('2026-10-11', now), undefined);
  assert.equal(disbursementPaymentDateError('2026-10-10', now), undefined);
  assert.equal(disbursementPaymentDateError('2026-10-12', new Date('2026-10-11T17:00:00Z')), undefined);
});
test('clearing the actual payment date requires choosing it again before payment', () => {
  assert.equal(disbursementPaymentDateError(''), 'เลือกวันที่จ่ายจริงก่อนบันทึก');
});
test('payment bodies contain version and attempt but never amounts', () => {
  const base = { commandId: 'attempt', expectedVersion: 7 };
  assert.deepEqual(disbursementPaymentBody(base, { paidDate: '2026-10-12', paymentMethod: 'BANK_TRANSFER', paidFromRef: '  บัญชีร้าน  ' }),
    { ...base, paidDate: '2026-10-12', paymentMethod: 'BANK_TRANSFER', paidFromRef: 'บัญชีร้าน' });
  assert.deepEqual(disbursementPaymentBody(base, { paidDate: '', paymentMethod: '', paidFromRef: '  ' }), base);
});
test('payment attempts reuse their command id on retry and renew after edits', () => {
  let count = 0;
  const mint = () => `attempt-${++count}`;
  const first = nextDraftCommand(null, false, mint);
  assert.equal(nextDraftCommand(first, false, mint), first);
  assert.notEqual(nextDraftCommand(first, true, mint), first);
  assert.notEqual(nextDraftCommand(null, false, mint), first);
});
test('cancelled payments exclude unnumbered payment references and non-cancelled documents', () => {
  const lines = [
    { expensePaymentId: 'paid-a', paymentInEffect: false }, { expensePaymentId: 'paid-b', paymentInEffect: true }, { expensePaymentId: null, paymentInEffect: false },
  ] as DisbursementVoucherDetail['lines'];
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) {
    assert.deepEqual(disbursementCancelledPaymentLines({ header: { status }, lines } as DisbursementVoucherDetail), status === 'CANCELLED' ? lines.slice(0, 1) : []);
  }
});
test('approved list pay links target the form while every other action opens the document', () => {
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) for (const primaryAction of ['pay', 'approve', 'submit', 'view']) {
    assert.equal(disbursementVoucherDocumentHref('shop', { id: 'doc/one', status, primaryAction }),
      `/companies/shop/expenses/disbursement-vouchers/doc%2Fone${status === 'APPROVED' && primaryAction === 'pay' ? '#disbursement-voucher-pay' : ''}`);
  }
});
test('withholding next steps include every positive-tax line only after paying', () => {
  const lines = [{ expenseId: 'a', whtAmount: '0.0001' }, { expenseId: 'b', whtAmount: '300.0000' }, { expenseId: 'c', whtAmount: '0.0000' }] as DisbursementVoucherDetail['lines'];
  for (const status of DISBURSEMENT_VOUCHER_STATUSES) {
    const detail = { header: { status }, lines } as DisbursementVoucherDetail;
    assert.deepEqual(disbursementWithholdingLines(detail), status === 'PAID' ? lines.slice(0, 2) : []);
  }
});

test('payment body adds only the uploaded slip id and removing the selection omits it', () => {
  const fields = { paidDate: '2026-10-12', paymentMethod: 'CASH' as const, paidFromRef: '' };
  const base = { commandId: 'attempt', expectedVersion: 2 };
  assert.deepEqual(disbursementPaymentBody(base, { ...fields, slipAttachmentId: 'uploaded' }), { ...base, paidDate: fields.paidDate, paymentMethod: 'CASH', slipAttachmentId: 'uploaded' });
  assert.equal('slipAttachmentId' in disbursementPaymentBody(base, { ...fields, slipAttachmentId: undefined }), false);
});

 test('paid certificate blocks group states and omit lines without a certificate obligation', () => {
  const lines = ['NONE', 'PENDING', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'PENDING'].map((state, i) => ({ expenseId: String(i), whtAmount: '10', withholdingCertificate: { state, number: null } })) as any;
  const d = { header: { status: 'PAID' }, lines } as DisbursementVoucherDetail;
  assert.deepEqual(disbursementWithholdingGroups(d).map(g => [g.state, g.lines.length]), [['PENDING', 2], ['SYSTEM_ISSUED', 1], ['EXTERNAL_LINKED', 1]]);
  d.header.status = 'APPROVED'; assert.deepEqual(disbursementWithholdingGroups(d), []);
 });


test('payment correction advice follows the server withdraw action and names an active author or the owner', () => {
  const detail = { actions: { withdraw: false }, preparerName: 'มีนา', submittedByName: 'สมใจ', preparerActive: true, senderActive: true } as DisbursementVoucherDetail;
  assert.equal(disbursementPaymentCorrectionHint(detail), 'ยอดต้องเท่ายอดที่อนุมัติ ถ้าไม่เท่า ให้ มีนา แก้ใบก่อน');
  assert.match(disbursementPaymentCorrectionHint({ ...detail, preparerActive: false }), /ให้ สมใจ แก้ใบก่อน$/);
  assert.match(disbursementPaymentCorrectionHint({ ...detail, preparerActive: false, senderActive: false }), /ให้ เจ้าของกิจการ แก้ใบก่อน$/);
  // The reader who has "กลับไปแก้" is not sent to another person.
  for (const authorsActive of [true, false]) {
    assert.equal(disbursementPaymentCorrectionHint({ ...detail, preparerActive: authorsActive, senderActive: authorsActive, actions: { ...detail.actions, withdraw: true } }, true), 'ยอดต้องเท่ายอดที่อนุมัติ ถ้าไม่เท่า กดกลับไปแก้');
  }
});

test('e-WHT groups before and after payment without treating cancelled vouchers as a future payment', () => {
  const line = { expenseId: 'e', whtAmount: '1', whtRemittance: 'E_WHT', withholdingCertificate: { state: 'E_WHT', number: null } };
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) {
    const groups = disbursementWithholdingGroups({ header: { status }, lines: [line] } as any);
    assert.equal(groups.length, status === 'CANCELLED' ? 0 : 1);
    if (groups.length) assert.equal(groups[0].state, 'E_WHT');
  }
});
test('e-WHT voucher date warning uses the source reduced-rate flag, not a 1% total', async () => {
  const { disbursementEWhtPaymentWarning } = await import('./disbursement-voucher-payment.logic') as any;
  const detail: any = { lines: [{ whtRemittance: 'E_WHT', eWhtReducedRateApplied: true }] };
  assert.equal(typeof disbursementEWhtPaymentWarning, 'function');
  assert.ok(disbursementEWhtPaymentWarning(detail, '2028-01-01'));
  assert.equal(disbursementEWhtPaymentWarning(detail, '2026-01-01'), null);
  detail.lines[0].eWhtReducedRateApplied = false; assert.equal(disbursementEWhtPaymentWarning(detail, '2028-01-01'), null);
});

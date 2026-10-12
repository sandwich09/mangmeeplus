import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { certificateHarness, h } from './expense-certificate-test-harness';
import { ExpenseCertificateReopen } from './ExpenseCertificateReopen';

const payments = [
  { status: 'RECORDED', disbursementVoucher: { id: 'one', documentNumber: 'DV-1' } },
  { status: 'RECORDED', disbursementVoucher: { id: null, documentNumber: 'DV-2' } },
  { status: 'RECORDED', disbursementVoucher: { id: 'one', documentNumber: 'DV-1' } },
  { status: 'VOIDED', disbursementVoucher: { id: 'old', documentNumber: 'DV-OLD' } },
] as any;
const render = (certificate: any, rows = payments) => certificateHarness(() => h(ExpenseCertificateReopen, {
  certificate, busy: false, payments: rows,
  children: (_checked, notice) => h('form', null, notice, h('textarea')),
})).render();
test('both edit-dialog variants explain that live paid vouchers keep their snapshot, once per unbroken number', () => {
  for (const certificate of [null, { kind: 'SYSTEM', number: 'WHT-1' }, { kind: 'EXTERNAL', number: null }]) {
    const html = render(certificate);
    assert.match(html, /ใบสำคัญจ่ายเลขที่/);
    assert.match(html, /<span class="whitespace-nowrap">DV-1<\/span>/);
    assert.match(html, /<span class="whitespace-nowrap">DV-2<\/span>/);
    assert.match(html, /<span class="whitespace-nowrap">DV-1<\/span><\/span><span>, <span class="whitespace-nowrap">DV-2/);
    assert.equal(html.split('DV-1').length - 1, 1);
    assert.match(html, /และรายการจ่ายจะไม่เปลี่ยนตาม/);
    assert.doesNotMatch(html, /ยอดเปลี่ยน|ยอดค้างจ่าย/);
    assert.ok(html.indexOf('รายการนี้จ่ายไว้') < html.indexOf('<textarea'));
    assert.doesNotMatch(html, /DV-OLD/);
  }
});
test('no voucher or only cancelled payments gives no edit warning; payment-cancel dialogs receive no payments', () => {
  assert.doesNotMatch(render(null, []), /ใบสำคัญจ่ายเลขที่/);
  assert.doesNotMatch(render(null, [payments[3], { status: 'RECORDED', disbursementVoucher: null }]), /ใบสำคัญจ่ายเลขที่/);
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<ExpenseCertificateReopen[^>]*payments=\{correctionAction\?\.paymentId \? \[\] : detail.payments\}/);
});

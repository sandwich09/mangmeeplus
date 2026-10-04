import { apiErrorMessage } from '../../common/api/api-error-message';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './expenses.model';

const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
const caps = { canReopen: true, reopenBlockers: [], canRecordPayment: true, recordPaymentBlocker: null, payments: [] };

test('payment prefills the outstanding satang and names recording the remainder; invalid fields explain the disabled action', () => {
  const form = (model as any).expensePaymentFormState;
  assert.equal(typeof form, 'function');
  assert.equal(form('0.0100', '0.01', '2026-10-04').label, 'บันทึกจ่ายส่วนที่เหลือ ฿0.01');
  assert.equal(form('0.0100', '0.01', '2026-10-04').prefill, '0.01');
  assert.equal(form('100', '40', '2026-10-04').label, 'บันทึกจ่าย ฿40.00');
  for (const [amount, date] of [['', '2026-10-04'], ['0', '2026-10-04'], ['100.01', '2026-10-04'], ['10', '2026-02-30']]) {
    assert.ok(form('100', amount, date).disabledReason); assert.doesNotMatch(form('100', amount, date).disabledReason, /[A-Za-z]/);
  }
  assert.match(page, /setPaidAmount\(.*prefill/);
  assert.match(page, /paymentForm.disabledReason/);
  assert.match(page, /paymentForm.label/);
});

test('confirmed lock sentence uses server blockers and permission, with a true remedy for each', () => {
  const sentence = (model as any).expenseConfirmedLockMessage;
  assert.equal(typeof sentence, 'function');
  assert.match(sentence(caps), /ยืนยันแล้ว.*แก้ไขเอกสาร/);
  for (const [code, expected] of [['ledger_posted', 'ลงบัญชีแล้ว'], ['certificate_issued', '50 ทวิ'], ['tax_period_filed', 'ภ.ง.ด.53'], ['live_claim', 'คำขอเบิก'], ['permission_denied', 'ผู้มีสิทธิ์']]) {
    const text = sentence({ ...caps, canReopen: false, reopenBlockers: [code] });
    assert.ok(text.includes(expected)); assert.doesNotMatch(text, /[A-Za-z]/);
  }
  assert.match(page, /expenseConfirmedLockMessage\(detail.correctionCapabilities\)/);
  assert.match(page, /detail.correctionCapabilities\?\.canReopen/);
  assert.match(page, /paymentCapability\?\.canCancel/);
  const modal = page.slice(page.indexOf('<Modal open={Boolean(correctionAction)}'), page.indexOf('<Modal\n        open={showReject}'));
  assert.match(modal, /t\('expenses.confirm', 'th'\)/);
  assert.match(modal, /t\('expenses.close', 'th'\)/);
});

test('50 ทวิ issuance remains available across visits from server capability; no withholding means no action', () => {
  const allowed = (model as any).canIssueExpenseWhtCertificate;
  assert.equal(typeof allowed, 'function');
  const handoff = { status: 'REQUIRED', systemIssuanceOpen: true };
  assert.equal(allowed({ status: 'CONFIRMED', whtAmount: '3' }, handoff, ['wht.certificate.issue']), true);
  for (const [detail, h, permissions] of [
    [{ status: 'CONFIRMED', whtAmount: '0' }, handoff, ['wht.certificate.issue']],
    [{ status: 'NEEDS_REVIEW', whtAmount: '3' }, handoff, ['wht.certificate.issue']],
    [{ status: 'CONFIRMED', whtAmount: '3' }, { ...handoff, systemIssuanceOpen: false }, ['wht.certificate.issue']],
    [{ status: 'CONFIRMED', whtAmount: '3' }, handoff, []],
  ]) assert.equal(allowed(detail, h, permissions), false);
  assert.match(page, /canIssueExpenseWhtCertificate\(detail, whtHandoff, permissions\)/);
  assert.match(page, /downloadSystemWhtCertificate/);
  assert.match(page, /ดาวน์โหลด PDF อีกครั้ง/);
  assert.doesNotMatch(page, /status: 'SYSTEM_ISSUED', sourcePaymentId: expenseId/);
});


test('a blocker appearing after page load keeps its factual Thai remedy in API error handling', () => {
  assert.match(apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['ledger_posted', 'certificate_issued'] } }), /ลงบัญชีแล้ว.*50 ทวิ/);
  assert.match(apiErrorMessage({ code: 'expense_payment_correction_blocked', details: { blocker: 'ledger_posted' } }), /ลงบัญชีแล้ว/);
  assert.match(apiErrorMessage({ code: 'expense_paid_exceeds_payable' }), /ยอดที่จ่ายแล้วเกิน/);
  for (const code of ['expense_wht_source_changed', 'expense_posting_source_changed', 'expense_correction_source_changed']) assert.match(apiErrorMessage({ code }), /ข้อมูล.*เปลี่ยน.*โหลด/);
  assert.match(apiErrorMessage({ code: 'wht_certificate_download_unavailable' }), /ยังไม่มีหนังสือรับรอง.*ดาวน์โหลด/);
  assert.doesNotMatch(apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['secret-token'] } }), /secret-token/);
});


test('retrying the saved payment intent remains possible after its outstanding balance becomes zero', () => {
  assert.equal((model as any).expensePaymentFormState('0', '40', '2026-10-04', true).disabledReason, null);
  assert.match(page, /canRecordPayment \|\| Boolean\(paymentAttemptRef.current\)/);
  assert.match(page, /paidAmount, paidAt, Boolean\(paymentAttemptRef.current\)/);
});

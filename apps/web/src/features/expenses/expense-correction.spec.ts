import { apiErrorMessage } from '../../common/api/api-error-message';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './expenses.model';
import * as correction from '@watchdog-bms/contracts';

const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
const caps = { canReopen: true, reopenBlockers: [], canRecordPayment: true, recordPaymentBlocker: null, payments: [] };

test('payment prefills the outstanding satang and names recording the remainder; invalid fields explain the disabled action', () => {
  const form = (model as any).expensePaymentFormState;
  assert.equal(typeof form, 'function');
  assert.equal(form('0.0100', '0.01', '2026-10-04').label, 'บันทึกจ่าย 0.01 บาท');
  assert.equal(form('0.0100', '0.01', '2026-10-04').prefill, '0.01');
  assert.equal(form('100', '40', '2026-10-04').label, 'บันทึกจ่าย 40.00 บาท');
  for (const [amount, date] of [['', '2026-10-04'], ['0', '2026-10-04'], ['100.01', '2026-10-04'], ['10', '2026-02-30']]) {
    assert.ok(form('100', amount, date).disabledReason); assert.doesNotMatch(form('100', amount, date).disabledReason, /[A-Za-z]/);
  }
  assert.match(page, /setPaidAmount\(.*prefill/);
  assert.match(page, /paymentForm.disabledReason/);
  assert.match(page, /paymentForm.label/);
});

test('confirmed lock gives one next step and lists the actual period blockers separately', () => {
  assert.match(model.expenseConfirmedLockMessage(caps as any), /ยืนยันแล้ว.*แก้ไขเอกสาร/);
  const blocked = { ...caps, canReopen: false, reopenBlockers: ['ledger_posted', 'accounting_period_locked', 'tax_period_filed'], lockedAccountingPeriodKey: '2026-08', lockedTaxPeriods: [{ formType: 'PP30', periodKey: '2026-08' }, { formType: 'PND3', periodKey: '2026-08' }] };
  const messages = (correction as any).expenseReopenBlockerMessages(blocked);
  assert.equal(messages.length, 4);
  assert.match(messages[0], /ลงบัญชีแล้ว.*เปิดแก้ไข.*ไม่ได้.*ติดต่อผู้ทำบัญชี/);
  assert.match(messages[1], /08\/2569/);
  assert.match(messages[2], /ภ.พ.30/); assert.match(messages[3], /ภ.ง.ด.3/);
  assert.doesNotMatch(messages.join(' '), /ภ.ง.ด.53|ภ.พ.36|ตรวจขั้นตอน|[A-Za-z]|·/);
  assert.match(page, /expenseReopenBlockerMessages\(detail.correctionCapabilities, caps.canReadLedger\)\.map/);
  assert.match(page, /<li key=\{message\}/);
});

test('reopen, record and cancel refusals describe the requested action; unknown context never guesses a form', () => {
  for (const [operation, expected] of [['reopen', 'เปิดแก้ไขเอกสาร'], ['recordPayment', 'บันทึกจ่าย'], ['cancelPayment', 'ยกเลิกรายการจ่าย'], ['reject', 'ยกเลิกรายการ']]) {
    const text = (correction as any).expenseCorrectionBlockerMessage('not_confirmed', operation);
    assert.ok(text.includes(expected)); assert.doesNotMatch(text, /ตรวจสถานะเอกสาร|[A-Za-z]/);
  }
  assert.doesNotMatch(correction.expenseCorrectionBlockerMessage('tax_period_filed'), /ภ.ง.ด.53/);
  for (const [blocker, happened, next] of [
    ['ledger_posted', 'ลงบัญชีแล้ว', 'ติดต่อผู้ทำบัญชี'], ['journal_pending', 'รอผ่านรายการ', 'ติดต่อผู้ทำบัญชี'],
    ['posting_unresolved', 'ยังไม่ชัดเจน', 'ติดต่อผู้ทำบัญชี'], ['certificate_issued', '50 ทวิแล้ว', 'ติดต่อผู้ทำบัญชี'],
    ['tax_period_filed', 'ถูกล็อกแล้ว', 'ติดต่อผู้ทำบัญชี'], ['live_claim', 'คำขอเบิก', 'ติดต่อผู้ดูแลคำขอเบิก'],
    ['permission_denied', 'ไม่มีสิทธิ์', 'ติดต่อผู้มีสิทธิ์'], ['missing_branch', 'ยังไม่มีสาขา', 'ติดต่อผู้ดูแลรายจ่าย'],
    ['personal_advance', 'ใบรับรองระบุว่าพนักงานจ่ายร้านแล้ว', 'ติดต่อผู้ดูแลการเบิกคืน'], ['payment_voided', 'ยกเลิกแล้ว', 'โหลดหน้าใหม่'],
    ['recorded_payments', 'ยังมีรายการจ่าย', 'ยกเลิกรายการจ่ายก่อน'], ['legacy_paid_balance', 'ไม่มีรายการให้ยกเลิก', 'ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร'],
  ]) {
    const text = (correction as any).expenseCorrectionBlockerMessage(blocker, 'cancelPayment');
    assert.ok(text.includes(happened)); assert.ok(text.includes(next)); assert.doesNotMatch(text, /ตรวจขั้นตอน|[A-Za-z]/);
  }
  assert.equal(correction.expenseCorrectionBlockerMessage('no_balance'), 'ไม่มียอดค้างจ่าย จึงบันทึกจ่ายเพิ่มไม่ได้');

  assert.match(page, /recordPaymentBlocker, 'recordPayment'/);
  assert.match(page, /cancelBlocker, 'cancelPayment'/);
});

test('a reopened expense with payments explains rejection and puts permitted cancellation in the rejection dialog', () => {
  const modal = page.slice(page.indexOf('<Modal\n        open={showReject && !correctionAction}'));
  assert.match(modal, /rejectBlocker/);
  assert.match(modal, /paymentHistory/);
  assert.match(modal, /canReject === undefined[\s\S]*EXPENSE_CORRECTION_WORDS.unavailable/);
  assert.match(modal, /correctionCapabilities\?\.canReject !== true/);
  assert.match(apiErrorMessage({ code: 'expense_rejection_payments_recorded' }), /รายการจ่าย.*ยกเลิก/);
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
  assert.match(page, /canIssueExpenseWhtCertificate\(detail, whtHandoff, uiPermissions\)/);
  assert.match(page, /downloadSystemWhtCertificate/);
  assert.match(page, /EXPENSE_CORRECTION_WORDS.downloadAgain/);
  assert.doesNotMatch(page, /status: 'SYSTEM_ISSUED', sourcePaymentId: expenseId/);
});


test('a blocker appearing after page load keeps its factual Thai remedy in API error handling', () => {
  assert.match(apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['ledger_posted', 'certificate_issued'] } }), /ลงบัญชีแล้ว[\s\S]*50 ทวิ/);
  assert.match(apiErrorMessage({ code: 'expense_payment_correction_blocked', details: { blocker: 'ledger_posted' } }), /ลงบัญชีแล้ว/);
  assert.match(apiErrorMessage({ code: 'expense_paid_exceeds_payable' }), /ยอดที่จ่ายแล้วเกิน/);
  for (const code of ['expense_wht_source_changed', 'expense_posting_source_changed', 'expense_correction_source_changed']) assert.match(apiErrorMessage({ code }), /ข้อมูล.*เปลี่ยน.*เปิดหน้านี้ใหม่/);
  assert.match(apiErrorMessage({ code: 'wht_certificate_download_unavailable' }), /ยังไม่มีหนังสือรับรอง.*ดาวน์โหลด/);
  assert.doesNotMatch(apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['secret-token'] } }), /secret-token/);
});


test('retrying the saved payment intent remains possible after its outstanding balance becomes zero', () => {
  assert.equal((model as any).expensePaymentFormState('0', '40', '2026-10-04', true).disabledReason, null);
  assert.match(page, /canRecordPayment \|\| Boolean\(paymentAttemptRef.current\)/);
  assert.match(page, /paidAmount, paidAt, Boolean\(paymentAttemptRef.current\)/);
});

test('late period refusals preserve the actual forms and render as separate lines', () => {
  const text = apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['tax_period_filed'], lockedTaxPeriods: [{ formType: 'PP36', periodKey: '2026-08' }, { formType: 'PND3', periodKey: '2026-08' }] } });
  assert.match(text, /ภ.พ.36/); assert.match(text, /ภ.ง.ด.3/);
  assert.doesNotMatch(text, /ภ.พ.30|ภ.ง.ด.53|·/); assert.equal(text.split('\n').length, 2);
});

test('the cancel-payment dialog has one button that begins ยกเลิก: the one that only closes reads ปิด', () => {
  assert.match(page, /t\(correctionAllowed && !correctionAction\?\.paymentId \? 'expenses\.cancel' : 'expenses\.close', 'th'\)/);
  assert.equal(correction.EXPENSE_CORRECTION_WORDS.cancelPayment, 'ยกเลิกรายการจ่ายนี้');
});

test('small controls on the expense screens keep 44 px of tappable height on a phone without looking different', () => {
  const ui = readFileSync(new URL('./ExpensesUi.tsx', import.meta.url), 'utf8');
  assert.match(ui, /export const tapTargetClass = "relative before:absolute[^"]*before:h-11[^"]*before:min-w-11[^"]*"/);
  assert.match(page, /<Link className="mangmee-btn mangmee-btn-secondary !min-h-9 !py-1.5" href=\{backTarget\}/, 'DETAIL-2b: compact secondary back control preserves the list URL');
  assert.match(page, /cx\(tapTargetClass, 'mt-1 rounded font-semibold underline/, 'the footer pointer to the field');
  assert.doesNotMatch(page, /navChips\.map/, 'DETAIL-1 removes section jump buttons');
  assert.match(page, /\{guided && <><div id="expense-review-start" tabIndex=\{-1\} ref=\{reviewStartRef\}/, 'the review stepper remains on review-mode expenses only');
  const pages = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
  assert.equal((pages.match(/cx\(tapTargetClass, 'flex h-8 w-8/g) ?? []).length, 2, 'remove-line on products and on charges');
});

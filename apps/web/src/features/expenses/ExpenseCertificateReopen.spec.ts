import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { certificateHarness, h } from './expense-certificate-test-harness';
import { ExpenseCertificateReopen, expenseCertificateReopenedMessage, currentExpenseCertificate, type ExpenseCertificate } from './ExpenseCertificateReopen';

function render(certificate: ExpenseCertificate | null, reason = 'แก้ยอด', attested = false, busy = false) {
  return certificateHarness(() => h(ExpenseCertificateReopen, {
    certificate, busy,
    children: (checked, notice, footer, attestation) => h('form', null, notice, h('textarea'), attestation,
      footer(h('button', { disabled: busy || reason.trim().length < 3 || Boolean(certificate && !checked) }, 'ส่ง'))),
  }), [attested ? 'NOT_FILED' : '']);
}

test('reopen identifies SYSTEM and EXTERNAL effects with exact copy and omits a missing number', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-1', null]) {
    const certificate = { kind, number, date: null, canCancel: true };
    const html = render(certificate).render();
    assert.match(html, new RegExp(kind === 'SYSTEM'
      ? 'เอกสารนี้ออกหนังสือรับรอง 50 ทวิแล้ว'
      : 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว'));
    assert.ok(html.includes('ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้')); assert.ok(html.includes('ยื่นไปแล้ว จะแจ้งคนที่ยื่นภาษีให้ร้านยื่นแบบแก้ไข'));
    assert.doesNotMatch(html, /ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม/);
    assert.match(html, /type="radio" required=""/);
    if (kind === 'SYSTEM') assert.doesNotMatch(html, /เมื่อแก้เสร็จ|ถ้าเคยส่ง/);
    else assert.match(html, /ระบบยกเลิกใบที่ทำนอกระบบให้ไม่ได้ ร้านต้องยกเลิกเอง/);
    assert.equal(html.includes('เลขที่ WHT-1'), Boolean(number));
    const toast = expenseCertificateReopenedMessage(certificate);
    assert.equal(toast, kind === 'SYSTEM'
      ? `เปิดให้แก้ไขแล้ว และยกเลิกหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`
      : `เปิดให้แก้ไขแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`);
  }
});

test('attestation remains in the child, requires a reason and tick, and resets when the dialog is reopened', () => {
  const certificate: ExpenseCertificate = { kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true };
  for (const [reason, checked, busy, disabled] of [['แก้ยอด', false, false, true], ['ก', true, false, true], ['แก้ยอด', true, false, false], ['แก้ยอด', true, true, true]] as const) {
    const form = render(certificate, reason, checked, busy); form.render();
    assert.equal(form.find('button').disabled, disabled);
  }
  const form = render(certificate); form.render();
  form.find('input').onChange({ target: { checked: true } }); form.render();
  assert.equal(form.find('button').disabled, false);
  assert.match(render(certificate).render(), /<button disabled=""/);
  const plain = render(null).render();
  assert.doesNotMatch(plain, /checkbox|หนังสือรับรอง|mangmee-safe-bottom/);
  assert.doesNotMatch(plain, /<button disabled/);
});

test('page keeps the original modal and gates certificate submissions without changing state/ref slots', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /closeOnBackdrop=\{!correctionCertificate\}/);
  // A certificate still gates the submit on the tax-filing answer; a missing reason is said on press (the form's own check), not by a grey button.
  assert.match(page, /disabled=\{actionLoading \|\| conflictReload \|\| Boolean\(correctionCertificate && !taxFilingAttested\)\}/);
  assert.match(page, /if \(correctionReason\.trim\(\)\.length < 3 \|\| correctionReason\.trim\(\)\.length > REASON_MAX_LENGTH\) \{ setCorrectionError\(EXPENSE_CORRECTION_WORDS\.reasonRequired\); focusExpenseField\(correctionReasonRef.current\); return; \}/);
  assert.match(page, /reopenExpense\(companyId, expenseId, correctionReason.trim\(\), correctionCertificate \? true : undefined\)/);
  assert.match(page, /certificateNotice[\s\S]*htmlFor="expense-correction-reason"/);
  assert.match(page, /correctionCertificate \? err\(cause\)/);
});

test('reopen places facts before reason then the attestation directly before buttons and names the print button', () => {
  const html = render({ kind: 'SYSTEM', number: null, date: null, canCancel: true }).render();
  assert.ok(html.indexOf('เอกสารนี้') < html.indexOf('<textarea'));
  assert.ok(html.indexOf('<textarea') < html.indexOf('type="radio"'));
  assert.ok(html.indexOf('type="radio"') < html.indexOf('<button'));
  assert.doesNotMatch(html, /เมื่อแก้เสร็จ/);
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.ok(page.indexOf('{certificateAttestation}') > page.indexOf('id="expense-correction-reason"'));
});

test('edit keeps only bold certificate facts and one consequence for a self-issued paper', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const html = render({ kind, number: 'WHT-1', date: null, canCancel: true }).render();
    const notice = html.slice(0, html.indexOf('<textarea'));
    assert.equal((notice.match(/<p[ >]/g) ?? []).length, kind === 'SYSTEM' ? 0 : 1);
    assert.match(notice, /font-semibold/); assert.match(notice, /เลขที่ WHT-1/);
    if (kind === 'EXTERNAL') assert.match(notice, /ระบบยกเลิกใบที่ทำนอกระบบให้ไม่ได้ ร้านต้องยกเลิกเอง/);
    assert.doesNotMatch(expenseCertificateReopenedMessage({ kind, number: 'WHT-1' }), /เมื่อแก้เสร็จ|ยืนยันเอกสาร|ใบใหม่/);
  }
});

test('both filing choices attest, only filed shows small print, and no choice remains disabled', () => {
  const form = render({ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true });
  form.render(); assert.equal(form.find('button').disabled, true);
  form.find('input', p => p.value === 'FILED').onChange();
  assert.match(form.render(), /ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม/); assert.equal(form.find('button').disabled, false);
  assert.equal(form.find('input', p => p.value === 'NOT_FILED').checked, false);
  form.find('input', p => p.value === 'NOT_FILED').onChange();
  assert.doesNotMatch(form.render(), /ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม/); assert.equal(form.find('button').disabled, false);
  assert.equal(form.find('input', p => p.value === 'FILED').checked, false);
});

test('dialog facts follow issue, correction, external change and removal, including rights for the current kind', () => {
  const old = { kind: 'SYSTEM' as const, number: 'OLD', date: null, canCancel: true };
  assert.equal(currentExpenseCertificate(null, old, [])?.number, 'OLD');
  assert.equal(currentExpenseCertificate({ status: 'SYSTEM_ISSUED', certificateNumber: 'NEW', certificateIssuedAt: '2026-10-12' } as any, old, ['wht.certificate.correct'])?.number, 'NEW');
  const changed = currentExpenseCertificate({ status: 'EXTERNAL_LINKED', externalCertificateNumber: 'EXT-NEW', externalIssuedDate: '2026-10-12' } as any, old, ['wht.external_certificate.link']);
  assert.deepEqual(changed, { kind: 'EXTERNAL', number: 'EXT-NEW', date: '2026-10-12', canCancel: true });
  assert.equal(currentExpenseCertificate({ status: 'REQUIRED' } as any, old, []), null);
  assert.equal(currentExpenseCertificate({ status: 'CANCELLED' } as any, old, []), null);
});

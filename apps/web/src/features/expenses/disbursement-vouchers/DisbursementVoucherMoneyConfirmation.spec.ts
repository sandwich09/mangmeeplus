import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import { disbursementPaymentDateError } from './disbursement-voucher-payment.logic';

const pay = readFileSync(new URL('./DisbursementVoucherPayCard.tsx', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('./DisbursementVoucherCommandDialog.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');

// Run the actual component handlers so the check covers the request and its synchronous duplicate guard.
function handlers(names: string[], deps: Record<string, unknown>) {
  const source = ts.createSourceFile('card.tsx', pay, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer)
      found.push(`const ${node.name.text} = ${node.initializer.getText(source)};`);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(found.length, names.length);
  const js = ts.transpileModule(found.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}; return {${names.join(',')}};`)(deps);
}
function fixture(confirmOpen: boolean) {
  const bodies: unknown[] = []; const fields = { paidDate: '2026-10-12', paymentMethod: 'TRANSFER', paidFromRef: 'บัญชีร้าน' };
  let open = confirmOpen, failure: unknown = null, resolve!: (value: unknown) => void;
  const deps = {
    confirmOpen, confirmationReady: true, actionBlocked: false, dateError: undefined, methodError: undefined, inFlight: { current: false }, slipInFlight: { current: false }, stale: false,
    detail: { header: { id: 'doc', status: 'APPROVED', totalAmount: '123.45', documentNumber: 'PV-1' }, actions: { pay: true } },
    fields, companyId: 'shop', commandId: { current: null }, committed: { current: null }, attachedSlip: { current: { version: 7 } },
    setConfirmOpen: (value: boolean) => { open = value; }, setBusy: () => {}, setError: (value: unknown) => { failure = value; },
    disbursementPaymentDateError: () => undefined, disbursementPaymentMethodError: () => undefined,
    nextDraftCommand: () => 'attempt', crypto: { randomUUID: () => 'attempt' },
    payDisbursementVoucher: (_company: string, _id: string, body: unknown) => { bodies.push(body); return new Promise(yes => { resolve = yes; }); },
    disbursementPaymentBody: (base: unknown, values: unknown) => ({ ...base as object, ...values as object }),
    setNeedsRefresh: () => {}, onReload: async () => {}, onSuccess: () => {}, toast: { success: () => {} }, word: () => '{number}',
  };
  return { deps, bodies, fields, open: () => open, failure: () => failure, resolve: () => resolve({ documentNumber: 'PV-1' }) };
}
test('opening payment confirmation and going back send no request; a save cannot bypass confirmation', async () => {
  const f = fixture(false), action = handlers(['requestConfirmation', 'closeConfirmation', 'save'], f.deps);
  action.requestConfirmation(); assert.equal(f.open(), true); assert.equal(f.bodies.length, 0);
  action.closeConfirmation(); assert.equal(f.open(), false); await action.save(); assert.equal(f.bodies.length, 0);
  assert.match(pay, /onSubmit=\{event => \{ event.preventDefault\(\);.*requestConfirmation\(\)/);
});
test('one payment confirm makes exactly one request even on a double press, with the existing fields and version', async () => {
  const f = fixture(true), action = handlers(['save'], f.deps);
  const saving = action.save(); await action.save(); assert.equal(f.bodies.length, 1);
  assert.deepEqual(f.bodies[0], { commandId: 'attempt', expectedVersion: 7, ...f.fields });
  assert.equal(f.open(), false); f.resolve(); await saving;
});
test('an empty paid date has an inline way out and leaves the payment button enabled', () => {
  const f = fixture(false);
  f.fields.paidDate = '';
  f.deps.dateError = disbursementPaymentDateError('') as any;
  handlers(['requestConfirmation'], f.deps).requestConfirmation();
  assert.equal(f.open(), false); assert.equal(f.bodies.length, 0);
  assert.match(pay, /dateError && <p id="disbursement-paid-date-error" role="alert"/);
  const submit = pay.match(/<button type="submit"[^>]*>/)![0];
  assert.doesNotMatch(submit, /dateError/);
});
test('a failed refresh after payment retries the document read with the confirmation closed', async () => {
  const f = fixture(true); let reads = 0;
  f.deps.onReload = async () => { if (++reads === 1) throw new Error('คำตอบหาย'); };
  const action = handlers(['save'], f.deps);
  const saving = action.save(); f.resolve(); await saving;
  assert.equal(f.open(), false); assert.equal(reads, 1); assert.equal(f.bodies.length, 1);
  f.deps.confirmationReady = false;
  const submit = pay.match(/onSubmit=\{event => \{ event.preventDefault\(\); ([^}]+) \}\}/)![1];
  const reload = handlers(['reload'], f.deps).reload;
  await new Function('needsRefresh', 'reload', 'save', 'requestConfirmation', submit)(true, reload, () => assert.fail('must not save again'), () => assert.fail('must not reopen confirmation'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2); assert.equal(f.bodies.length, 1); assert.equal(f.failure(), null);
});
test('payment refusal keeps the form values and its existing in-card error handling', async () => {
  const f = fixture(true), refusal = new Error('บันทึกจ่ายไม่สำเร็จ กรุณาลองอีกครั้ง');
  f.deps.payDisbursementVoucher = async () => { throw refusal; };
  await handlers(['save'], f.deps).save();
  assert.equal(f.failure(), refusal); assert.equal(f.open(), false);
  assert.deepEqual(f.fields, { paidDate: '2026-10-12', paymentMethod: 'TRANSFER', paidFromRef: 'บัญชีร้าน' });
  assert.match(pay, /catch \(failure\) \{ setError\(failure\); \}/);
  assert.doesNotMatch(pay, /catch[^}]*setFields/);
});
test('payment confirmation shows only its facts, the Thai date and method, and a missing-slip fact only without an attachment', () => {
  assert.match(pay, /pay_confirm_fact.*replace\('\{total\}', baht\(detail.header.totalAmount\)\).*replace\('\{payee\}', detail.header.payeeName\)/);
  assert.match(pay, /formatThaiDate\(fields.paidDate\).*PAYMENT_METHOD_LABELS\[fields.paymentMethod\]/);
  assert.match(pay, /!fields.slipAttachmentId && !detail.slip && !preparedSlip\?\.slip && <p>\{word\('pay_no_evidence'\)/);
  for (const [key, expected] of Object.entries({ pay_confirm: 'ยืนยัน จ่ายแล้ว {total}', pay_confirm_fact: 'จ่าย {total} ให้ {payee}', pay_review: 'กลับไปตรวจ', pay_no_evidence: 'ยังไม่ได้แนบหลักฐาน', approve_confirm: 'อนุมัติจ่าย {total} ให้ {payee} ใช่ไหม' }))
    assert.equal(workspaceDictionary.th[`expenses.disbursement.${key}` as keyof typeof workspaceDictionary.th], expected);
  assert.match(pay, /closeOnBackdrop=\{false\}/);
  assert.doesNotMatch(pay, /styles.modalFooter|w-full sm:w-auto/); // plain buttons: the shared dialog footer sizes them
  assert.ok(pay.indexOf("word('pay_review')}</button>") < pay.indexOf("word('pay_confirm').replace"));
});
test('approval dialog never submits on mount and uses an explicit approve confirmation with amount and payee', () => {
  assert.doesNotMatch(dialog, /startedApproval|void run\(\);\s*\}/);
  assert.match(dialog, /approve_confirm.*replace\('\{total\}', baht\(detail.header.totalAmount\)\).*replace\('\{payee\}', detail.header.payeeName\)/);
  assert.match(dialog, /onClick=\{\(\) => void run\(\)\}/);
});
test('pay and approve confirmation actions wait 600 ms after opening while the safe choices remain immediate', () => {
  assert.match(pay, /setTimeout\(\(\) => setConfirmationReady\(true\), 600\)/);
  assert.match(pay, /if \(inFlight\.current \|\| !confirmationReady \|\| stale/);
  assert.match(pay, /disabled=\{busy \|\| actionBlocked \|\| slipUploading \|\| !confirmationReady\}/);
  assert.match(dialog, /kind !== 'approve'\) return;[\s\S]*setTimeout\(\(\) => setConfirmationReady\(true\), 600\)/);
  assert.match(dialog, /kind === 'approve' && !confirmationReady \|\| !ready/);
  assert.match(dialog, /disabled=\{busy \|\| kind === 'approve' && !confirmationReady \|\| !ready/);
  assert.match(dialog, /disabled=\{busy\} aria-busy=\{busy\} onClick=\{onCancel\}/);
});
test('the page busy guard survives a successful dialog close and blocks the newly exposed pay button', () => {
  assert.match(page, /onSuccess=\{holdPrimary\}/);
  assert.match(page, /setActionBusy\(true\)/);
  assert.match(page, /setTimeout\(\(\) => setActionBusy\(false\), 600\)/);
  assert.match(page, /actionBlocked=\{Boolean\(dialog\) \|\| actionBusy\}/);
  assert.match(pay, /disabled=\{busy \|\| actionBlocked/);
});

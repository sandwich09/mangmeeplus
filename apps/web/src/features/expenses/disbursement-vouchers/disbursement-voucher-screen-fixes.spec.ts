import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { description: 'description', withholdingHint: 'withholdingHint' }; };
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const { DisbursementVoucherExpenseRows } = require('./DisbursementVoucherExpensePicker');
const { DisbursementVoucherPayeeRow } = require('./DisbursementVoucherPayeePicker');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const render = (component: any, props: any) => renderToStaticMarkup(React.createElement(component, props));

test('expense rows show description, invoice and another branch while retaining greyed blockers', () => {
  const row = { expenseId: 'expense', expenseNumber: 'EXP-1', expenseDate: '2026-10-11', vendorName: 'ร้าน ก', description: 'ค่าซ่อมเครื่อง', vendorInvoiceNumber: 'ใบ-123', branchId: 'other', branchName: 'บางนา', outstandingAmount: '100.00', whtAmount: '0', selectable: false, reasonCode: 'reserved', reservation: { documentNumber: 'DV-2' } };
  const props = { rows: [row], amounts: {}, branchId: 'here', onToggle: () => {} };
  const html = render(DisbursementVoucherExpenseRows, props);
  assert.match(html, /class="description"[^>]*>ค่าซ่อมเครื่อง/); assert.match(html, /เลขที่ใบกำกับ\/ใบเสร็จ ใบ-123/); assert.match(html, /สาขา บางนา/);
  assert.match(html, /disabled=""/); assert.match(html, /DV-2/);
  assert.doesNotMatch(render(DisbursementVoucherExpenseRows, { ...props, branchId: 'other' }), /สาขา บางนา/);
  assert.doesNotMatch(render(DisbursementVoucherExpenseRows, { ...props, rows: [{ ...row, description: null, vendorInvoiceNumber: null, branchName: null }] }), /เลขที่ใบกำกับ|สาขา|title="ค่าซ่อมเครื่อง"/);
  assert.match(source('./disbursement-voucher-form.module.css'), /\.description[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
});

test('compact expense rows omit the heading payee and a sole branch, then name only a different payee or branch', () => {
  const row = { expenseId: 'a', expenseNumber: 'EXP-1', expenseDate: '2026-10-11', vendorName: 'ร้าน ก', description: 'ค่าซ่อม', vendorInvoiceNumber: 'ใบ-1', branchId: 'hq', branchName: 'Head Office', outstandingAmount: '100.00', whtAmount: '3.00', selectable: true };
  const props = { rows: [row], amounts: {}, payeeName: 'ร้าน ก', onToggle: () => {} };
  const html = render(DisbursementVoucherExpenseRows, props);
  assert.doesNotMatch(html, /ร้าน ก|สาขา Head Office/);
  for (const line of ['identity', 'description', 'balance']) assert.equal(html.split(`data-line="${line}"`).length - 1, 1);
  assert.match(html, /ยอดนี้หักภาษี ณ ที่จ่ายไว้แล้ว/);
  const mixed = { ...props, rows: [row, { ...row, expenseId: 'b', vendorName: 'ร้าน ข', branchId: 'other', branchName: 'บางนา' }] };
  assert.match(render(DisbursementVoucherExpenseRows, mixed), /สาขา Head Office/);
  assert.match(render(DisbursementVoucherExpenseRows, mixed), /สาขา บางนา/);
  assert.match(render(DisbursementVoucherExpenseRows, mixed), /ร้าน ข/);
  const ticked = render(DisbursementVoucherExpenseRows, { ...mixed, amounts: { a: '100.00' }, onAmount: () => {} });
  assert.doesNotMatch(ticked, /สาขา Head Office/); assert.match(ticked, /สาขา บางนา/);
  assert.match(ticked, /value="100.00"/); assert.equal(ticked.split('data-line="amount"').length - 1, 1);
  assert.match(source('./DisbursementVoucherDraftPage.tsx'), /payeeName=\{payee\?\.displayName\}/);
});

test('an all-reserved payee is labelled only after checking server row reasons and remains openable', async () => {
  const runtime = require('react'), realState = runtime.useState, realEffect = runtime.useEffect;
  const payee = { payeeKey: 'key', displayName: 'ร้าน ก', taxId: null, expenseCount: 2, selectableExpenseCount: 0, totalOutstanding: '200.00' };
  for (const reasons of [['reserved', 'reserved'], ['reserved', 'foreign_currency']]) {
    const read = mock.method(api, 'listDisbursementPayableExpenses', async () => reasons.map(reasonCode => ({ reasonCode })));
    const states: any[] = [false, true]; let started = false; let cleanup: any;
    const draw = () => {
      let index = 0;
      runtime.useState = (init: any) => { const pair = realState(init), i = index++; return i < 2 ? [states[i], (value: any) => { states[i] = value; }] : pair; };
      runtime.useEffect = (effect: any, deps: any) => { if (!started) { started = true; cleanup = effect(); } else realEffect(effect, deps); };
      try { return render(DisbursementVoucherPayeeRow, { companyId: 'shop', payee, selected: false, onChoose: () => {} }); }
      finally { runtime.useState = realState; runtime.useEffect = realEffect; }
    };
    try {
      draw(); await new Promise(resolve => setImmediate(resolve)); const html = draw();
      assert.equal(html.includes('ค้างจ่าย 2 รายการ · อยู่ในใบอื่นแล้วทั้งหมด'), reasons.every(reason => reason === 'reserved'));
      assert.doesNotMatch(html, /disabled=""/); assert.equal(read.mock.callCount(), 1);
    } finally { cleanup?.(); read.mock.restore(); }
  }
});

test('pay requires a method before any slip or payment request and explains the disabled button', () => {
  const page = source('./DisbursementVoucherPayCard.tsx');
  assert.ok(page.indexOf('disbursementPaymentMethodError(fields.paymentMethod);\n    if (refusal)') < page.indexOf('await attachDisbursementVoucherSlip'));
  assert.match(page, /word\('choose_paid_method'\)/); assert.match(page, /Boolean\(methodError\)/);
  assert.match(page, /methodError && !busy && !needsRefresh[^\n]*word\('choose_method_first'\)/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.choose_method_first'], 'เลือกวิธีจ่ายก่อน');
});

test('editing supplies a truthful leave sentence while new forms retain the shared default', () => {
  assert.match(source('./DisbursementVoucherDraftPage.tsx'), /description: draftId \? t\('expenses.disbursement.leave_edit', 'th'\) : undefined/);
  assert.match(source('../../../common/components/unsaved-navigation/use-unsaved-navigation.tsx'), /options.description \?\? t\('common.unsaved.description'/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.leave_edit'], 'ถ้าออกตอนนี้ สิ่งที่แก้ไว้จะไม่ถูกบันทึก ฉบับร่างเดิมยังอยู่');
  assert.equal(workspaceDictionary.th['common.unsaved.description'], 'ถ้าออกตอนนี้ รายการที่เลือกไว้จะหาย');
});

test('resending preselects the last requested approver and restores the full notice help sentence', () => {
  assert.match(source('./DisbursementVoucherCommandDialog.tsx'), /initialApprover\(data, preferredApprover\)/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.send_help'], 'ผู้ที่เลือกจะได้รับแจ้งเตือน ผู้มีสิทธิ์อนุมัติคนอื่นก็อนุมัติได้เช่นกัน');
  assert.match(source('./DisbursementVoucherDocumentPage.tsx'), /lastReminder && <p[^>]*>\{lastReminder\}/);
});

test('dialog buttons are full width on phones with primary last and the other-expense sheet keeps selected rows', () => {
  for (const file of ['./DisbursementVoucherCommandDialog.tsx', './DisbursementVoucherSlip.tsx', '../ExpenseDisbursementVoucher.tsx']) {
    const text = source(file), footer = text.slice(text.indexOf('footer={'));
    assert.ok((footer.match(/w-full(?: sm:w-auto)?[ `"]/g) ?? []).length >= 2, file); // full width on phones; from 640px either natural width or equal columns
    assert.ok(footer.indexOf('ghostClass') < footer.indexOf('btnClass') || footer.indexOf('ghostClass') < footer.indexOf('dangerClass'), file);
  }
  assert.match(source('./DisbursementVoucherExpensePicker.tsx'), /onClick=\{onClose\}>\{t\('expenses.disbursement.use_selected'/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.use_selected'], 'ใช้รายการที่เลือก');
});

test('cancelled document file actions name the cancelled band for both document kinds', () => {
  assert.match(source('./DisbursementVoucherDocumentFile.tsx'), /header.status === 'CANCELLED' \? kind === 'paid' \? 'expenses.disbursement.download_cancelled' : 'expenses.disbursement.print_cancelled'/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.print_cancelled'], 'พิมพ์ใบ (ยกเลิกแล้ว)');
  assert.equal(workspaceDictionary.th['expenses.disbursement.download_cancelled'], 'ดาวน์โหลดใบ (ยกเลิกแล้ว)');
});

test('the withholding amount wraps below the balance and number fields have no ellipsis', () => {
  const html = render(DisbursementVoucherExpenseRows, { rows: [{ expenseId: 'a', expenseNumber: 'EX-123456', expenseDate: '2026-10-12', outstandingAmount: '6790', whtAmount: '210', selectable: true }], amounts: {}, onToggle: () => {} });
  assert.match(html, /class="withholdingHint">ยอดนี้หักภาษี ณ ที่จ่ายไว้แล้ว/);
  assert.match(html, /210.00/); assert.doesNotMatch(html, /class="description">EX-123456/);
  const css = source('./disbursement-voucher-form.module.css');
  assert.match(css, /\.rowBalance \{ display: grid/);
  assert.match(css, /\.withholdingHint \{ white-space: normal/);
  assert.match(css, /\.rowInvoice \{ max-width: none; overflow: visible; text-overflow: clip/);
});
test('returned-by-another primary opens the chooser with self approval secondary and the returning person preferred', () => {
  const page = source('./DisbursementVoucherDocumentPage.tsx'), dialog = source('./DisbursementVoucherCommandDialog.tsx');
  assert.match(page, /disbursementVoucherPrimary\(detail, viewerUserId\)/);
  assert.match(page, /returnedApprover \? 'expenses.disbursement.send_other'/);
  assert.match(page, /returnedApprover && <button[^>]*onClick=\{\(\) => setDialog\('selfApprove'\)\}/);
  assert.match(dialog, /kind === 'submit' \? disbursementReturnedApprover\(detail, viewerUserId\) \?\? detail.header.requestedApproverUserId/);
  assert.match(dialog, /initialApprover\(data, preferredApprover\)/);
});

test('expense and invoice numbers stay whole while the neighbouring date can move to another line', () => {
  const html = render(DisbursementVoucherExpenseRows, { rows: [{ expenseId: 'e', expenseNumber: 'EXP-202610-00062', expenseDate: '2026-10-12', vendorInvoiceNumber: 'INV-202610-00062', outstandingAmount: '100', whtAmount: '0', selectable: true }], amounts: {}, onToggle: () => {} });
  assert.match(html, /<strong class="whitespace-nowrap">EXP-202610-00062<\/strong>/);
  assert.match(html, /class="[^"\n]*whitespace-nowrap"[^>]*>INV-202610-00062<\/span>/);
  const css = source('./disbursement-voucher-form.module.css');
  assert.match(css, /\.rowIdentity, \.rowDescription \{ flex-wrap: wrap/);
  assert.match(css, /\.rowIdentity strong \{ flex-shrink: 0/);
});
test('document numbers and line links stay unbroken in headers, list cards and tables', () => {
  const detail = source('./DisbursementVoucherDocumentPage.tsx'), list = source('./DisbursementVoucherListPage.tsx');
  assert.match(detail, /<span className="whitespace-nowrap">\{header.documentNumber\}<\/span>/);
  assert.match(detail, /<span className="whitespace-nowrap">\{line\.expenseNumber\}<\/span>/);
  // One way to the expense per line: the number is text, the receipt link is the only link.
  assert.equal((detail.match(/expenses\/\$\{encodeURIComponent\(line.expenseId\)\}/g) || []).length, 1);
  assert.match(list, /<span className="whitespace-nowrap">\{row.documentNumber\}<\/span>/);
  assert.match(list, /<td><span className="whitespace-nowrap">\{row.documentNumber/);
  const css = source('./disbursement-vouchers.module.css');
  assert.match(css, /\.cardHeader \{ display: flex; flex-wrap: wrap/);
  assert.match(css, /\.documentNumber \{ flex-basis: auto; min-width: min-content/);
});

test('the cancelled document page uses the payout helper (same rule as the print) and retains the original source-tax summary', () => {
  const page = source('./DisbursementVoucherDocumentPage.tsx');
  assert.match(page, /const display = disbursementVoucherDisplayAmount\(detail\)/);
  assert.match(page, /baht\(display.amount\)/);
  assert.match(page, /header\.paidRecordedAt \? 'expenses\.disbursement\.paid_amount'[\s\S]*?baht\(display\.amount\)/);
  assert.match(page, /display.excludesCancelled && <p[^>]*>\{t\('expenses.disbursement.cancelled_amount_note'/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.cancelled_amount_note'], 'ยอดนี้ไม่รวมรายการที่การจ่ายถูกยกเลิก');
});
test('returned drafts have an edit link beside the reason and the payment hint opens the existing withdraw dialog', () => {
  const page = source('./DisbursementVoucherDocumentPage.tsx'), pay = source('./DisbursementVoucherPayCard.tsx');
  const notice = page.slice(page.indexOf('{returned &&'), page.indexOf('<div className={styles.amount}'));
  assert.match(notice, /detail.actions.edit && <Link[^>]*href=\{`\$\{listHref\}\/new\?draft=\$\{encodeURIComponent\(id\)\}`\}/);
  assert.doesNotMatch(notice, /returned_next/);
  assert.match(page, /onWithdraw=\{\(\) => setDialog\('withdraw'\)\}/);
  assert.match(pay, /detail.actions.withdraw && onWithdraw \?/);
  assert.match(pay, /onClick=\{onWithdraw\}/);
  assert.match(pay, /disabled=\{busy \|\| needsRefresh \|\| slipUploading\}/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.pay_amount_hint_short'], 'ยอดจ่ายไม่ตรง? ');
});
test('choosing a payee advances after sources load, retains search and paged rows, and scrolls the selected row on Back', () => {
  const draft = source('./DisbursementVoucherDraftPage.tsx'), picker = source('./DisbursementVoucherPayeePicker.tsx');
  assert.match(draft, /const \[payeeSearch, setPayeeSearch\] = useState\(''\)/);
  assert.match(draft, /<div hidden=\{step !== 0\}>/);
  assert.match(draft, /search=\{payeeSearch\} onSearch=\{setPayeeSearch\}/);
  assert.match(draft, /visible=\{step === 0\}/);
  assert.match(draft, /available.length === 1 && available\[0\]!.selectable/);
  const choose = draft.slice(draft.indexOf('const choosePayee ='), draft.indexOf('const toggle ='));
  assert.ok(choose.indexOf('await listDisbursementPayableExpenses') < choose.lastIndexOf('setStep(1)'));
  assert.match(choose, /chosen.payeeKey === payee\?\.payeeKey[^}]*setStep\(1\)/);
  assert.match(picker, /if \(selected && visible\) chosenRow.current\?\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(picker, /aria-pressed=\{selected\}/);
  assert.match(draft, /<div className="relative">[\s\S]*?<fieldset[\s\S]*?<\/fieldset>\s*<CoverLoader[^>]*\/>/);
});
test('approval facts name the real approver and time, while a self approval stays identified', () => {
  const page = source('./DisbursementVoucherDocumentPage.tsx');
  assert.match(page, /header.approvedAt && <p[^>]*>\{t\('expenses.disbursement.approved_by_at'/);
  assert.match(page, /detail.approvedByName \?\? t\('expenses.disbursement.removed_member'/);
  assert.match(page, /formatThaiDateTime\(header.approvedAt\)/);
  assert.match(page, /header.selfApproved && <> ·/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.approved_by_at'], 'อนุมัติโดย {name} เมื่อ {time}');
});

test('amounts are shown once: equal amounts collapse, a line names its balance only when that says more', () => {
  const { disbursementSameAmount, disbursementLineShowsOutstanding } = require('./disbursement-vouchers.logic');
  assert.equal(disbursementSameAmount('700.0000', '700.00'), true); assert.equal(disbursementSameAmount('23000.0000', '22310.0000'), false);
  assert.equal(disbursementLineShowsOutstanding({ amount: '700.0000', outstandingAmount: '700.0000', expensePaymentId: null }), false);
  assert.equal(disbursementLineShowsOutstanding({ amount: '500.0000', outstandingAmount: '700.0000', expensePaymentId: null }), true);
  assert.equal(disbursementLineShowsOutstanding({ amount: '700.0000', outstandingAmount: '0.0000', expensePaymentId: 'p' }), false);
  assert.equal(disbursementLineShowsOutstanding({ amount: '700.0000', outstandingAmount: '700.0000', expensePaymentId: 'p' }), true);
});

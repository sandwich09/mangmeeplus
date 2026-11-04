import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
(globalThis as any).React = React;
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
for (const name of ['DisbursementVoucherPayCard', 'DisbursementVoucherSlip', 'DisbursementVoucherAccount', 'DisbursementVoucherDocumentFile', 'DisbursementVoucherWithholding']) {
  const path = require.resolve(`./${name}`); require(path);
  require.cache[path]!.exports = { [name]: () => React.createElement('div', { 'data-component': name }) };
}
const reissue = require.resolve('./DisbursementVoucherReissue'); require(reissue);
require.cache[reissue]!.exports = { DisbursementVoucherReissue: ({ children }: any) => children(() => null, null) };
const modal = require.resolve('@/common/components/modal'); require(modal);
require.cache[modal]!.exports = { Modal: ({ open, children }: any) => open ? React.createElement('aside', { 'data-testid': 'history' }, children) : null };
const { DisbursementVoucherDocumentPage } = require('./DisbursementVoucherDocumentPage');
const source = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
const base: any = { header: { id: 'doc', status: 'DRAFT', origin: 'PREPARED', payeeName: 'ร้านวัสดุ', documentNumber: null,
  preparedByUserId: 'maker', createdAt: '2026-10-15T01:00:00Z', totalAmount: '970.00', plannedMethod: 'BANK_TRANSFER', plannedPayDate: '2026-10-16', note: 'ส่งของแล้ว', payeeAccountLast4: '1234' },
  actions: { edit: true, submit: true }, preparerName: 'สมใจ', submittedByName: 'สมใจ', requestedApproverName: 'สมชาย', approvedByName: 'สมชาย', paidByName: 'สมใจ',
  lines: [{ expenseId: 'expense', expenseNumber: 'EXP-1', description: 'ค่าปูน', expenseDate: '2026-10-15', amount: '970.00', grandTotalAmount: '1000.00', whtAmount: '30.00', outstandingAmount: '970.00', withholdingCertificate: { state: 'NONE' } }], revisions: [] };
function render(detail: any, historyOpen = false) {
  const runtime = require('react'), original = runtime.useState;
  const names = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]); let i = 0;
  runtime.useState = (init: any) => { const pair = original(init), name = names[i++]; return name === 'detail' ? [detail, () => {}] : name === 'loading' ? [false, () => {}] : name === 'historyOpen' ? [historyOpen, () => {}] : pair; };
  try { return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push() {} } as any }, React.createElement(DisbursementVoucherDocumentPage, { companyId: 'shop', id: 'doc', permissions: ['expense.disbursement.read', 'expense.read'] }))); }
  finally { runtime.useState = original; }
}
for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) test(`VOUCH-DOC ${status}: payee heading, metrics, payment facts and accessible expense row`, () => {
  const html = render({ ...base, header: { ...base.header, status, documentNumber: 'PV-1', ...(status === 'PAID' ? { paidRecordedAt: '2026-10-15T02:00:00Z', paidDate: '2026-10-15', paidMethod: 'BANK_TRANSFER' } : {}) }, actions: { pay: status === 'APPROVED' } });
  assert.match(html, /mangmee-flat/); assert.match(html, /<h1[^>]*>ร้านวัสดุ<\/h1>/);
  assert.match(html, new RegExp({ DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'รอจ่าย', PAID: 'จ่ายแล้ว', CANCELLED: 'ยกเลิกแล้ว' }[status]!));
  assert.match(html, /กลับไปรายการ/); assert.match(html, /รายการในใบนี้ \(1\)/);
  assert.equal((html.match(/หลักฐานว่าบันทึกจ่ายแล้ว/g) ?? []).length, status === 'PAID' ? 1 : 0);
  assert.match(html, /aria-label="เปิดรายจ่าย EXP-1"/);
  const main = html.match(/<section class="[^"]*mainCard[^"]*">([\s\S]*?)<\/section>/)![1];
  assert.ok(html.indexOf('PV-1') < html.indexOf('<h1'));
  assert.match(main, /970.00[\s\S]*บาท/); if (status === 'APPROVED') assert.doesNotMatch(main, /บัญชีผู้รับ/); else assert.match(main, /บัญชีผู้รับ/);
  assert.doesNotMatch(html, />จ่ายให้<|>การจ่าย<|จัดทำและส่งโดย|จัดทำโดย|อนุมัติโดย|ผู้บันทึกจ่าย|บันทึกเมื่อ|—/);
  assert.equal(html.includes('aria-label="ขั้นตอน"'), !['PAID', 'CANCELLED'].includes(status));
  if (status === 'PENDING_APPROVAL') assert.match(main, /รอ สมชาย อนุมัติ/);
  if (status !== 'PAID') assert.match(main, /กำหนดจ่าย[\s\S]*วิธีที่จะจ่าย[\s\S]*หมายเหตุ/);
  assert.match(html, /970.00[\s\S]*บาท[\s\S]*รวมเป็นเงิน[\s\S]*1,000.00[\s\S]*หัก ณ ที่จ่าย/);
  assert.doesNotMatch(html, /ตรวจรายการ แล้ว|จ่ายเงินให้ผู้รับเงิน แล้ว/);
  if (status === 'PAID') { assert.match(main, /ยอดที่จ่าย/); assert.match(main, /วันที่จ่าย[\s\S]*15 ต.ค. 2569[\s\S]*วิธีจ่าย[\s\S]*โอนเงิน/); assert.match(main, /DisbursementVoucherSlip/); assert.doesNotMatch(main, /กำหนดจ่าย|วิธีที่จะจ่าย|ส่งของแล้ว/); }
  if (status === 'APPROVED') assert.match(main, /DisbursementVoucherPayCard/);
});
test('VOUCH-DOC returned draft has one return notice and edit action', () => {
  const html = render({ ...base, revisions: [{ revision: 1, submittedAt: '2026-10-15T01:00:00Z', decision: 'RETURNED', decidedAt: '2026-10-15T02:00:00Z', decidedByName: 'สมชาย', decisionReason: 'แก้ยอดเงิน' }] });
  assert.match(html, /ส่งกลับให้แก้/); assert.match(html, /แก้ยอดเงิน/); assert.match(html, />แก้ไข<\/a>/);
});
test('VOUCH-DOC3 empty facts and zero withholding are omitted', () => {
  const html = render({ ...base, header: { ...base.header, submittedByUserId: 'maker', submittedAt: '2026-10-15T02:00:00Z' }, lines: [{ ...base.lines[0], whtAmount: '0.00' }] });
  assert.doesNotMatch(html, /จัดทำและส่งโดย|จัดทำโดย/);
  assert.doesNotMatch(html, /หัก ณ ที่จ่าย/);
});

test('voucher line metadata shows the vendor invoice before the phone date and omits empty invoices', () => {
  for (const vendorInvoiceNumber of ['INV-W7', null, '', '   ']) {
    const html = render({ ...base, lines: [{ ...base.lines[0], vendorInvoiceNumber }] });
    const metadata = html.match(/<div class="documentLineDescription">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)![1];
    const wide = metadata.replace(/<span class="linePhoneDate">[\s\S]*?<\/span>/g, '').replace(/<[^>]*>/g, '');
    const phone = metadata.replace(/<[^>]*>/g, '');
    assert.equal(wide, vendorInvoiceNumber?.trim() ? 'EXP-1 · INV-W7' : 'EXP-1');
    assert.equal(phone, vendorInvoiceNumber?.trim() ? 'EXP-1 · INV-W7 · 15 ต.ค. 2569' : 'EXP-1 · 15 ต.ค. 2569');
  }
});

test('VOUCH-DOC3 absent optional facts leave no placeholder', () => {
  const html = render({ ...base, header: { ...base.header, plannedMethod: null, plannedPayDate: null, payeeAccountLast4: null, note: '  ' }, lines: [{ ...base.lines[0], whtAmount: '0' }] });
  assert.doesNotMatch(html, /—|กำหนดจ่าย|วิธีที่จะจ่าย|บัญชีผู้รับ|หมายเหตุ|รวมเป็นเงิน|หัก ณ ที่จ่าย/);
});
test('VOUCH-DOC3 history keeps preparation, submission, approval and payment author and times', () => {
  const detail = { ...base, header: { ...base.header, status: 'PAID', submittedByUserId: 'maker', submittedAt: '2026-10-15T02:00:00Z', approvedAt: '2026-10-15T03:00:00Z', paidRecordedAt: '2026-10-15T04:00:00Z' } };
  assert.doesNotMatch(render(detail), /สมใจ|สมชาย|08:00|09:00|10:00|11:00/);
  const history = render(detail, true).split('data-testid="history"')[1]!;
  for (const fact of ['สมใจ', 'สมชาย', '08:00', '09:00', '10:00', '11:00', 'สร้างใบ', 'ส่งอนุมัติ', 'อนุมัติ', 'บันทึกว่าจ่ายแล้ว']) assert.ok(history.includes(fact), fact);
});

test('VOUCH-DOC3 pending decision and reminder share the main card; cancelled payment evidence stays in history', () => {
  const pending = render({ ...base, header: { ...base.header, status: 'PENDING_APPROVAL', lastReminderAt: '2026-10-15T03:00:00Z' }, lastReminderToName: 'สมชาย' });
  const card = pending.match(/<section class="[^"]*mainCard[^"]*">([\s\S]*?)<\/section>/)![1];
  assert.match(card, /รอ สมชาย อนุมัติ[\s\S]*เตือนล่าสุด/);
  const cancelled = { ...base, header: { ...base.header, status: 'CANCELLED', paidRecordedAt: '2026-10-15T04:00:00Z', paidDate: '2026-10-14', paidMethod: 'CASH', paidFromRef: 'เงินสดย่อย' } };
  assert.doesNotMatch(render(cancelled), /DisbursementVoucherSlip|14 ต.ค. 2569|เงินสดย่อย/);
  const history = render(cancelled, true).split('data-testid="history"')[1]!;
  assert.match(history, /14 ต.ค. 2569[\s\S]*เงินสด[\s\S]*เงินสดย่อย[\s\S]*DisbursementVoucherSlip/);
});

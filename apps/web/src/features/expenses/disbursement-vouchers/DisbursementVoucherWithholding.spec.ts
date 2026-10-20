import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = {}; };
const { DisbursementVoucherWithholding } = require('./DisbursementVoucherWithholding');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const lines = ['NONE', 'PENDING', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED'].map((state, index) => ({
  expenseId: `e/${index}`, expenseNumber: `EX-${index}`, whtAmount: '30',
  withholdingCertificate: { state, number: index > 1 ? `WHT-${index}` : null },
}));
const render = (canIssue: boolean, rows = lines) => renderToStaticMarkup(React.createElement('div', {}, rows.map(line => React.createElement(DisbursementVoucherWithholding, {
  key: line.expenseId, companyId: 'shop', detail: { header: { status: 'PAID' }, lines: [line] }, line, canIssue,
}))));
test('certificate guidance and its one-line action sit with each expense without repeating its number', () => {
  const html = render(true);
  assert.doesNotMatch(html, /EX-0|e%2F0/);
  assert.match(html, /รายการนี้หักภาษี ณ ที่จ่ายไว้ ยังไม่ได้ออกหนังสือรับรอง \(50 ทวิ\)/);
  assert.match(html, /whitespace-nowrap" href="[^"]+">ไปออกหนังสือรับรอง/);
  assert.doesNotMatch(html, /ไปออกหนังสือรับรอง ·|ดูหนังสือรับรอง ·/);
  assert.match(html, /ออกหนังสือรับรอง \(50 ทวิ\) ให้ผู้รับเงินแล้ว เลขที่ <span><span class="whitespace-nowrap">WHT-2/);
  assert.match(html, /จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบแล้ว เลขที่ <span><span class="whitespace-nowrap">WHT-3/);
  assert.equal((html.match(/ดูหนังสือรับรอง/g) ?? []).length, 2);
  for (const index of [1, 2, 3]) assert.match(html, new RegExp(`href="/companies/shop/expenses/e%2F${index}\\?section=wht-certificate#wht-certificate"`));
  const noRight = render(false);
  assert.match(noRight, /ถ้าทำหนังสือรับรองนอกระบบแล้ว บันทึกไว้ได้ที่หน้ารายจ่าย/);
  assert.match(noRight, /เปิดรายการ/);
  assert.doesNotMatch(noRight, /ไปออกหนังสือรับรอง/);
  assert.equal((noRight.match(/ดูหนังสือรับรอง/g) ?? []).length, 2);
});
test('each expense keeps its certificate sentence and number, including missing-number cases', () => {
  const html = render(true, [...lines, { ...lines[2]!, expenseId: 'second', expenseNumber: 'EX-4', withholdingCertificate: { state: 'SYSTEM_ISSUED', number: 'WHT-4' } }]);
  assert.equal(html.split('ให้ผู้รับเงินแล้ว').length - 1, 2);
  assert.match(html, /whitespace-nowrap">WHT-2/); assert.match(html, /whitespace-nowrap">WHT-4/);
  const missing = render(false, [{ ...lines[3]!, withholdingCertificate: { state: 'EXTERNAL_LINKED', number: null } }]);
  assert.match(missing, /จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบแล้ว/); assert.doesNotMatch(missing, /เลขที่ <span>|WHT-/);
});

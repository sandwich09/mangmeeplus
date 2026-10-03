import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expenseCapabilities } from './expenses.model';

// Match the shared field tests when tsx renders Next's automatic-JSX components in Node. The
// component is imported inside `render`, after this line: ExpensesUi builds its icons at load.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function render(permissions: string[]): Promise<string> {
  const { ManualExpenseEntryNotEnabled } = await import('./ManualExpenseEntryNotEnabled');
  return renderToStaticMarkup(
    React.createElement(ManualExpenseEntryNotEnabled, { companyId: 'co-1', caps: expenseCapabilities(permissions) }),
  );
}
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);

// manual-expense-web-entry-flag spec §8: what a holder of expense.create sees on the manual page
// of a company that does not show it. It is a screen state, not a refusal: no "ไม่มีสิทธิ์" wording,
// and never a button the reader could not open.
test('says the page is not enabled for the shop and offers the two ways on that the reader may use', async () => {
  const html = await render(['expense.create', 'expense.read_own', 'expense.receipt.upload']);
  assert.match(html, />หน้าบันทึกด้วยมือไม่ได้เปิดใช้สำหรับร้านของคุณ</);
  assert.deepEqual(hrefs(html), [
    ['/companies/co-1/expenses/upload', 'อัปโหลดใบเสร็จ'],
    ['/companies/co-1/expenses', 'ไปหน้ารายการค่าใช้จ่าย'],
  ]);
  assert.doesNotMatch(html, /กรุณาติดต่อ/);
});

test('offers only the button the reader may open', async () => {
  assert.deepEqual(hrefs(await render(['expense.create', 'expense.read_own'])), [['/companies/co-1/expenses', 'ไปหน้ารายการค่าใช้จ่าย']]);
  assert.deepEqual(hrefs(await render(['expense.create', 'expense.receipt.upload'])), [['/companies/co-1/expenses/upload', 'อัปโหลดใบเสร็จ']]);
});

// The reader lacks the rights to upload and to open the list. Only the business owner can grant every
// right, so the owner is the one to ask; "ผู้ดูแลร้าน" is no role a shop has.
test('with no button to offer, asks the reader to contact the business owner and leaves no link behind', async () => {
  const html = await render(['expense.create']);
  assert.match(html, />หน้าบันทึกด้วยมือไม่ได้เปิดใช้สำหรับร้านของคุณ</);
  assert.match(html, />กรุณาติดต่อเจ้าของกิจการ</);
  assert.doesNotMatch(html, /ผู้ดูแลร้าน/);
  assert.deepEqual(hrefs(html), []);
  assert.doesNotMatch(html, /<button/);
});

test('never words the state as a missing permission, a hidden page or a closed system', async () => {
  for (const permissions of [['expense.create'], ['expense.create', 'expense.read', 'expense.receipt.upload']]) {
    assert.doesNotMatch(await render(permissions), /ไม่มีสิทธิ์|ซ่อน|ยังไม่เปิดใช้|ระบบ|Forbidden/);
  }
});

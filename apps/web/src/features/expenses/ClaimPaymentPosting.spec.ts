import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UnpostedClaimPayment } from '../ledger/ledger.api';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const pending: UnpostedClaimPayment = {
  paymentId: 'cmpaymentpending0001', reimbursementRequestId: 'cmrequest0000000001', requestNo: 'RB-202602-0001',
  requesterDisplayNameSnapshot: 'สมชาย ใจดี', paymentNo: 'RBPAY-202602-000001', paidAmount: '500.5000', currency: 'THB',
  paidAt: '2026-02-01T00:00:00.000Z', postingStatus: 'pending',
};
const failed: UnpostedClaimPayment = {
  ...pending, paymentId: 'cmpaymentfailed00002', reimbursementRequestId: 'cmrequest0000000002', requestNo: 'RB-202602-0002',
  requesterDisplayNameSnapshot: 'วิไล', paymentNo: 'RBPAY-202602-000002', paidAmount: '1289', postingStatus: 'posting_error',
};

async function render(props: Partial<{ rows: UnpostedClaimPayment[]; postingId: string | null; error: string | null }> = {}): Promise<string> {
  const { ClaimPaymentPostingList } = await import('./ClaimPaymentPosting');
  return renderToStaticMarkup(React.createElement(ClaimPaymentPostingList, {
    companyId: 'company-1', rows: [pending, failed], postingId: null, error: null, onPost: () => undefined, ...props,
  }));
}

/** The words a person reads: markup stripped, so an id inside an href does not count as shown. */
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('lists each unposted claim payout in plain Thai with its own posting action', async () => {
  const html = await render();
  const text = visibleText(html);
  assert.match(text, /การจ่ายเงินคืนใบเบิกที่ยังไม่ลงบัญชี \(2 รายการ\)/);
  assert.match(text, /ต้องลงให้ครบก่อนจึงจะปิดงวดได้/);
  // What was paid, to whom, when — the facts an accountant checks before posting.
  assert.match(text, /RB-202602-0001/);
  assert.match(text, /จ่ายคืน สมชาย ใจดี · เลขที่จ่าย RBPAY-202602-000001/);
  assert.match(text, /฿500\.50/);
  assert.match(text, /฿1,289\.00/);
  assert.match(text, /จ่ายเมื่อ 1 ก\.พ\. 2569/);
  // A payout still waiting and one whose last attempt failed read differently, and so do their buttons.
  const [waitingRow, failedRow] = html.split('<li ').slice(1).map(visibleText);
  assert.match(waitingRow!, /RB-202602-0001.*รอบันทึกบัญชี.*ลงบัญชี/);
  assert.doesNotMatch(waitingRow!, /บันทึกผิดพลาด|ลองอีกครั้ง/);
  assert.match(failedRow!, /RB-202602-0002.*บันทึกผิดพลาด.*ลองอีกครั้ง/);
  assert.doesNotMatch(failedRow!, /รอบันทึกบัญชี/);
  assert.equal((html.match(/>ลงบัญชี<\/button>/g) ?? []).length, 1);
  assert.equal((html.match(/>ลองอีกครั้ง<\/button>/g) ?? []).length, 1);
  // Each row opens its claim.
  assert.match(html, /href="\/companies\/company-1\/reimbursements\/cmrequest0000000001"/);
});

test('shows no machine token: no ids, status keys, currency code or ISO date', async () => {
  const text = visibleText(await render({ error: 'ยังไม่มีกฎลงบัญชีที่ผ่านการตรวจสำหรับเอกสารนี้ จึงยังไม่สร้างรายการบัญชี' }));
  assert.doesNotMatch(text, /cmpayment|cmrequest/);
  assert.doesNotMatch(text, /posting_error|pending|RECORDED|reimbursement\.payment/);
  assert.doesNotMatch(text, /THB|2026-02-01|T00:00/);
  assert.doesNotMatch(text, /\d+\.\d{3,}/, 'money is printed to the satang, never 4 decimals');
});

test('a row with no claim number, payer name or payment number falls back to words, never to an id', async () => {
  const bare: UnpostedClaimPayment = { paymentId: 'cmpaymentbare0000003', reimbursementRequestId: 'cmrequest0000000003', paidAmount: '75', currency: 'THB', paidAt: '2026-02-03T00:00:00.000Z', postingStatus: 'pending' };
  const text = visibleText(await render({ rows: [bare] }));
  assert.match(text, /ใบเบิก ฿75\.00 จ่ายคืน พนักงาน จ่ายเมื่อ 3 ก\.พ\. 2569/);
  assert.doesNotMatch(text, /เลขที่จ่าย|undefined|null|cmpayment|cmrequest/);
});

test('a payout in another currency keeps its own code instead of a baht sign', async () => {
  const text = visibleText(await render({ rows: [{ ...pending, currency: 'USD', paidAmount: '20' }] }));
  assert.match(text, /20\.00 USD/);
  assert.doesNotMatch(text, /฿/);
});

test('a refused post stays on screen as an alert, with the row still there to retry', async () => {
  const html = await render({ error: 'ต้องลงบัญชีตั้งหนี้ของใบเบิกให้เสร็จก่อน จึงจะบันทึกการจ่ายได้' });
  assert.match(html, /role="alert"[^>]*>⚠ ต้องลงบัญชีตั้งหนี้ของใบเบิกให้เสร็จก่อน/);
  assert.equal((html.match(/<li /g) ?? []).length, 2);
});

test('while one payout is posting, its button says so and no second post can start', async () => {
  const html = await render({ postingId: pending.paymentId });
  assert.equal((html.match(/>กำลังลง\.\.\.<\/button>/g) ?? []).length, 1);
  assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2, 'every posting button is locked meanwhile');
});

test('takes no room when nothing is waiting, and still reports a load failure', async () => {
  assert.equal(await render({ rows: [] }), '');
  const html = await render({ rows: [], error: 'โหลดรายการไม่สำเร็จ' });
  assert.match(html, /role="alert"/);
  assert.match(visibleText(html), /\(0 รายการ\)/);
});

test('reads top to bottom on a 390px phone: stacked cards, amount in view, full-width action', async () => {
  const html = await render();
  assert.doesNotMatch(html, /<table/, 'no table to scroll sideways on a phone');
  assert.match(html, /<li [^>]*class="[^"]*sm:flex/, 'a row only becomes a single line from the sm breakpoint up');
  // The amount is printed once per layout; the phone copy sits beside the claim number.
  assert.equal((html.match(/sm:hidden[^>]*>฿500\.50</g) ?? []).length, 1);
  assert.equal((html.match(/hidden [^"]*sm:inline[^>]*>฿500\.50</g) ?? []).length, 1);
  assert.equal((html.match(/<button[^>]*class="[^"]*mangmee-btn[^"]*w-full sm:w-auto/g) ?? []).length, 2);
  assert.match(html, /class="[^"]*truncate[^"]*"[^>]*href=/, 'a long claim number cannot push the amount off screen');
  assert.match(html, /break-words/);
});

test('posts through the existing generator and worklist endpoint, and follows the same switch as the other posting buttons', () => {
  const section = read('./ClaimPaymentPosting.tsx');
  assert.match(section, /generateSourceJournal\(companyId, 'reimbursement\.payment', paymentId\)/);
  assert.match(section, /listUnpostedClaimPayments\(companyId\)/);
  assert.match(read('../ledger/ledger.api.ts'), /apiFetch\(`\/v1\/companies\/\$\{companyId\}\/reimbursements\/posting\/pending`\)/);

  const source = read('./ExpensesWorkspacePanels.tsx');
  const panel = source.slice(source.indexOf('export function EvidencePanel('));
  assert.match(panel, /\{canPostClaimPayments && <ClaimPaymentPosting companyId=\{companyId\} \/>\}/);
  assert.ok(panel.indexOf('{!error && (') > 0 && panel.indexOf('<ClaimPaymentPosting') < panel.indexOf('{!error && ('),
    'a refused post must not be hidden with the rest of the panel');
  // `canPostLedger` already carries the accounting-screens switch and both ledger posting rights;
  // the worklist endpoint asks for the finance-review right on top.
  assert.match(read('./ExpensesPages.tsx'), /canPostClaimPayments=\{caps\.canPostLedger && permissions\.includes\('reimbursement\.finance_review'\)\}/);
  assert.match(read('./expenses.model.ts'), /canPostLedger: !ACCOUNTING_UI_HIDDEN && has\('journal\.entry\.create'\) && has\('journal\.entry\.post'\)/);
});

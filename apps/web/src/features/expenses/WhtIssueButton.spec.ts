import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const modal = mutable('@/common/components/modal/Modal');
const { WhtIssueButton } = require('./WhtIssueButton');

const handoff = (address: string | null = '  บ้านเลขที่ 99\nถนนใหม่  ') => ({ id: 'handoff', payeeAddress: address, prefill: {
  payeeSnapshot: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1234567890123', address: 'ที่อยู่ในใบเสร็จ' },
  incomeCategoryName: 'ค่าบริการ', grossAmount: '10000.0000', withheldAmount: '300.0000',
} });
function setup(onIssue = async () => {}, unpaid?: boolean, address?: string | null) {
  const timers: Array<{ fn: () => void; delay: number }> = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return 1; }, clearTimeout() {} } });
  const transport = mock.method(modal, 'Modal', ({ title, children, footer }: any) => h('section', null, h('h2', null, title), children, footer));
  const row = handoff(address);
  const view = certificateHarness(() => h(WhtIssueButton, { handoff: row, unpaid, onIssue }));
  return { ...view, row, timers, close() { view.cleanup(); transport.mock.restore(); if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as any).window; } };
}

test('issue opens one confirmation with the frozen print facts, the typed address and grouped tax digits; closing issues nothing', () => {
  let issued = 0;
  const view = setup(async () => { issued++; });
  try {
    const frozen = JSON.stringify(view.row.prefill);
    assert.ok(view.render().includes('ออกหนังสือรับรอง 50 ทวิ')); assert.doesNotMatch(view.render(), /<h2/);
    view.find('button').onClick(); const html = view.render(true);
    for (const words of ['ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน', 'บริษัท ผู้รับเงิน จำกัด', '1-2345-67890-12-3', 'บ้านเลขที่ 99\nถนนใหม่', 'ค่าบริการ', '฿10,000.00', '฿300.00', 'ออกแล้วได้เลขที่ทันที ถ้าผิดต้องยกเลิกแล้วออกใหม่']) assert.ok(html.includes(words), words);
    assert.ok(!html.includes('ที่อยู่ในใบเสร็จ')); assert.equal((html.match(/<p /g) ?? []).length, 1); assert.equal(issued, 0);
    assert.equal(view.find('Button', p => p.variant === 'primary').disabled, true);
    view.find('Button', p => p.variant === 'secondary').onClick(); assert.doesNotMatch(view.render(), /<h2/); assert.equal(issued, 0);
    assert.equal(JSON.stringify(view.row.prefill), frozen);
  } finally { view.close(); }
});

test('confirming waits 600 ms and calls issue once even on a double press', async () => {
  let calls = 0, release!: () => void;
  const view = setup(() => { calls++; return new Promise<void>(resolve => { release = resolve; }); });
  try {
    view.render(); view.find('button').onClick(); view.render(true);
    view.find('Button', p => p.variant === 'primary').onClick(); assert.equal(calls, 0);
    assert.equal(view.timers[0]!.delay, 600);
    assert.equal(view.find('Button', p => p.variant === 'secondary').disabled, false);
    view.timers.shift()!.fn(); view.render();
    const confirm = view.find('Button', p => p.variant === 'primary'); assert.equal(confirm.disabled, false);
    confirm.onClick(); confirm.onClick(); assert.equal(calls, 1);
    view.render(); assert.equal(view.find('Button', p => p.variant === 'primary').loading, true);
    assert.ok(view.render().includes('กำลังออกหนังสือรับรอง…'));
    release(); await view.settle(); assert.doesNotMatch(view.render(), /<h2/); assert.equal(calls, 1);
  } finally { view.close(); }
});

test('the unpaid tag is only shown for a known unpaid expense; an absent typed address falls back to the snapshot', () => {
  for (const unpaid of [true, false, undefined]) {
    const view = setup(undefined, unpaid, null);
    try { view.render(); view.find('button').onClick(); const html = view.render(); assert.equal(html.includes('ยังไม่ได้บันทึกว่าจ่าย'), unpaid === true); assert.ok(html.includes('ที่อยู่ในใบเสร็จ')); }
    finally { view.close(); }
  }
});

test('expense, list and accounts-payable issue actions all use the same confirmation and only the expense supplies payment state', () => {
  const expense = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  const list = readFileSync(new URL('./WhtCertificatesPage.tsx', import.meta.url), 'utf8');
  const ap = readFileSync(new URL('../accounts-payable/AccountsPayablePages.tsx', import.meta.url), 'utf8');
  for (const source of [expense, list, ap]) assert.match(source, /<WhtIssueButton/);
  assert.match(expense, /unpaid=\{detail\.paymentStatus !== 'PAID'\}/);
  assert.doesNotMatch(list, /<WhtIssueButton[^>]*unpaid=/); assert.doesNotMatch(ap, /<WhtIssueButton[^>]*unpaid=/);
});

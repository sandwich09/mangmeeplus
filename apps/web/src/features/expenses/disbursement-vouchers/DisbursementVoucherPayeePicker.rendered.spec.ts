import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expense-certificate-test-harness';
const css = require.extensions['.css'], svg = require.extensions['.svg'];
require.extensions['.css'] = (m: any) => { m.exports = {}; };
require.extensions['.svg'] = (m: any) => { m.exports = () => null; };
const api = mutable('./disbursement-vouchers/disbursement-vouchers.api');
const { DisbursementVoucherPayeePicker, DisbursementVoucherPayeeRow } = require('./DisbursementVoucherPayeePicker');
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const row = (id: number) => ({ payeeKey: String(id), displayName: `ร้าน ${id}`, taxId: '0123456789012', expenseCount: 1, selectableExpenseCount: 1, totalOutstanding: '100.00', allReserved: false });

test('prominent ten-payee pager replaces repeated page responses and search returns to page one', async () => {
  const previousWindow = globalThis.window;
  const timers = new Map<number, () => void>(); let timerId = 0; let search = '';
  (globalThis as any).window = { setTimeout(fn: () => void) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id: number) { timers.delete(id); } };
  const calls: any[] = [];
  const read = mock.method(api, 'listDisbursementPayees', async (_company: string, query: any) => {
    calls.push(query); return { data: Array.from({ length: 10 }, (_, i) => row((query.page - 1) * 10 + i)), total: 20, page: query.page, pageSize: query.pageSize };
  });
  const view = certificateHarness(() => h(DisbursementVoucherPayeePicker, { companyId: 'shop', search, onSearch(value: string) { search = value; }, onChoose() {} }));
  const load = async () => { view.render(true); for (const [id, fn] of timers) { timers.delete(id); fn(); } await view.settle(); return view.render(); };
  const keys = () => view.nodes.filter(node => node.tag === 'DisbursementVoucherPayeeRow').map(node => node.props.payee.payeeKey);
  try {
    let html = await load(); assert.match(html, /หน้า 1 จาก 2/); assert.doesNotMatch(html, /โหลดเพิ่ม|แสดง \d+-/);
    assert.equal(view.find('Pagination').prominent, true); assert.equal(calls[0].pageSize, 10);
    const first = keys(); assert.equal(first.length, 10);
    view.find('Pagination').onPageChange(2); html = await load(); assert.match(html, /หน้า 2 จาก 2/);
    const second = keys(); assert.equal(second.length, 10); assert.ok(second.every(key => !first.includes(key)));
    await load(); assert.deepEqual(keys(), second); // A repeat fetch/effect must replace, never append.
    view.find('Pagination').onPageChange(1); await load(); assert.deepEqual(keys(), first);
    view.find('Pagination').onPageChange(2); await load(); assert.deepEqual(keys(), second);
    view.find('input', p => p.type === 'search').onChange({ target: { value: 'ร้าน' } });
    html = await load(); assert.match(html, /หน้า 1 จาก 2/); assert.equal(calls.at(-1).page, 1); assert.equal(calls.at(-1).search, 'ร้าน');
  } finally { view.cleanup(); read.mock.restore(); (globalThis as any).window = previousWindow; }
});
test('payee row always has a usable name and keeps the tax number', () => {
  for (const displayName of ['', ' \t ', 'ร้าน ก']) {
    const view = certificateHarness(() => h(DisbursementVoucherPayeeRow, { companyId: 'shop', payee: { ...row(1), displayName }, selected: false, onChoose() {} }));
    const html = view.render(); assert.match(html, displayName.trim() ? /ร้าน ก/ : /ไม่มีชื่อผู้รับเงิน/); assert.match(html, /0123456789012/);
  }
});

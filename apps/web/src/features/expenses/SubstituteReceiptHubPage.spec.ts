import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext, PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { SubstituteReceiptListItem, SubstituteReceiptListResult } from '@watchdog-bms/contracts';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const loaders = ['.svg', '.css'].map(ext => [ext, require.extensions[ext]] as const);
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
const outsideClick = mock.method(mutable('@/common/hooks/use-close-on-outside-click'), 'useCloseOnOutsideClick', () => {});
after(() => outsideClick.mock.restore());
const api = mutable('./expenses.api');
const { SubstituteReceiptHubPage } = require('./SubstituteReceiptHubPage');
for (const [ext, loader] of loaders) { if (loader) require.extensions[ext] = loader; else delete require.extensions[ext]; }
const item = (over: Partial<SubstituteReceiptListItem> = {}): SubstituteReceiptListItem => ({
  evidenceId: 'receipt-1', expenseId: 'expense-1', documentNumber: 'SRC-202610-00001', version: 1, status: 'PREPARED',
  expenseNumber: 'EXP-202610-00001', expenseDate: '2026-10-01', paymentDate: '2026-10-02', payeeName: 'ร้านชื่อยาวทดสอบ',
  payeeAddress: null, payeeTaxId: null, currency: 'THB', grandTotalAmount: '1234.50', payerUserId: 'me', payerName: 'ฉัน',
  approverUserId: null, approverName: null, artifactAttachmentId: null, certifiedArtifactAttachmentId: null,
  updatedAt: '2026-10-03', fundingSource: 'COMPANY', ...over,
});
const data = (items = [item()]): SubstituteReceiptListResult => ({ items, total: 24, page: 1, pageSize: 10,
  counts: { PREPARED: 12, PAYER_CERTIFIED: 3, ISSUED: 8, SUPERSEDED: 1 }, sums: { total: '24000.25' },
  attention: { signature: { count: 12, evidenceId: 'receipt-1' }, approval: { count: 3, evidenceId: 'receipt-approve' } },
});
function setup(query = '', result: SubstituteReceiptListResult | null = data()) {
  const params = new URLSearchParams(query); const replaced: string[] = [], pushed: string[] = [];
  const router = { replace: (href: string) => replaced.push(href), push: (href: string) => pushed.push(href), prefetch: () => {} };
  const props = { companyId: 'co', userId: 'me', permissions: ['expense.review'], canSelfApprove: true };
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: router as any }, h(SearchParamsContext.Provider, { value: params },
    h(PathnameContext.Provider, { value: '/companies/co/expenses/substitute-receipts' }, h(SubstituteReceiptHubPage, props)))), [false, result, false, null, 0]);
  return { ...view, params, pushed, replaced };
}
test('hub shows all-page metrics, five counted tabs, prominent ten-row pager and one row target', () => {
  const view = setup(); const html = view.render();
  assert.match(html, /mangmee-flat/); assert.match(html, /24,000.25/); assert.match(html, /หน้า 1 จาก 3/);
  const metric = view.find('MetricGrid'); assert.deepEqual(metric.items.map((x: any) => [x.label, x.value, x.unit]), [['ใบรับรอง', '24', 'ใบ'], ['ยอดรวม', '24,000.25', 'บาท']]);
  assert.deepEqual(view.find('FilterTabs').tabs.map((x: any) => [x.label, x.count]), [['ทั้งหมด', 24], ['รอเซ็น', 12], ['รออนุมัติ', 3], ['ออกแล้ว', 8], ['ยกเลิกแล้ว', 1]]);
  assert.equal(view.find('Pagination').prominent, true);
  assert.deepEqual(view.nodes.filter(x => x.tag === 'col').map(x => x.props.style.width), ['34%', '16%', '20%', '15%', '15%']);
  assert.match(html, /เงินของร้าน/); assert.match(html, /มี 3 ใบรอคุณอนุมัติ/);
  assert.doesNotMatch(html, /ดูเอกสาร|สร้างใบเบิก|แสดง 1-|฿|<select|<dialog/);
  assert.equal(view.nodes.filter(x => x.tag === 'a' && x.props.children.includes('SRC-202610-00001')).length, 0);
  view.cleanup();
});
test('table and phone card open the document by press or Enter, with no nested row action', () => {
  const view = setup(); view.render();
  for (const tag of ['tr', 'li']) {
    const row = view.find(tag, p => p.role === 'link'); assert.equal(row.tabIndex, 0);
    assert.match(row['aria-label'], /SRC-202610-00001 ร้านชื่อยาวทดสอบ/);
    row.onClick(); const current = {}; let prevented = false;
    row.onKeyDown({ key: 'Enter', target: current, currentTarget: current, preventDefault: () => { prevented = true; } });
    assert.ok(prevented); assert.deepEqual(view.pushed.slice(-2), ['/companies/co/expenses/substitute-receipts/receipt-1', '/companies/co/expenses/substitute-receipts/receipt-1']);
    row.onKeyDown({ key: ' ', target: current, currentTarget: current });
  }
  assert.equal(view.pushed.length, 4); view.cleanup();
});
test('sort, tab and month reset page one; pager retains the selected filters', () => {
  const view = setup('page=3&status=ISSUED&yearMonth=2026-10&order=newest'); view.render();
  view.find('button', p => p['aria-label'] === 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่').onClick();
  let query = new URL(view.replaced.at(-1)!, 'http://local').searchParams;
  assert.equal(query.get('page'), '1'); assert.equal(query.get('order'), 'oldest'); assert.equal(query.get('status'), 'ISSUED');
  view.find('FilterTabs').onChange('SUPERSEDED');
  query = new URL(view.replaced.at(-1)!, 'http://local').searchParams; assert.equal(query.get('page'), '1'); assert.equal(query.get('status'), 'SUPERSEDED');
  view.find('ThemedDate').onChange({ target: { value: '2026-09' } });
  query = new URL(view.replaced.at(-1)!, 'http://local').searchParams; assert.equal(query.get('page'), '1'); assert.equal(query.get('yearMonth'), '2026-09');
  view.find('Pagination').onPageChange(2);
  query = new URL(view.replaced.at(-1)!, 'http://local').searchParams; assert.equal(query.get('page'), '2'); assert.equal(query.get('yearMonth'), '2026-10'); view.cleanup();
});
test('the request sends server date order and ten-row paging, and replaces a page without appending', async () => {
  const originalSelf = globalThis.self; globalThis.self = globalThis as any;
  const calls: unknown[] = [];
  const request = mock.method(api, 'listCompanySubstituteReceipts', async (...args: unknown[]) => { calls.push(args); return data([item({ evidenceId: 'page-two', documentNumber: 'SRC-TWO' })]); });
  const view = setup('page=2&order=oldest&yearMonth=2026-10&status=ISSUED');
  try {
    view.render(true); await view.settle(); const html = view.render();
    assert.deepEqual(calls, [['co', { status: 'ISSUED', yearMonth: '2026-10', page: 2, order: 'oldest', pageSize: 10 }]]);
    assert.doesNotMatch(html, /SRC-202610-00001/); assert.match(html, /SRC-TWO/);
    assert.equal(view.nodes.filter(n => n.tag === 'tr' && n.props.role === 'link').length, 1);
  } finally { view.cleanup(); request.mock.restore(); if (originalSelf === undefined) delete (globalThis as any).self; else globalThis.self = originalSelf; }
});
test('phone and table retain every state, fallback names and personal funding without row buttons', () => {
  const rows = ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED'].map((status, i) => item({ status: status as SubstituteReceiptListItem['status'], evidenceId: String(i), payeeName: '  ', fundingSource: 'PERSONAL_ADVANCE' }));
  const view = setup('', data(rows)); const html = view.render();
  for (const text of ['รอเซ็น', 'รออนุมัติ', 'ออกแล้ว', 'ยกเลิกแล้ว', 'พนักงานสำรองจ่าย']) assert.ok(html.includes(text));
  assert.equal(view.nodes.filter(n => n.tag === 'li' && n.props.role === 'link').length, 4);
  assert.doesNotMatch(html, /ดูเอกสาร|฿/); view.cleanup();
});

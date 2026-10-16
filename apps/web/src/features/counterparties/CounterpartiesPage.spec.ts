import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
import { counterpartyFormValues } from './counterparties.logic';
import { COUNTERPARTY_PAGE_SIZE } from './counterparties.model';
const loaders = ['.svg', '.css'].map(ext => [ext, require.extensions[ext]] as const);
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
const unsaved = mutable('@/common/components/unsaved-navigation/use-unsaved-navigation');
const unsavedMock = mock.method(unsaved, 'useUnsavedNavigation', () => ({ dialog: null }));
after(() => unsavedMock.mock.restore());
const api = mutable('../counterparties/counterparties.api');
const { CounterpartiesPage, CounterpartyRow } = require('./CounterpartiesPage');
const { CounterpartyDetailPage, counterpartyAddressHint } = require('./CounterpartyDetailPage');
for (const [ext, loader] of loaders) { if (loader) require.extensions[ext] = loader; else delete require.extensions[ext]; }
const permissions = ['accounting.counterparty.read', 'accounting.counterparty.manage'];
const row = (overrides: any = {}) => ({ id: 'cp1', companyId: 'co', displayName: 'ร้านหนึ่ง', legalName: 'ชื่อจดทะเบียน', usageCounts: { bought: 7, sold: 3 }, billingAddressJson: { addressText: '1 ถนนสุขุมวิท' }, updatedAt: '2026-10-16', ...overrides });
function setup(component: any, props: any, initial: unknown[] = []) {
  const routes: string[] = [];
  const page = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: (url: string) => routes.push(url), prefetch() {} } as any }, h(ToastContext.Provider, { value: { success() {}, warning() {}, error() {} } }, h(component, props))), initial);
  return { ...page, routes };
}
function list(rows = [row()], filter = 'all', page = 1) {
  return setup(CounterpartiesPage, { companyId: 'co', permissions }, [filter, '', '', page, rows, 21, { all: 21, bought: 12, sold: 4, addressMissing: 3 }, null, 0, false]);
}
const text = (value: any): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : '';

test('COUNTERPARTY-1 list uses counted tabs, a who + address list (owner 2026-10-16: no count or status column), ten per page and no description or total footer', () => {
  const view = list(); const html = view.render();
  assert.equal(COUNTERPARTY_PAGE_SIZE, 10);
  assert.match(html, /mangmee-page mangmee-flat/);
  assert.doesNotMatch(html, /mangmee-page-description|ทั้งหมด 21 ราย|—|฿/);
  assert.doesNotMatch(html, /<th>ใบ<\/th>|<th>เลขผู้เสียภาษี<\/th>|>สถานะ<\/th>/);
  for (const label of ['คู่ค้า', 'ที่อยู่']) assert.ok(html.includes(`<th>${label}</th>`), label);
  assert.deepEqual(view.find('FilterTabs').tabs.map((tab: any) => [tab.label, tab.count]), [['ทั้งหมด', 21], ['เคยซื้อ', 12], ['เคยขาย', 4], ['ยังไม่มีที่อยู่', 3]]);
  assert.equal(view.find('Pagination').totalPages, 3);
  assert.equal(view.find('Pagination').prominent, true);
  assert.equal([...html.matchAll(/width:(\d+)%/g)].reduce((sum, match) => sum + Number(match[1]), 0), 100);
  const css = readFileSync(new URL('./CounterpartiesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /min-width: 40rem/); assert.match(css, /\.address \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
});

test('COUNTERPARTY-1 rows and phone cards open once by click or Enter, say the kind, and say a missing address in its own place', () => {
  for (const phone of [false, true]) {
    const view = setup(CounterpartyRow, { companyId: 'co', row: row({ taxId: '0105566070001', entityKind: 'JURISTIC' }), phone }); const html = view.render();
    assert.match(html, /ชื่อจดทะเบียน · 0105566070001/); assert.match(html, /avatarCompany/);
    assert.match(html, /title="1 ถนนสุขุมวิท"/);
    assert.doesNotMatch(html, /mangmee-badge|ซื้อ 7 ใบ|ขาย 3 ใบ|ยังไม่มีที่อยู่|—|฿/);
    const press = view.find(phone ? 'article' : 'tr'); press.onClick();
    const target = {}; press.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() {} });
    press.onKeyDown({ key: 'Enter', target: {}, currentTarget: {}, preventDefault() {} });
    assert.deepEqual(view.routes, ['/companies/co/counterparties/cp1', '/companies/co/counterparties/cp1']);
  }
  // No tax id: the grey line says the kind instead; unknown kind and no legal name: no grey line at all.
  assert.match(setup(CounterpartyRow, { companyId: 'co', row: row({ legalName: 'ร้านหนึ่ง', entityKind: 'INDIVIDUAL' }) }).render(), /class="number">บุคคลธรรมดา</);
  const html = setup(CounterpartyRow, { companyId: 'co', row: row({ legalName: 'ร้านหนึ่ง', usageCounts: { bought: 0, sold: 0 }, billingAddressJson: null }) }).render();
  assert.match(html, /class="missing">ยังไม่มีที่อยู่</); assert.doesNotMatch(html, /ซื้อ 0|ขาย 0|class="number"|mangmee-badge/);
});

test('COUNTERPARTY-1 tabs and debounced search reset the page and preserve the selected filter', async () => {
  const view = list([row()], 'all', 3); view.render();
  view.find('FilterTabs').onChange('bought'); assert.equal(view.state[3], 1); assert.equal(view.state[0], 'bought');
  const calls: any[] = [];
  const listMock = mock.method(api, 'listCounterparties', async (...args: any[]) => { calls.push(args); return { data: [], total: 0, counts: { all: 0, bought: 0, sold: 0, addressMissing: 0 } }; });
  try {
    view.render(true); await view.settle();
    assert.deepEqual(calls[0], ['co', { page: 1, search: '', filter: 'bought' }]);
    const searched = list([row()], 'sold', 3); searched.render();
    searched.find('input', p => p.type === 'search').onChange({ target: { value: ' ร้านใหม่ ' } });
    searched.render(true); await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(searched.state[2], 'ร้านใหม่'); assert.equal(searched.state[3], 1);
    searched.cleanup();
  } finally { view.cleanup(); listMock.mock.restore(); }
});

function detail(canEdit = true, busy = false) {
  const value = row({ canEdit, recentExpenses: [{ id: 'e1', expenseNumber: 'EXP-202610-1', vendorDocumentNumber: 'INV-7', expenseDate: '2026-10-16', grandTotalAmount: '1000.00' }], billingAddressJson: { addressText: '1 ถนนสุขุมวิท', provenance: { source: 'EXPENSE_AUTO', expenseId: 'e1', at: '2026-10-17' } } });
  return setup(CounterpartyDetailPage, { companyId: 'co', counterpartyId: 'cp1', permissions }, [value, counterpartyFormValues(value), null, null, false, null, busy, false, 0]);
}

test('COUNTERPARTY-1 detail puts usage below title, save in FormActionBar and preserves canEdit and busy behavior', () => {
  const view = detail(); const html = view.render();
  assert.match(html, /mangmee-page mangmee-flat/);
  assert.match(html, /<h1[^>]*>ร้านหนึ่ง<\/h1><p[^>]*>[\s\S]*ซื้อ 7 ใบ/);
  assert.doesNotMatch(html, /mangmee-page-actions/);
  assert.match(html, /data-form-action-bar=""[\s\S]*>บันทึก<\/button>/);
  assert.equal(view.find('button', p => text(p.children) === 'บันทึก').disabled, false);
  assert.doesNotMatch(detail(false).render(), /data-form-action-bar|>บันทึก<\/button>/);
  const working = detail(true, true); working.render(); assert.equal(working.find('button', p => p['aria-busy'] === true).disabled, true);
});

test('COUNTERPARTY-1 detail shows one address hint and identifiable recent expense with baht unit and safe return', () => {
  const view = detail(); const html = view.render();
  assert.equal((html.match(/พิมพ์ตามที่ใบระบุ/g) ?? []).length, 1);
  assert.match(html, /พิมพ์ตามที่ใบระบุ · มาจากใบวันที่ 16 ต.ค. 2569/);
  assert.match(html, /ที่อยู่จากใบใหม่จะไม่มาทับ/);
  assert.doesNotMatch(html, /ที่อยู่นี้จะพิมพ์ลงเอกสาร|กดบันทึกจึงจะมีผล|฿|—/);
  assert.match(html, /EXP-202610-1/); assert.match(html, /INV-7/); assert.match(html, /1,000.00 บาท/);
  assert.match(html, /href="\/companies\/co\/expenses\/e1\?back=%2Fcompanies%2Fco%2Fcounterparties%2Fcp1"/);
  assert.equal(counterpartyAddressHint({ addressText: 'บ้าน', provenance: null }, row()), 'พิมพ์ตามที่ใบระบุ');
  assert.equal(counterpartyAddressHint({ addressText: 'บ้าน', provenance: { expenseId: 'older', at: '2026-10-17' } }, row()), 'พิมพ์ตามที่ใบระบุ · มาจากใบที่บันทึกวันที่ 17 ต.ค. 2569');
});

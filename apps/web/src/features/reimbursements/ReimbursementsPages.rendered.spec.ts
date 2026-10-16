import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
require.extensions['.svg'] = module => { module.exports = () => null; };
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
Object.assign(globalThis, { self: globalThis });
const select = mutable('@/common/components/field/ThemedSelect');
select.ThemedSelect = function ThemedSelect(props: any) { return h('select', props, props.children); };
const api = mutable('@/features/reimbursements/reimbursements.api');
const { ReimbursementsHubPage, ClaimQueueRows, ClaimQueueMetrics } = require('./ReimbursementsPages');
const noop = () => undefined;
const rows = Array.from({ length: 20 }, (_, index) => ({ id: String(index), reason: `ค่าเดินทาง ${index}`, requestNo: index ? `RB-${index}` : undefined,
  status: index < 10 ? 'DRAFT' : 'PENDING_APPROVAL', requesterDisplayNameSnapshot: 'สมใจ', amount: '100.50', incurredDate: '2026-10-16', receiptRequirementStatus: 'ATTACHED' }));
const hub = { counts: { all: 20, draft: 10, review: 10, payment: 0, duplicate_blocked: 0, correction: 0, paid: 0, closed: 0 },
  totalAmount: '2010.00', blockedDraftCount: 0, metrics: { pendingApproval: { count: 10, amount: '1005.00' }, pendingPayment: { count: 0, amount: '0.00' } } };

function hubView(permissions = ['reimbursement.read', 'reimbursement.create', 'reimbursement.approve', 'reimbursement.payment.record', 'reimbursement.policy.manage']) {
  let query = new URLSearchParams('tab=mine');
  const visits: string[] = [];
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: (href: string) => visits.push(href), replace: (href: string) => { query = new URLSearchParams(href.split('?')[1]); }, prefetch: noop } as never },
    h(SearchParamsContext.Provider, { value: query }, h(ToastContext.Provider, { value: { success: noop, error: noop } as never },
      h(ReimbursementsHubPage, { companyId: 'co', userId: 'me', permissions, roles: [] })))));
  return { ...view, visits };
}

test('CLAIM-LIST counts, metrics, nonempty status options, pagination, server sort and whole-row navigation', async () => {
  const calls: any[] = [];
  const bootstrap = mock.method(api, 'getReimbursementHub', async () => ({ financeReviewRequired: false, hasApprovalTasks: true,
    queueCounts: { approvals: 10, finance: 0 }, listCounts: { mine: 20, approvals: 10, finance: 0 } }));
  const load = mock.method(api, 'loadHubPage', (_company: string, params: any, handlers: any) => {
    calls.push(params);
    handlers.onPage({ items: params.order === 'oldest' ? [...rows].reverse() : rows, total: 20, page: 1, pageSize: 100, hub });
    return noop;
  });
  const view = hubView();
  try {
    view.render(true); await view.settle();
    const html = view.render();
    assert.match(html, /mangmee-flat/);
    assert.match(html, /ยอดรวม 2,010.00 บาท/);
    assert.match(html, /1,005.00 บาท/);
    assert.doesNotMatch(html, /฿|ยังไม่มีเลขที่|แสดง 1-10|reimbursement-current-desk/);
    const tabs = view.find('FilterTabs');
    assert.deepEqual(tabs.tabs.map((tab: any) => [tab.label, tab.count]), [['ใบเบิกทั้งหมด', 20], ['รออนุมัติ', 10], ['รอจ่าย', 0]]);
    const options = view.nodes.filter(node => node.tag === 'option').map(node => node.props.value);
    assert.deepEqual(options, ['all', 'draft', 'review']);
    assert.equal(view.nodes.filter(node => node.tag === 'tr' && node.props.role === 'link').length, 10);
    assert.equal(view.nodes.filter(node => node.tag === 'li' && node.props.role === 'link').length, 10);
    assert.match(html, /หน้า 1 จาก 2/);
    view.find('Pagination').onPageChange(2);
    assert.match(view.render(), /หน้า 2 จาก 2/);
    const sort = view.find('button', props => props['aria-label'] === 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่');
    sort.onClick(); view.render(true); await view.settle();
    assert.match(view.render(), /หน้า 1 จาก 2/);
    assert.equal(calls.at(-1).order, 'oldest');
    const row = view.find('tr', props => props.role === 'link');
    row.onKeyDown({ key: 'Enter', target: row, currentTarget: row, preventDefault: noop });
    assert.equal(view.visits.at(-1), row['data-href']);
    row.onKeyDown({ key: 'Enter', target: {}, currentTarget: row, preventDefault: noop });
    assert.equal(view.visits.length, 1, 'a child action does not also activate the row');
    const phone = view.find('li', props => props.role === 'link'); phone.onClick();
    assert.equal(view.visits.at(-1), phone['data-href']);
    view.find('Pagination').onPageChange(2); view.render();
    view.find('ThemedSelect', props => props['aria-label'] === 'สถานะ').onChange({ target: { value: 'draft' } });
    view.render(true); await view.settle(); assert.match(view.render(), /หน้า 1 จาก 2/);
    assert.equal(calls.at(-1).filter, 'draft');
    view.find('Pagination').onPageChange(2); view.render();
    view.find('SearchBox').onChange('รถ'); view.render(true);
    await new Promise(resolve => setTimeout(resolve, 310)); view.render(true); await view.settle();
    assert.match(view.render(), /หน้า 1 จาก 2/); assert.equal(calls.at(-1).search, 'รถ');
  } finally { view.cleanup(); bootstrap.mock.restore(); load.mock.restore(); }
});

test('CLAIM-LIST MoreActions keeps personal account and policy actions under their existing permissions', () => {
  for (const [permissions, personal, policy] of [
    [['reimbursement.read', 'reimbursement.create', 'reimbursement.policy.manage'], true, true],
    [['reimbursement.read', 'reimbursement.create'], true, false], [['reimbursement.read', 'reimbursement.policy.manage'], false, true],
    [['reimbursement.read'], false, false],
  ] as const) {
    const view = hubView([...permissions]);
    const html = view.render();
    assert.equal(html.includes('บัญชีรับเงินคืนของฉัน'), personal);
    assert.equal(html.includes('ตั้งค่านโยบาย'), policy);
    assert.equal(view.nodes.some(node => node.tag === 'MoreActions'), personal || policy);
    if (personal || policy) assert.match(html, /<details[\s\S]*<summary[^>]*>เพิ่มเติม<\/summary>[\s\S]*<\/details>/);
    const tabs = view.find('FilterTabs'); assert.ok(tabs.tabs.every((tab: any) => tab.key !== 'policy'));
  }
});

test('CLAIM-LIST five balanced columns and one badge share the same row actions across wide and phone views', () => {
  const layouts: string[] = [];
  const view = certificateHarness(() => h(ClaimQueueRows, { rows: [{ ...rows[0], receiptRequirementStatus: 'REQUIRED' }], queue: 'mine',
    detailHref: () => '/claim', onOpenDetail: noop, order: 'newest', onOrder: noop,
    action: (_row: any, layout: string) => { layouts.push(layout); return h('button', { type: 'button' }, 'อนุมัติ'); } }));
  const html = view.render();
  assert.equal(view.nodes.filter(node => node.tag === 'th').length, 5);
  assert.equal(view.nodes.filter(node => node.tag === 'col').reduce((sum, node) => sum + parseInt(node.props.style.width), 0), 100);
  assert.equal(html.match(/>ยังไม่มีใบเสร็จ<\/span>/g)?.length, 2);
  assert.deepEqual(layouts, ['table', 'cards']);
  assert.match(html, /px-2 py-3/); assert.match(html, /hover:bg-gray-50/); assert.match(html, /sm:hidden/);
  assert.doesNotMatch(html, /ยังไม่มีเลขที่|฿|>—</);
});

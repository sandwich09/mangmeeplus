import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ExpensesWorkspacePanels.tsx', import.meta.url), 'utf8');

test('evidence export and totals use all filtered rows, not just the current page or unfiltered dataset', () => {
  assert.match(source, /expenseIds: visibleRows\.map\(\(row\) => row\.expenseId\)/);
  assert.match(source, /const total = visibleRows\.reduce\(/);
  assert.doesNotMatch(source, /รายการที่ส่งออก:/);
});

test('changing any export filter clears old package results and ignores late export responses', () => {
  assert.match(source, /exportScopeVersion\.current \+= 1/);
  assert.match(source, /scopeVersion !== exportScopeVersion\.current/);
  assert.match(source, /\[branchId, dateField, yearMonth, documentStatus, taxEvidenceStatus, sourceDocumentType, postingStatus, flagFilter, exportFormat\]/);
  assert.match(source, /สร้างเมื่อ \{formatThaiDateTime\(packageResult\.generatedAt\)\}/);
});

test('Thai category names are never squeezed or cut on a phone (Owner, 2026-09-30)', () => {
  // 2026-10-13: stacked rows replaced the sideways-scrolling table under 640 px, because the row's buttons
  // (rename, the switch) sat off the screen there. What the owner asked for stays: the name is never squeezed
  // into a narrow column and never cut. On a phone it has a line of its own at the full width of the row.
  const phone = /<ul className="divide-y divide-gray-100 sm:hidden" data-category-rows>([\s\S]*?)<\/ul>/u.exec(source)?.[1] ?? '';
  assert.match(phone, /<div className="min-w-0 flex-1 font-semibold text-gray-900">\{c\.name\}\{accountText\(c\)\}<\/div>/u);
  assert.doesNotMatch(phone, /truncate|line-clamp|whitespace-nowrap|break-all/u);
  // From 640 px the table stays in the shared scroller, like the other migrated tables.
  assert.match(source, /<div className="mangmee-table-scroll hidden sm:block">\s*<table className="mangmee-table">\s*<thead><tr>\{\['ชื่อหมวดหมู่'/u);
  // One way to stop using a category (its switch): no bin, and no hand-made overlay.
  assert.doesNotMatch(source, /เก็บถาวร|fixed inset-0/u);
});

test('evidence starts in document month and explains missing-date fallback without exposing machine files', () => {
  assert.match(source, /readEvidenceListState\(searchParams \?\? new URLSearchParams\(\), todayCivilDate\(\)\.slice\(0, 7\)\)/);
  assert.match(source, /setDateField\('expenseDate'\); \}\}>วันที่เอกสาร</);
  assert.match(source, /rows\.some\(row => row\.dateStatus === 'unverified' \|\| row\.dateStatus === 'implausible'\)/);
  assert.match(source, /รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า/);
  assert.doesNotMatch(source, /ดาวน์โหลดรายการลิงก์หลักฐาน|ลิงก์ไฟล์หลักฐาน \(สำหรับผู้ดูแลระบบ\)|evidence_manifest\.json/);
  const list = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
  // The list's month and its export count by document date unless the person picks วันที่ส่งเข้า.
  assert.match(list, /useState<'expenseDate' \| 'uploadedAt'>\(searchParams\.get\('dateField'\) === 'uploadedAt' \? 'uploadedAt' : 'expenseDate'\)/);
  assert.match(list, /dateField: periodDateField, fromDate, toDate/);
  assert.match(list, /รายการที่ยืนยันแล้ว \{chipCounts\.confirmed\} รายการ ตาม\{periodDateField === 'uploadedAt' \? 'วันที่ส่งเข้า' : 'วันที่เอกสาร'\}/);
  assert.doesNotMatch(list, /รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า/);
  assert.match(list, /<DocumentDateBadge expense=\{e\}/);
});

test('the permission-gated export area makes the bundle primary, shows Excel beside the bundle and shares exact filters', () => {
  const exportArea = source.slice(source.indexOf('{/* The export:'), source.indexOf('<div className={cx(\'transition-opacity\''));
  assert.match(exportArea, /canExport &&/);
  assert.doesNotMatch(exportArea, /MoreActions/);
  assert.match(exportArea, /excelAction=/);
  assert.match(exportArea, /<AccountingExportFormatSelect/);
  assert.doesNotMatch(exportArea, /ไฟล์ Excel สรุปรายการ/);
  assert.match(exportArea, /EvidenceBundleDownload accountant showCounts companyId=\{companyId\} request=\{exportFilters\} enabled=\{!loading && !!view\}/);
  assert.match(source, /createAccountantPackage\(companyId, exportFilters\)/);
  assert.doesNotMatch(exportArea, /ไฟล์หลักฐาน \{packageResult|ข้ามไฟล์แนบ/);
});

test('changing the month basis preserves the month; only evidence explains the fallback', () => {
  assert.match(source, /setDateField\('uploadedAt'\); \}/);
  assert.match(source, /setDateField\('expenseDate'\); \}/);
  assert.doesNotMatch(source, /setDateField\('[^']+'\); setYearMonth/);
  const list = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(list, /รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า/);
  assert.match(source, /รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า/);
  assert.match(source, /r.sourceDocumentTypeLabel \?\? expenseValueLabel/);
});


test('both evidence spreadsheet downloads have Thai names and keep the selected period', () => {
  assert.match(source, /downloadIndexXlsx\(result, result.indexFileName\)/);
  const list = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
  assert.match(list, /downloadIndexXlsx\(result, result.indexFileName\)/);
  assert.doesNotMatch(source + list, /expense-index-/);
});

import { mock, after } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const loaders = ['.svg', '.css'].map(ext => [ext, require.extensions[ext]] as const);
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
const outside = mutable('@/common/hooks/use-close-on-outside-click');
const outsideMock = mock.method(outside, 'useCloseOnOutsideClick', () => {});
after(() => outsideMock.mock.restore());
const policy = mutable('./expense-capture-policy');
const policyMock = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
const api = mutable('./expenses.api');
const { EvidencePanel } = require('./ExpensesWorkspacePanels');
for (const [ext, loader] of loaders) { if (loader) require.extensions[ext] = loader; else delete require.extensions[ext]; }
after(() => policyMock.mock.restore());
const clean = (id: number) => ({ expenseId: `e${id}`, expenseNumber: `EXP-${id}`, expenseDate: `2026-10-${String(id).padStart(2, '0')}`, uploadedAt: '2026-10-16', grandTotalAmount: '100.00', vendorNameSnapshot: `ร้าน ${id}`, sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'USABLE_FOR_TAX', categoryName: 'สำนักงาน', attachments: [{ id: 'file' }] });
function panel(query = 'yearMonth=2026-10', rows = [clean(1)], canExport = true, freeExpenseDrafts = false) {
  const params = new URLSearchParams(query), pushed: string[] = [], replaced: string[] = [];
  const data = { dateField: 'expenseDate', folders: [{ yearMonth: '2026-10', expenseCount: rows.length }], rows, total: rows.length, page: 1, pageSize: 200 };
  const page = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: (url: string) => pushed.push(url), replace: (url: string) => replaced.push(url), prefetch() {} } as any },
    h(SearchParamsContext.Provider, { value: params }, h(ToastContext.Provider, { value: { success() {}, warning() {}, error() {} } },
      h(EvidencePanel, { companyId: 'co', canExport, freeExpenseDrafts, canReadLedger: false, canPostLedger: false })))), [data, false, null]);
  return { ...page, pushed, replaced, params };
}

test('EVIDENCE-1 renders three metrics, three counted tabs, five columns and only ten rows per view', () => {
  const rows = Array.from({ length: 23 }, (_, i) => clean(i + 1));
  (rows[0] as any).categoryName = null;
  const view = panel('yearMonth=2026-10', rows);
  const html = view.render();
  const grid = view.find('MetricGrid');
  assert.deepEqual(grid.items.map((item: any) => [item.label, item.value]), [['เอกสาร', '23'], ['ครบแล้ว', '22'], ['ต้องแก้', '1']]);
  assert.equal(grid.items[0].note, 'ยอดรวม 2,300.00 บาท');
  assert.deepEqual(view.find('FilterTabs').tabs.map((tab: any) => [tab.label, tab.count]), [['ทั้งหมด', 23], ['ต้องแก้', 1], ['ครบแล้ว', 22]]);
  assert.equal(view.nodes.filter(node => node.tag === 'tr' && node.props.role === 'link').length, 10);
  assert.equal(view.nodes.filter(node => node.tag === 'article').length, 10);
  assert.equal(view.find('Pagination').prominent, true);
  assert.match(html, /หน้า 1 จาก 3/);
  assert.doesNotMatch(html, /แสดง \d+-|฿|—|สิ่งที่ต้องแก้<\/th>|>ลงบัญชี<\/th>/);
  const cols = view.nodes.filter(node => node.tag === 'col');
  assert.equal(cols.reduce((sum, col) => sum + parseInt(col.props.style.width), 0), 100);
  view.cleanup();
});

test('EVIDENCE-1 tabs include every failing check, exports use the entire selected set and remain available', () => {
  const rows = [clean(1), { ...clean(2), categoryName: null }, { ...clean(3), attachments: [] }] as any;
  const view = panel('yearMonth=2026-10&flagFilter=attention', rows);
  const html = view.render();
  assert.match(html, /มี 2 รายการต้องแก้ ดาวน์โหลดได้ แต่ควรแก้ก่อนส่ง/);
  const bundle = view.find('EvidenceBundleDownload');
  assert.equal(bundle.accountant, true); assert.equal(bundle.enabled, true);
  assert.deepEqual(bundle.request.expenseIds, ['e3', 'e2']);
  assert.equal(view.find('EvidenceBundleDownload').excelAction.props.children, 'ดาวน์โหลด Excel');
  assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'รูปแบบไฟล์').value, 'accountant');
  const noExport = panel('yearMonth=2026-10', rows, false); noExport.render();
  assert.equal(noExport.nodes.some(node => node.tag === 'EvidenceBundleDownload'), false);
  view.cleanup(); noExport.cleanup();
});

test('EVIDENCE-1 row click and Enter land on checks only when incomplete and keep evidence filters', () => {
  for (const missing of [false, true]) {
    const view = panel('yearMonth=&order=oldest&page=1', [{ ...clean(1), categoryName: missing ? null : 'สำนักงาน' }] as any);
    view.render();
    for (const tag of ['tr', 'article']) {
      const row = view.find(tag, props => props.role === 'link');
      assert.equal(row.tabIndex, 0); row.onClick();
      const target = {}; let prevented = false;
      row.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    }
    assert.equal(view.pushed.length, 4);
    for (const href of view.pushed) {
      const url = new URL(href, 'http://localhost');
      assert.equal(url.searchParams.get('section'), missing ? 'checks' : null);
      const back = new URL(url.searchParams.get('back')!, 'http://localhost');
      assert.equal(back.pathname, '/companies/co/expenses/evidence');
      assert.equal(back.searchParams.get('yearMonth'), ''); assert.equal(back.searchParams.get('order'), 'oldest');
    }
    view.cleanup();
  }
});

test('EVIDENCE-1 changing sort or a filter resets the page; paging preserves all other filters', () => {
  const rows = Array.from({ length: 23 }, (_, i) => clean(i + 1));
  const view = panel('yearMonth=2026-10&order=newest&page=3', rows); view.render();
  view.find('button', props => props['aria-label'] === 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่').onClick();
  let params = new URLSearchParams(view.replaced.at(-1)!.split('?')[1]);
  assert.equal(params.get('order'), 'oldest'); assert.equal(params.get('page'), '1');
  view.find('FilterTabs').onChange('attention');
  params = new URLSearchParams(view.replaced.at(-1)!.split('?')[1]);
  assert.equal(params.get('flagFilter'), 'attention'); assert.equal(params.get('page'), '1');
  view.find('Pagination').onPageChange(2);
  params = new URLSearchParams(view.replaced.at(-1)!.split('?')[1]);
  assert.equal(params.get('page'), '2'); assert.equal(params.get('yearMonth'), '2026-10');
  view.cleanup();
});


test('EVIDENCE-1 empty months retain the phone list and no export becomes an equal primary', () => {
  const view = panel('yearMonth=2026-10', []); const html = view.render();
  assert.match(html, /data-testid="evidence-card-list"/);
  assert.match(html, /ไม่มีรายการที่ตรงกับตัวกรอง/);
  assert.equal(view.nodes.some(node => node.tag === 'Pagination'), false);
  assert.equal(view.find('EvidenceBundleDownload').excelAction.props.disabled, false);
  assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'รูปแบบไฟล์').value, 'accountant');
  assert.equal(view.nodes.filter(node => node.tag === 'button' && node.props.className?.includes('primary')).length, 0);
  view.cleanup();
});

test('EVIDENCE-1 loads every server page before computing tabs, sorting ten rows or planning export', async () => {
  const calls: any[] = [];
  const rows = Array.from({ length: 201 }, (_, i) => ({ ...clean(i + 1), expenseDate: '2026-10-01' }));
  (rows[200] as any).categoryName = null;
  const read = mock.method(api, 'getSharedEvidence', async (_company: string, filter: any) => {
    calls.push(filter);
    return { dateField: 'expenseDate', folders: [], rows: filter.page === 1 ? rows.slice(0, 200) : rows.slice(200), total: 201, page: filter.page, pageSize: 200 };
  });
  const plan = mock.method(api, 'planAccountantEvidenceBundle', async () => ({ fileCount: 201, partCount: 4 }));
  const view = panel('yearMonth=2026-10');
  try {
    view.render(true); await view.settle();
    view.render();
    assert.equal(calls.length, 2); assert.deepEqual(calls.map(call => call.page), [1, 2]);
    assert.ok(calls.every(call => call.yearMonth === '2026-10' && call.status === 'CONFIRMED' && call.dateField === 'expenseDate'));
    assert.deepEqual(view.find('FilterTabs').tabs.map((tab: any) => tab.count), [201, 1, 200]);
    // ทั้งหมด exports the whole server filter (all 201 rows plus payment-only facts), not a selection.
    assert.equal(view.find('EvidenceBundleDownload').request.expenseIds, undefined);
    assert.equal(view.find('EvidenceBundleDownload').request.yearMonth, '2026-10');
    assert.equal(view.nodes.filter(node => node.tag === 'article').length, 10);
  } finally { view.cleanup(); read.mock.restore(); plan.mock.restore(); }
});

test('evidence load failures retain every filter and retry the same scope before showing results', async () => {
  const calls: any[] = [];
  let finish!: (value: any) => void;
  const read = mock.method(api, 'getSharedEvidence', async (_company: string, filter: any) => {
    calls.push(filter);
    if (calls.length === 1) throw new Error('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    return new Promise(resolve => { finish = resolve; });
  });
  const view = panel('yearMonth=2026-09&dateField=uploadedAt&sourceDocumentType=RECEIPT&taxEvidenceStatus=USABLE_FOR_TAX&flagFilter=attention&order=oldest', [], false);
  try {
    view.render(true); await view.settle();
    const failed = view.render();
    assert.match(failed, /ลองอีกครั้ง/);
    assert.doesNotMatch(failed, /ไม่มีรายการที่ตรงกับตัวกรอง|ยอดรวม 0.00|mangmee-tab-count/);
    assert.equal(view.nodes.some(node => node.tag === 'MetricGrid'), false);
    assert.equal(view.find('ThemedSelect', props => props['aria-label'] === 'เดือน').value, '2026-09');
    assert.ok(view.nodes.some(node => node.tag === 'ThemedSelect' && node.props.value === 'RECEIPT'));
    assert.ok(view.nodes.some(node => node.tag === 'button' && node.props.children.includes('วันที่ส่งเข้า')));
    assert.equal(view.find('FilterTabs').value, 'attention');
    assert.ok(view.find('FilterTabs').tabs.every((tab: any) => tab.count === undefined));
    view.find('ErrorState').onRetry();
    assert.match(view.render(), /กำลังโหลด/);
    assert.deepEqual(calls[1], calls[0]);
    finish({ dateField: 'uploadedAt', folders: [], rows: [clean(1)], total: 1, page: 1, pageSize: 200 });
    await view.settle();
    assert.doesNotMatch(view.render(), /โหลดไม่สำเร็จ|เชื่อมต่อไม่ได้/);
    assert.equal(view.find('ThemedSelect', props => props['aria-label'] === 'เดือน').value, '2026-09');
    view.find('FilterTabs').onChange('ok');
    const next = new URLSearchParams(view.replaced.at(-1)!.split('?')[1]);
    assert.equal(next.get('yearMonth'), '2026-09'); assert.equal(next.get('dateField'), 'uploadedAt');
    assert.equal(next.get('sourceDocumentType'), 'RECEIPT'); assert.equal(next.get('flagFilter'), 'ok');
  } finally { view.cleanup(); read.mock.restore(); }
});


test('payment-only and filed-only exports download with truthful feedback', async () => {
  const downloads: unknown[][] = [];
  const download = mock.method(api, 'downloadIndexXlsx', (...args: unknown[]) => downloads.push(args));
  let result = { rowCount: 0, paymentRowCount: 1, withholdingRowCount: 0, indexFileName: 'รายจ่าย-ร้าน.xlsx' };
  const request = mock.method(api, 'createAccountantPackage', async () => result);
  try {
    for (const counts of [[1, 0], [0, 1], [0, 0]]) {
      result = { ...result, paymentRowCount: counts[0]!, withholdingRowCount: counts[1]! };
      const view = panel('yearMonth=2026-10', []);
      view.render();
      const button = view.find('EvidenceBundleDownload').excelAction.props;
      assert.equal(button.disabled, false); assert.equal(button['aria-busy'], false);
      await button.onClick(); await view.settle();
      const html = view.render();
      if (counts.some(Boolean)) { assert.match(html, /ดาวน์โหลด Excel แล้ว/); assert.doesNotMatch(html, /ดาวน์โหลด Excel แล้ว 0 รายการ/); }
      else { assert.match(html, /ไม่มีรายการตามที่เลือก/); assert.match(html, /เปลี่ยนช่วงวันที่/); }
      view.cleanup();
    }
    assert.equal(downloads.length, 2);
    assert.ok(downloads.every(args => args[1] === result.indexFileName));
  } finally { request.mock.restore(); download.mock.restore(); }
});

test('software export keeps exclusions visible with a fallback, preserves filters and hides formats for stale free capabilities', async () => {
  const response = { preset: 'purchase_journal', files: [], documentCount: 1, rowCount: 0,
    excluded: [{ expenseNumber: 'EXP-1', reason: 'foreign_currency', detail: 'ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท' }], paymentNotExported: [], unmappedCategories: [] };
  const requests: any[] = [];
  const write = mock.method(api, 'createAccountingSoftwareExport', async (_company: string, request: any) => { requests.push(request); return response; });
  const download = mock.method(api, 'downloadAccountingSoftwareExport', () => {});
  const fallback = mock.method(api, 'createAccountantPackage', async () => ({ rowCount: 0 }));
  const view = panel('yearMonth=2026-10&flagFilter=ok');
  try {
    view.render(); view.find('ThemedSelect', p => p['aria-label'] === 'รูปแบบไฟล์').onChange({ target: { value: 'purchase_journal' } }); view.render();
    view.find('button', p => p.children.includes('ดาวน์โหลด Excel')).onClick(); await view.settle();
    assert.match(view.render(), /มี 1 รายการที่ใส่ในไฟล์นี้ไม่ได้/);
    assert.equal(requests[0].preset, 'purchase_journal'); assert.equal(requests[0].yearMonth, '2026-10'); assert.deepEqual(requests[0].expenseIds, ['e1']);
    view.find('button', p => p.children.includes('ดูรายการ')).onClick(); assert.match(view.render(), /EXP-1.*ยอดเป็นสกุลเงินอื่น/);
    view.find('button', p => p.children.includes('ดาวน์โหลด Excel สำหรับสำนักงานบัญชี')).onClick(); await view.settle(); assert.equal(fallback.mock.callCount(), 1);
    const free = panel('yearMonth=2026-10', [clean(1)], true, true); assert.doesNotMatch(free.render(), /รูปแบบไฟล์|ไฟล์แยกตามหมวด/); free.cleanup();
  } finally { view.cleanup(); write.mock.restore(); download.mock.restore(); fallback.mock.restore(); }
});

test('empty Excel exports offer changing dates without claiming a download or hiding the filters', async () => {
  const write = mock.method(api, 'createAccountantPackage', async () => ({ rowCount: 0 }));
  const view = panel('yearMonth=2026-10', []);
  try {
    view.render(); view.find('button', p => p.children.includes('ดาวน์โหลด Excel')).onClick(); await view.settle();
    const html = view.render(); assert.match(html, /ไม่มีรายการตามที่เลือก/); assert.match(html, /เปลี่ยนช่วงวันที่/);
    assert.equal((html.match(/ไม่มีรายการตามที่เลือก/g) ?? []).length, 1);
    assert.doesNotMatch(html, /ดาวน์โหลดไฟล์แล้ว 0|ดาวน์โหลด Excel แล้ว 0/);
    assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'เดือน').value, '2026-10');
  } finally { view.cleanup(); write.mock.restore(); }
});

test('purchase journal empty feedback is the sole empty notice on the evidence card', async () => {
  const write = mock.method(api, 'createAccountingSoftwareExport', async () => ({ preset: 'purchase_journal', files: [], documentCount: 0, rowCount: 0, excluded: [], paymentNotExported: [], unmappedCategories: [] }));
  const download = mock.method(api, 'downloadAccountingSoftwareExport', () => {});
  const view = panel('yearMonth=2026-10', []);
  try {
    view.render(); view.find('ThemedSelect', p => p['aria-label'] === 'รูปแบบไฟล์').onChange({ target: { value: 'purchase_journal' } }); view.render();
    await view.find('EvidenceBundleDownload').excelAction.props.onClick(); await view.settle();
    const html = view.render(); assert.equal((html.match(/ไม่มีรายการตามที่เลือก/g) ?? []).length, 1);
    assert.match(html, /เปลี่ยนช่วงวันที่/); assert.doesNotMatch(html, /ดาวน์โหลดไฟล์แล้ว 0/);
  } finally { view.cleanup(); write.mock.restore(); download.mock.restore(); }
});

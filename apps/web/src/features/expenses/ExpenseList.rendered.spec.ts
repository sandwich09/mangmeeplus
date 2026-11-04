import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { mutable } from './expense-certificate-test-harness';

require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const filters = mutable('../web-core-workspace/MenuFilterScope');
const capture = mutable('./expense-capture-policy');
const api = mutable('./expenses.api');
const { ExpenseListPage } = require('./ExpensesPages');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const runtime = require('react');
const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
const list = source.slice(source.indexOf('function ExpenseListPage('), source.indexOf('// ──', source.indexOf('function ExpenseListPage(')));
const names = [...list.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(match => match[1]!);
const h = React.createElement;
const noop = () => {};
test('DELETE-HISTORY list hides delete and offers opening the cancellation flow for a retained payment', () => {
  const html = render([row(1, { status: 'DRAFT', hasDeletionBlockingHistory: true })], {}, 'month=2026-09', noop, { canDelete: true, canReject: true });
  assert.doesNotMatch(html, /title="ลบ"|>ลบรายจ่ายนี้</);
  assert.match(html, /ยกเลิกรายการ/);
  const readOnly = render([row(1, { status: 'DRAFT', hasDeletionBlockingHistory: true })], {}, 'month=2026-09', noop, { canDelete: true, canReject: false, canVoid: false });
  assert.doesNotMatch(readOnly, />ยกเลิกรายการ</);
});
test('LINE-ACT a retained-evidence delete refusal offers opening the expense for cancellation instead of retrying delete', () => {
  let footer: React.ReactNode;
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag?.name === 'Modal' && props.open) footer = props.footer;
    return realCreate(tag, props, ...children);
  });
  try {
    render([row(1, { status: 'DRAFT' })], { confirmId: 'e1', deleteRetentionLocked: true });
    const html = renderToStaticMarkup(footer);
    assert.match(html, /เปิดรายจ่ายเพื่อยกเลิก/);
    assert.doesNotMatch(html, />ลบรายจ่าย</);
  } finally { create.mock.restore(); }
});
test('table and evidence exports use the same past date range rather than the month in state', async () => {
  let bundle: any, exportTable: (() => Promise<void>) | undefined, table: any;
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag?.name === 'EvidenceBundleDownload') bundle = props.request;
    if (tag?.name === 'Modal' && props.open) exportTable = props.footer?.props.onClick;
    return realCreate(tag, props, ...children);
  });
  const request = mock.method(api, 'createAccountantPackage', async (_company: string, body: any) => { table = body; return { rowCount: 0 }; });
  try {
    render([], { exportOpen: true }, 'view=confirmed&fromDate=2025-02-03&toDate=2025-03-04');
    assert.ok(exportTable); await exportTable();
    assert.equal(table.fromDate, '2025-02-03'); assert.equal(table.toDate, '2025-03-04');
    assert.deepEqual(bundle, { dateField: table.dateField, fromDate: table.fromDate, toDate: table.toDate });
  } finally { create.mock.restore(); request.mock.restore(); }
});
test('one accountant file downloads payment-only and filed-only results under the server name', async () => {
  let body: React.ReactNode;
  let press: (() => Promise<void>) | undefined;
  const downloaded: unknown[][] = [];
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag?.name === 'Modal' && props.open) { press = props.footer?.props.onClick; body = children; }
    return realCreate(tag, props, ...children);
  });
  const download = mock.method(api, 'downloadIndexXlsx', (...args: unknown[]) => downloaded.push(args));
  let result = { rowCount: 0, paymentRowCount: 1, withholdingRowCount: 0, indexFileName: 'รายจ่าย-ร้าน.xlsx', skippedEvidence: [] };
  const request = mock.method(api, 'createAccountantPackage', async (_company: string, body: any) => {
    assert.equal('columnSet' in body, false); return result;
  });
  try {
    for (const counts of [[1, 0], [0, 1], [0, 0]]) {
      result = { ...result, paymentRowCount: counts[0]!, withholdingRowCount: counts[1]! };
      render([], { exportOpen: true });
      assert.doesNotMatch(renderToStaticMarkup(body), /รายละเอียดในไฟล์|แบบเต็มสำหรับสำนักงานบัญชี|แบบย่อ/);
      assert.ok(press); await press();
    }
    assert.equal(downloaded.length, 2);
    assert.ok(downloaded.every(args => args[1] === result.indexFileName));
    render([], { exportOpen: true, exportNotice: 'ไม่มีรายการตามที่เลือก' });
    assert.match(renderToStaticMarkup(body), /เปลี่ยนช่วงวันที่/);
  } finally { create.mock.restore(); request.mock.restore(); download.mock.restore(); }
});

function row(index: number, overrides = {}) {
  return { id: `e${index}`, status: 'CONFIRMED', paymentStatus: 'UNPAID', expenseNumber: `EXP-${index}`, vendorNameSnapshot: `ร้าน ${index}`,
    expenseDate: '2026-09-30', uploadedAt: '2026-10-03T01:00:00Z', dueDate: '2020-01-01', dateStatus: 'verified',
    expenseCategoryId: 'cat', grandTotalAmount: '107', outstandingAmount: '107', vatAmount: '7', captureSource: 'WEB_UPLOAD',
    inputVatClaimStatus: 'NEEDS_REVIEW', inputVatRightVisible: true, ...overrides };
}
function render(rows: ReturnType<typeof row>[], stateOverrides = {}, query = '', navigate: (url: string) => void = noop, caps = {}, freeExpenseDrafts = false) {
  const state: Record<string, unknown> = { rows, catNames: { cat: 'หมวดทดสอบ' }, loading: false, categoryNamesLoading: false, ...stateOverrides };
  const realState = runtime.useState;
  let index = 0;
  const hooks = [
    mock.method(runtime, 'useState', (init: unknown) => {
      const pair = realState(init); const name = names[index++];
      return name && name in state ? [state[name], noop] : pair;
    }),
    mock.method(filters, 'useMenuFilterState', (key: string, initial: () => unknown) => [key === 'expenses.list.month' ? '2026-09' : initial(), noop]),
    mock.method(capture, 'useExpenseCapturePolicy', () => ({ mode: 'FULL', vatStatus: 'UNKNOWN', canAnswerVatStatus: true })),
  ];
  try {
    return renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: navigate, replace: noop, prefetch: noop } as any },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(query) },
        h(ToastContext.Provider, { value: { success: noop, error: noop, warning: noop } },
          h(ExpenseListPage, { companyId: 'co', caps: { canReview: true, canExportPackage: true, canUploadReceipts: true, ...caps }, userId: 'owner', onSelect: noop, freeExpenseDrafts })))));
  } finally { hooks.forEach(hook => hook.mock.restore()); }
}

test('free and stale sessions cannot open export and can return to drafts', () => {
  const label = 'ส่งออก Excel ให้สำนักงานบัญชี';
  for (const caps of [{ canExportPackage: true }, { canExportPackage: false }]) {
    const free = render([row(1, { status: 'DRAFT' })], { exportOpen: true }, '', noop, caps, true);
    assert.ok(!free.includes(label)); assert.ok(!free.includes('role="dialog"'));
  }
  assert.ok(!render([], {}, '', noop, { canExportPackage: false }).includes(label));
  let close: (() => void) | undefined, footer: React.ReactNode, body: React.ReactNode;
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag === 'button' && children.includes('กลับไปรายการค่าใช้จ่าย')) close = props.onClick;
    if (tag?.name === 'Modal' && props.open) { footer = props.footer; body = children; }
    return realCreate(tag, props, ...children);
  });
  try {
    render([row(1)], { exportOpen: true, exportError: 'สิทธิ์นี้ใช้สำหรับอ่านเอกสารและเก็บร่างรายจ่ายเท่านั้น' });
    assert.match(renderToStaticMarkup(footer), /กลับไปรายการค่าใช้จ่าย/); assert.ok(close); close();
    assert.match(renderToStaticMarkup(body), /สิทธิ์นี้ใช้สำหรับอ่านเอกสารและเก็บร่างรายจ่ายเท่านั้น/);
  } finally { create.mock.restore(); }
});

test('LIST-1 renders three metrics, 10 rows newest first, one work status and retained warnings in both layouts', () => {
  const html = render(Array.from({ length: 21 }, (_, index) => row(index)));
  assert.equal((html.match(/data-testid="expenses-row"/g) ?? []).length, 20, 'ten entries in each layout share the journey locator');
  assert.equal((html.match(/<button[^>]*data-testid="expenses-row"/g) ?? []).length, 10, 'phone entries remain actionable buttons');
  assert.equal((html.match(/>รอจ่าย</g) ?? []).length, 20);
  assert.equal((html.match(/>ภาษีซื้อรอตรวจสอบ</g) ?? []).length, 20);
  // Owner 2026-10-15: the seller cell shows the name and the expense number only.
  assert.ok(!html.includes('หมวดทดสอบ')); assert.ok(html.includes('EXP-0')); assert.ok(html.includes('30 ก.ย. 2569'));
  assert.ok(html.includes('21 รายการ รวมร่าง')); assert.ok(html.includes('เกินกำหนด 2,247.00 บาท · 21 ใบ'));
  assert.ok(html.includes('หน้า 1 จาก 3')); assert.ok(html.includes('VAT ตามเอกสาร')); assert.ok(html.includes('>ค้างจ่าย<')); assert.ok(html.includes('min-h-11 min-w-0 whitespace-nowrap px-3 sm:min-w-32'));
  for (const removed of ['ค้างจ่ายที่ยืนยันแล้ว', 'เกินกำหนดจ่าย', 'อัปโหลดเว็บ', 'บันทึกด้วยมือ', 'อัปโหลดใบเสร็จ', 'ร้านยังไม่ตอบเรื่อง VAT', 'วันที่เอกสาร:', 'เลขรายจ่าย', 'แสดง 1-20', '>รายวัน<', '>รายเดือน<', 'aria-label="สิทธิภาษีซื้อ"']) assert.ok(!html.includes(removed), removed);
  const exportLabel = 'ส่งออก Excel ให้สำนักงานบัญชี';
  assert.equal(html.split(exportLabel).length - 1, 1);
  // Owner 2026-10-15: the export sits next to the search, above the numbers.
  assert.ok(html.indexOf(exportLabel) < html.indexOf('data-testid="expenses-summary"'));
});

test('LIST-1 shows the usual outstanding note when none is overdue and says ยังไม่ระบุ for an unknown date with no second label', () => {
  const html = render([row(1, { dueDate: null, dateStatus: 'unverified', status: 'DRAFT', inputVatRightVisible: false })]);
  assert.ok(html.includes('เฉพาะที่ยืนยันแล้ว')); assert.ok(!html.includes('เกินกำหนด ฿'));
  assert.ok(html.includes('ยังไม่ระบุ')); assert.ok(!html.includes('ยังไม่ยืนยันวันที่'));
  assert.equal((html.match(/>รอตรวจ</g) ?? []).length, 2);
});


test('DETAIL-2b a restored list renders its page and each row carries the current allowed query', () => {
  const opened: string[] = [];
  const rows = Array.from({ length: 25 }, (_, index) => row(index));
  const realCreate = runtime.createElement;
  let openRow: (() => void) | undefined;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (props?.['data-testid'] === 'expenses-row' && !openRow) openRow = props.onClick;
    return realCreate(tag, props, ...children);
  });
  try {
    const html = render(rows, {}, 'month=2026-09&chip=confirmed&query=ร้าน&dateOrder=oldest&page=3&foreign=x', url => opened.push(url));
    assert.ok(html.includes('หน้า 3 จาก 3')); assert.ok(html.includes('EXP-20')); assert.ok(!html.includes('EXP-0<'));
    assert.ok(html.includes('วันที่ เก่าไปใหม่'));
    assert.ok(openRow); openRow();
    const detail = new URL(opened[0]!, 'https://local.test');
    assert.equal(detail.pathname, '/companies/co/expenses/e20');
    const back = new URL(detail.searchParams.get('back')!, 'https://local.test');
    assert.equal(back.pathname, '/companies/co/expenses');
    assert.deepEqual(Object.fromEntries(back.searchParams), { month: '2026-09', chip: 'confirmed', query: 'ร้าน', dateOrder: 'oldest', page: '3' });
  } finally { create.mock.restore(); }
});

test('failed expense reads show retry without zero metrics, empty states or stale rows', async () => {
  const message = 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  let retry: (() => void) | undefined;
  const calls: any[] = [];
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag?.name === 'ErrorState') retry = props.onRetry;
    return realCreate(tag, props, ...children);
  });
  const request = mock.method(api, 'listExpenses', async (company: string, filter: any) => { calls.push({ company, filter }); return { data: [], total: 0 }; });
  try {
    for (const rows of [[], [row(1)]]) {
      const html = render(rows, { error: message, categoryNamesLoading: true }, 'month=2026-09&query=ใบเดิม&chip=pending');
      assert.match(html, /โหลดไม่สำเร็จ/);
      assert.match(html, /ลองอีกครั้ง/);
      assert.ok(!html.includes('data-testid="expenses-summary"'));
      for (const hidden of ['ยังไม่มีรายจ่าย', 'ไม่พบ “', 'ไม่มีรายการในกลุ่มนี้', 'data-testid="expenses-row"', 'data-testid="expenses-card-list"', 'กำลังโหลด...']) assert.ok(!html.includes(hidden), hidden);
      assert.match(html, /value="ใบเดิม"/);
      assert.match(html, /ก.ย. 2569/);
    }
    assert.ok(retry); retry(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ company: 'co', filter: { fromDate: '2026-09-01', toDate: '2026-09-30', page: 1, pageSize: 200 } }]);
  } finally { create.mock.restore(); request.mock.restore(); }
});


test('export failure retains filters and offers retry or change dates', async () => {
  let footer: React.ReactNode, press: (() => Promise<void>) | undefined;
  const bodies: unknown[] = [];
  const realCreate = runtime.createElement;
  const create = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
    if (tag?.name === 'Modal' && props.open) { footer = props.footer; if (props.footer?.props.onClick) press = props.footer.props.onClick; }
    return realCreate(tag, props, ...children);
  });
  const request = mock.method(api, 'createAccountantPackage', async (_company: string, body: any) => { bodies.push(body); throw new Error('ดาวน์โหลดไม่ได้ ลองอีกครั้ง'); });
  try {
    const query = 'month=2026-09&query=ร้านเดิม&dateOrder=oldest';
    render([], { exportOpen: true }, query); assert.ok(press); await press();
    render([], { exportOpen: true, exportError: 'ดาวน์โหลดไม่ได้ ลองอีกครั้ง' }, query);
    assert.match(renderToStaticMarkup(footer), /กลับไปรายการค่าใช้จ่าย/);
    const retry = React.Children.toArray((footer as React.ReactElement<any>).props.children).find((child: any) => child.props.onClick && child.props['aria-busy'] !== undefined);
    await (retry as React.ReactElement<any>).props.onClick();
    assert.deepEqual(bodies[1], bodies[0]);
    render([], { exportOpen: true, exportNotice: 'ไม่มีรายการตามที่เลือก' }, query);
    assert.match(source, /เปลี่ยนช่วงวันที่/);
  } finally { create.mock.restore(); request.mock.restore(); }
});

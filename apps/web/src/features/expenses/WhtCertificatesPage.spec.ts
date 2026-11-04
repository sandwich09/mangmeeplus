import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext, PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { WHT_HANDOFF_MISSING_LABELS, type WhtCertificateHandoffPageDto } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
import type { WhtCertificateRow, WhtCertificateTab } from './expense-wht-certificates.model';
import { WHT_CERTIFICATE_TABS } from './expense-wht-certificates.model';
const loaders = ['.svg', '.css'].map(ext => [ext, require.extensions[ext]] as const);
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
// The shared select owns its outside-click DOM listeners; this SSR harness exercises the page's requests and handlers.
const outsideClick = mutable('@/common/hooks/use-close-on-outside-click');
const outsideClickMock = mock.method(outsideClick, 'useCloseOnOutsideClick', () => {});
after(() => outsideClickMock.mock.restore());
const api = mutable('./expenses.api');
const taxApi = mutable('../tax/tax.api');
const { WhtCertificateCard, WhtCertificatesPage } = require('./WhtCertificatesPage');
for (const [ext, loader] of loaders) { if (loader) require.extensions[ext] = loader; else delete require.extensions[ext]; }
const permissions = ['wht.certificate.issue', 'wht.certificate.correct'];
test('WHT-OUTSIDE shop availability, independent of the reader role, chooses the three outside tabs or four system tabs', () => {
  for (const systemCertificatesAvailable of [false, true]) {
    const view = setup({ permissions: ['wht.certificate.read'], result: { ...data(), counts: { ...data().counts, SYSTEM_ISSUED: 99 } } });
    Object.assign(view.props, { systemCertificatesAvailable });
    try {
      const html = view.render();
      const tabs = view.find('FilterTabs').tabs;
      assert.equal(tabs.some((tab: any) => tab.count === 99), systemCertificatesAvailable);
      assert.deepEqual(tabs.map((tab: any) => tab.label), systemCertificatesAvailable
        ? ['ยังไม่ออก', 'ออกแล้ว', 'ทำนอกระบบ', 'ยกเลิกแล้ว'] : ['ยังไม่ได้ทำใบ', 'ทำใบแล้ว', 'ยกเลิก']);
      if (!systemCertificatesAvailable) {
        assert.match(html, /ทำใบ 50 ทวิ จากแบบฟอร์มกรมสรรพากรหรือโปรแกรมอื่น แล้วจดเลขที่ไว้ที่นี่/);
        assert.match(html, /ไม่มีรายการที่ต้องทำใบ 50 ทวิ/);
        assert.doesNotMatch(html, /ออกแล้ว|ลายเซ็น|พิมพ์ใบแทน/);
      }
    } finally { view.cleanup(); }
  }
});

test('WHT-OUTSIDE server routes pass the shop availability read rather than the reader issue permission', () => {
  for (const route of ['expenses/wht-certificates/page.tsx', 'expenses/[expenseId]/page.tsx']) {
    const source = readFileSync(new URL(`../../../app/(workspace)/companies/[companyId]/${route}`, import.meta.url), 'utf8');
    assert.match(source, /systemCertificatesAvailable=\{shopHasSystemWhtCertificates\(session\?\.entitledFeatureKeys\)\}/);
  }
});
test('every API read permission opens the certificate list without issuing or recording rights', async () => {
  const request = mock.method(taxApi, 'listWithholdingCertificates', async () => data());
  try {
    for (const permission of ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link']) {
      const view = setup({ permissions: [permission] });
      try { assert.doesNotMatch(view.render(true), /ไม่มีสิทธิ์/); await view.settle(); }
      finally { view.cleanup(); }
    }
    assert.equal(request.mock.callCount(), 4);
  } finally { request.mock.restore(); }
});
const row = (over: Partial<WhtCertificateRow> = {}) => ({
  id: 'handoff-private', companyId: 'co', status: 'REQUIRED', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-private',
  payeeName: 'ร้านทดสอบชื่อยาวสำหรับโทรศัพท์', payeeTaxId: '1234567890123', expenseId: 'expense-private', expenseNumber: 'EX-01',
  documentDate: '2026-10-11', withheldAmount: '3', missing: [], systemIssuanceOpen: true, systemCorrectionOpen: true,
  systemReplacementOpen: true, certificateId: null, certificateNumber: null, certificateIssuedAt: null,
  prefill: { grossAmount: '100', withheldAmount: '3', payeeSnapshot: { name: 'ร้านทดสอบ', address: null } } as WhtCertificateRow['prefill'],
  externalCertificateNumber: null, externalIssuedDate: null, ...over,
} as WhtCertificateRow);
const data = (rows: WhtCertificateRow[] = []): WhtCertificateHandoffPageDto => ({ rows, total: rows.length, page: 1, pageSize: 10, sums: { withheld: '3.00' },
  counts: { REQUIRED: rows.filter(r => r.status === 'REQUIRED').length, SYSTEM_ISSUED: rows.filter(r => r.status === 'SYSTEM_ISSUED').length,
    EXTERNAL_LINKED: rows.filter(r => r.status === 'EXTERNAL_LINKED').length, CANCELLED: rows.filter(r => r.status === 'CANCELLED').length } });
function setup(opts: { tab?: WhtCertificateTab; search?: string; rows?: WhtCertificateRow[]; permissions?: string[]; loading?: boolean; error?: string; result?: WhtCertificateHandoffPageDto } = {}) {
  const query = new URLSearchParams({ tab: opts.tab ?? 'pending', search: opts.search ?? '' });
  const success: string[] = [], replaced: string[] = [], pushed: string[] = [];
  const props = { companyId: 'co', permissions: opts.permissions ?? permissions };
  const router = { replace: (href: string) => replaced.push(href), push: (href: string) => pushed.push(href), prefetch: () => {} };
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: router as any },
    h(SearchParamsContext.Provider, { value: query }, h(PathnameContext.Provider, { value: '/companies/co/expenses/wht-certificates' },
      h(ToastContext.Provider, { value: { success: (text: string) => success.push(text), warning: () => {}, error: () => {} } }, h(WhtCertificatesPage, props))))),
    [opts.search ?? '', opts.result ?? data(opts.rows), opts.loading ?? false, opts.error ?? null, 0]);
  return { ...view, query, props, success, replaced, pushed };
}
test('every card is one accessible row with facts and no list actions', () => {
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'] as const) {
    const view = setup({ rows: [row({ status, certificateNumber: 'WT-01' })] });
    const html = view.render();
    assert.equal(view.nodes.filter(n => n.tag === 'MoreActions' || n.tag === 'WhtIssueButton' || n.tag === 'WhtPayeeAddressDialog').length, 0);
    const card = view.find('article');
    assert.equal(card.role, 'link'); assert.equal(card.tabIndex, 0); assert.equal(card['aria-label'], 'เปิดรายจ่าย EX-01');
    assert.match(html, /3.00 บาท/);
    assert.doesNotMatch(html, /data-primary-action|ตัวเลือก|พิมพ์ใบแทน|ดาวน์โหลดหนังสือรับรอง|รายจ่ายเลขที่|เลขผู้เสียภาษี<|฿/);
    if (status !== 'REQUIRED') assert.match(html, /WT-01/);
    view.cleanup();
  }
});

test('search retains its full spoken name and one short placeholder', () => {
  const view = setup({ rows: [row()] }); const html = view.render();
  assert.equal(view.find('input', p => !!p.placeholder).placeholder, 'ค้นชื่อผู้รับเงิน เลขผู้เสียภาษี หรือเลขที่');
  assert.equal(view.find('input', p => !!p.placeholder)['aria-label'], 'ค้นชื่อผู้รับเงิน เลขผู้เสียภาษี เลขที่ใบ หรือเลขที่รายจ่าย');
  assert.doesNotMatch(html, />ค้นชื่อผู้รับเงิน เลขผู้เสียภาษี เลขที่ใบ หรือเลขที่รายจ่าย<\/p>/); view.cleanup();
});

test('issued rows route to the certificate section regardless of replacement eligibility', () => {
  for (const allowed of [true, false]) for (const open of [true, false]) {
    const view = setup({ rows: [row({ status: 'SYSTEM_ISSUED', certificateId: 'cert', systemReplacementOpen: open })], permissions: allowed ? permissions : ['wht.certificate.issue'] });
    assert.doesNotMatch(view.render(), /ดาวน์โหลด|พิมพ์ใบแทน|ตัวเลือก/);
    view.find('tr', p => p.role === 'link').onClick();
    assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate'); view.cleanup();
  }
});

test('each tab and an unmatched search put its one empty sentence in EmptyState title', () => {
  const titles = { pending: 'ไม่มีรายการที่ต้องออกหนังสือรับรอง', system: 'ยังไม่มีใบที่ออกในระบบ', external: 'ยังไม่มีรายการที่ทำนอกระบบ', cancelled: 'ไม่มีรายการที่ยกเลิก' };
  for (const tab of Object.keys(titles) as WhtCertificateTab[]) {
    const view = setup({ tab }); const html = view.render();
    assert.equal(view.find('EmptyState').title, titles[tab]);
    assert.equal(html.includes('เมื่อยืนยันรายจ่ายที่หักภาษี ณ ที่จ่าย รายการจะมาอยู่ที่นี่'), tab === 'pending');
    assert.equal(view.nodes.filter(n => n.tag === 'button' && 'aria-pressed' in n.props).length, 4);
    assert.equal(view.nodes.filter(n => n.tag === 'button' && n.props['aria-pressed'] === true).length, 1);
    assert.ok(html.includes('หนังสือรับรอง 50 ทวิ')); view.cleanup(); // one name for the page and its menu row (the glossary's)
  }
  const view = setup({ search: 'ไม่มี' }); view.render(); assert.equal(view.find('EmptyState').title, 'ไม่พบรายการที่ค้นหา'); view.cleanup();
});
test('loading, retry and forbidden use shared states without a request id and forbidden performs no read', async () => {
  const request = mock.method(taxApi, 'listWithholdingCertificates', async () => data());
  const denied = setup({ permissions: [] }); assert.match(denied.render(true), /ไม่มีสิทธิ์/); await denied.settle(); assert.equal(request.mock.callCount(), 0);
  const loading = setup({ loading: true, result: null as any }); loading.state[1] = null;
  loading.render(); assert.ok(loading.nodes.some(n => n.tag === 'LoadingState'));
  const failed = setup({ error: 'ยังโหลดไม่ได้ กรุณาลองอีกครั้ง' }); failed.render();
  const state = failed.find('ErrorState'); assert.equal(state.requestId, undefined); state.onRetry(); assert.equal(failed.state[4], 1);
  for (const view of [denied, loading, failed]) view.cleanup(); request.mock.restore();
});
test('list sends URL status/search/page and ignores a superseded company response', async () => {
  let resolveOld!: (value: WhtCertificateHandoffPageDto) => void;
  const request = mock.method(taxApi, 'listWithholdingCertificates', (...args: any[]) => {
    assert.equal(args[1].status, 'EXTERNAL_LINKED'); assert.equal(args[1].search, 'ชื่อ'); assert.equal(args[1].pageSize, 10);
    return args[0] === 'co' ? new Promise<WhtCertificateHandoffPageDto>(resolve => { resolveOld = resolve; }) : Promise.resolve(data([row({ id: 'new' })]));
  });
  const view = setup({ tab: 'external', search: 'ชื่อ' });
  try { view.render(true); view.props.companyId = 'other'; view.render(true); await view.settle();
    resolveOld(data([row({ id: 'stale' })])); await view.settle(); assert.equal((view.state[1] as WhtCertificateHandoffPageDto).rows[0].id, 'new');
  } finally { view.cleanup(); request.mock.restore(); }
});
test('ready rows delegate issue and refusals to the expense certificate section without list mutations', () => {
  const issue = mock.method(api, 'issueSystemWhtCertificate', () => { throw Error('list must not issue'); });
  const view = setup({ rows: [row()] });
  try {
    assert.doesNotMatch(view.render(), /data-primary-action|ออกหนังสือรับรอง 50 ทวิ/);
    view.find('article').onClick();
    assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate');
    assert.equal(issue.mock.callCount(), 0); assert.deepEqual(view.success, []);
  } finally { view.cleanup(); issue.mock.restore(); }
});

test('downloads and replacement copies leave no command or toast on the list', () => {
  const read = mock.method(api, 'downloadSystemWhtCertificate', () => { throw Error('list must not download'); });
  const replace = mock.method(api, 'issueSystemWhtReplacementCopy', () => { throw Error('list must not replace'); });
  const view = setup({ tab: 'system', rows: [row({ status: 'SYSTEM_ISSUED', certificateId: 'cert', certificateNumber: 'WT-01' })] });
  try {
    assert.doesNotMatch(view.render(), /ดาวน์โหลด|พิมพ์ใบแทน|ตัวเลือก/);
    view.find('article').onClick();
    assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate');
    assert.equal(read.mock.callCount(), 0); assert.equal(replace.mock.callCount(), 0); assert.deepEqual(view.success, []);
  } finally { view.cleanup(); read.mock.restore(); replace.mock.restore(); }
});

test('tabs and debounced search persist in the URL, restore browser filters, and invalid pages return to the last page', async () => {
  const request = mock.method(taxApi, 'listWithholdingCertificates', async () => data());
  let runTimer: (() => void) | undefined;
  const timer = mock.method(globalThis, 'setTimeout', ((fn: () => void, delay: number) => { assert.equal(delay, 300); runTimer = fn; return 1; }) as any);
  const clear = mock.method(globalThis, 'clearTimeout', () => {});
  const view = setup();
  const runtime = require('react'), originalRef = runtime.useRef, refs: any[] = []; let refIndex = 0;
  const ref = mock.method(runtime, 'useRef', (initial: unknown) => { const value = originalRef(initial); return refs[refIndex++] ??= value; });
  const render = (effects = false) => { refIndex = 0; return view.render(effects); };
  try {
    render(); view.find('FilterTabs').onChange('system');
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.get('tab'), 'system');
    view.find('input', p => p.type === 'search').onChange({ target: { value: 'ชื่อ & เลข' } }); render(true);
    assert.ok(runTimer); runTimer();
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.get('search'), 'ชื่อ & เลข');
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.get('tab'), 'system', 'typing before the tab URL commits must keep the chosen tab');
    view.query.set('search', 'จากลิงก์'); view.query.set('tab', 'cancelled'); view.query.set('page', '3');
    render(true); assert.equal(view.state[0], 'จากลิงก์'); await view.settle();
    const url = new URL(view.replaced.at(-1)!, 'http://localhost'); assert.equal(url.searchParams.get('tab'), 'cancelled'); assert.equal(url.searchParams.has('page'), false);
  } finally { view.cleanup(); for (const stub of [request, timer, clear, ref]) stub.mock.restore(); }
});
test('phone card and wide table share destinations; names and badges wrap separately and numeric columns align right', () => {
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./WhtCertificatesPage.tsx', import.meta.url), 'utf8');
  // The tabs are the shared filter tabs (one row that scrolls on a phone, compact from 640 px), not a grid of wide buttons.
  assert.match(source, /<FilterTabs className=\{styles.tabs\}/); assert.doesNotMatch(css, /\.filters/); assert.match(css, /min-height: 44px/);
  assert.match(css, /\.table \.money \{ text-align: right; \}/); assert.doesNotMatch(css, /-webkit-line-clamp/); assert.doesNotMatch(css.match(/\.name[^}]*}/)?.[0] ?? '', /white-space: nowrap/); assert.match(css, /\.badge[^}]*white-space: normal/);
  assert.match(css, /@container[^}]*\.cards \{ display: none;/); assert.doesNotMatch(css + source, /overflow-x/); assert.match(source, /<th>แบบ<\/th>/);
  const view = setup({ rows: [row()] }); const html = view.render();
  assert.match(html, /data-testid="wht-certificate-card-list"/); assert.match(html, /data-testid="wht-certificate-table"/);
  view.cleanup();
  for (const [key, value] of Object.entries(workspaceDictionary.th).filter(([key]) => key.startsWith('expenses.certificates.'))) {
    assert.doesNotMatch(value.replace(/\{[^}]+\}/g, ''), new RegExp('[A-Za-z]|' + 'ทวิ' + ' 50')); assert.ok(key in workspaceDictionary.en);
  }
  for (const tab of Object.keys(WHT_CERTIFICATE_TABS)) assert.ok(source.includes('empty_${tab}'));
});


test('list pending cards show no cancelled-certificate history (owner 2026-10-15); without a payee address the row names the missing address', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['OLD-1', null]) {
    const r = row({ previousCertificate: { kind, number, cancelledAt: '2026-10-10T03:00:00Z' }, hasPayeeAddress: false, certificateNumber: null, certificateIssuedAt: null });
    const view = certificateHarness(() => h(WhtCertificateCard, { row: r, companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    const html = view.render().replace(/<[^>]*>/g, '');
    assert.ok(!html.includes('ใบเดิม')); assert.ok(!html.includes('OLD-1')); assert.ok(!html.includes('ยกเลิกแล้ว'));
    assert.ok(html.includes('ขาดที่อยู่ผู้รับเงิน'));
    assert.doesNotMatch(html, /เพิ่มที่อยู่|ออกหนังสือรับรอง 50 ทวิ/);
    assert.doesNotMatch(view.render(), /data-primary-action|<button|<details/);
    assert.ok(!html.includes('ออกเมื่อ'));
    assert.equal((view.render().match(/data-primary-action=/g) ?? []).length, 0); view.cleanup();
  }
  for (const over of [{ hasPayeeAddress: true }, { missing: ['FORM_TYPE_UNRESOLVED'] as const }, { status: 'SYSTEM_ISSUED' as const }]) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row(over as any), companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    assert.ok(!view.render().includes('เพิ่มที่อยู่ก่อนจึงจะออกหนังสือรับรองได้')); view.cleanup();
  }
  // One set of names for the tabs of the list and the states of the card on the expense page.
  assert.deepEqual((['pending', 'system', 'external', 'cancelled'] as const).map(tab => workspaceDictionary.th[`expenses.certificates.${tab}`]), ['ยังไม่ออก', 'ออกแล้ว', 'ทำนอกระบบ', 'ยกเลิกแล้ว']);
});


test('a pending list row names missing payer fields and links managers to the profile without offering issue', () => {
  const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ payerMissing: ['ADDRESS'] }), companyId: 'co', permissions: [...permissions, 'company.legal_identity.manage'], locale: 'th', busy: false, onAction() {} }));
  // The shop's own missing details are one fact about the shop: a row only says it waits for them, and offers no issue.
  const html = view.render(); assert.ok(html.includes('ขาดข้อมูลร้าน')); assert.ok(!html.includes('settings/profile')); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ')); assert.doesNotMatch(html, /mangmee-btn-primary/); view.cleanup();
  // The page says it once above the list, with the one button for a person who may fill the shop's details in.
  for (const allowed of [true, false]) {
    const page = setup({ rows: [row({ id: 'a', payerMissing: ['ADDRESS'] }), row({ id: 'b', payerMissing: ['TAX_ID', 'ADDRESS'] }), row({ id: 'c' })], permissions: [...permissions, ...(allowed ? ['company.legal_identity.manage'] : [])] });
    const list = page.render();
    assert.equal(list.split('ข้อมูลร้านยังไม่ครบ ออกหนังสือรับรองไม่ได้').length - 1, allowed ? 1 : 0);
    assert.ok(list.includes('ขาดข้อมูลร้าน')); assert.ok(list.includes('พร้อมออก')); // each row says what it lacks
    assert.equal(list.includes('href="/companies/co/settings/profile?returnTo='), allowed); assert.equal(list.includes('กรอกข้อมูลร้าน'), allowed);
    assert.doesNotMatch(list, /mangmee-btn-primary/, 'a list of rows has no filled button');
    page.cleanup();
  }
});


test('cancelled cards show cancellation date, the history cause and typed reason instead of the issue date', () => {
  for (const eventType of ['CANCELLED_SOURCE_REOPENED', 'CANCELLED_SOURCE_VOIDED', 'EXTERNAL_RECORD_REMOVED'] as const) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ status: 'CANCELLED', certificateNumber: 'WHT-OLD', certificateIssuedAt: '2026-10-09',
      cancellation: { cancelledAt: '2026-10-11T03:00:00Z', eventType, reason: 'บันทึกผิดรายการ' } }), companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    const html = view.render(); assert.ok(html.includes('ยกเลิกเมื่อ')); assert.ok(!html.includes('ออกเมื่อ'));
    assert.ok(html.includes(eventType === 'CANCELLED_SOURCE_REOPENED' ? 'เพราะเอกสารถูกแก้ไข' : eventType === 'CANCELLED_SOURCE_VOIDED' ? 'เพราะเอกสารถูกยกเลิก' : 'ยกเลิกการบันทึกหนังสือรับรองที่ทำนอกระบบ'));
    assert.ok(html.includes('บันทึกผิดรายการ')); assert.ok(html.includes('WHT-OLD')); view.cleanup();
  }
});


test('the certificate issue dictionary label reads the same contract name used by both refusals', async () => {
  const { WHT_PRINT_CERTIFICATE_LABEL } = await import('@watchdog-bms/contracts');
  assert.equal(workspaceDictionary.th['wht.print_certificate'], WHT_PRINT_CERTIFICATE_LABEL);
});
test('a list card shows a two-line payee name and keeps certificate and expense numbers with their labels', () => {
  const value = row({ status: 'SYSTEM_ISSUED', certificateNumber: 'WHT-2026-00036', expenseNumber: 'EXP-2026-00036', payeeName: 'บริษัท ดอกไม้และของขวัญ จำกัด' });
  const view = certificateHarness(() => h(WhtCertificateCard, { row: value, companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
  const html = view.render();
  assert.ok(html.includes('บริษัท ดอกไม้และของขวัญ จำกัด'));
  assert.match(html, /<span class="unit">WHT-2026-00036<\/span>/);
  // The words may wrap before the number; the number itself never breaks.
  assert.match(html, /<span class="unit">EXP-2026-00036<\/span>/); assert.doesNotMatch(html, /รายจ่ายเลขที่/);
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.table \.money \{ text-align: right; \}/); assert.doesNotMatch(css, /-webkit-line-clamp/); assert.match(css, /\.unit[^}]*display: inline-block[^}]*max-width: 100%/);
});


test('empty search points to every matching tab and keeps the search when viewing its results', () => {
  const result = data(); result.counts.SYSTEM_ISSUED = 1; result.counts.CANCELLED = 2;
  const view = setup({ search: 'WHT-2026-00037', result });
  try {
    const html = view.render();
    assert.ok(html.includes('ไม่พบในแท็บนี้ · พบ 1 รายการใน “ออกแล้ว”'));
    assert.ok(html.includes('ไม่พบในแท็บนี้ · พบ 2 รายการใน “ยกเลิกแล้ว”'));
    assert.ok(!html.includes('ไม่พบรายการที่ค้นหา'));
    const actions = view.nodes.filter(n => n.tag === 'button' && n.props.children.includes('ดู'));
    assert.equal(actions.length, 2);
    actions[1].props.onClick();
    const params = new URL(view.replaced.at(-1)!, 'http://localhost').searchParams;
    assert.equal(params.get('tab'), 'cancelled'); assert.equal(params.get('search'), 'WHT-2026-00037'); assert.equal(params.has('page'), false);
  } finally { view.cleanup(); }
});
test('paid amounts use the current certificate when corrected and the pending prefill otherwise', () => {
  const view = setup({ rows: [row({ status: 'SYSTEM_ISSUED', currentCertificate: { grossAmount: '2500' } as WhtCertificateRow['currentCertificate'], withheldAmount: '75' })] });
  try { const html = view.render(); assert.match(html, /<td class="money">2,500.00<\/td><td class="money">75.00<\/td>/); assert.match(html, /75.00 บาท/); assert.doesNotMatch(html, /฿/); } finally { view.cleanup(); }
});
test('missing address routes to the expense certificate section with no list dialog', () => {
  const view = setup({ rows: [row({ hasPayeeAddress: false })] });
  try {
    assert.match(view.render(), /ขาดที่อยู่ผู้รับเงิน/);
    assert.equal(view.nodes.some(n => n.tag === 'WhtPayeeAddressDialog'), false);
    view.find('article').onClick();
    assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate');
    assert.equal(view.state[4], 0);
  } finally { view.cleanup(); }
});

test('historical search names the old number and only names a certificate still in effect', () => {
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'] as const) {
    const value = row({ status, matchedPreviousNumber: 'WHT-OLD', certificateNumber: 'WHT-NEW', externalCertificateNumber: 'EXT-NEW' });
    const view = certificateHarness(() => h(WhtCertificateCard, { row: value, companyId: 'co', permissions, locale: 'th', busy: false, onAction() {}, onAddress() {} }));
    const html = view.render().replace(/<[^>]*>/g, '');
    assert.ok(html.includes('เลขที่ WHT-OLD ถูกแทนหรือยกเลิกแล้ว'));
    assert.equal(html.includes('ใบปัจจุบันคือ'), false);
    if (status === 'SYSTEM_ISSUED') assert.ok(html.includes('WHT-NEW'));
    if (status === 'EXTERNAL_LINKED') assert.ok(html.includes('EXT-NEW'));
    view.cleanup();
  }
});
test('description and tax id are absent on cards and table; expense numbers remain reachable', () => {
  const view = setup({ rows: [row({ expenseDescription: 'ค่าเดินทาง; ค่าจอดรถ' })] });
  const html = view.render();
  assert.doesNotMatch(html, /ค่าเดินทาง|ค่าจอดรถ|1234567890123|รายจ่ายเลขที่/);
  assert.equal((html.match(/>EX-01<\/span>/g) ?? []).length, 2); assert.equal((html.match(/aria-label="เปิดรายจ่าย EX-01"/g) ?? []).length, 2);
  view.cleanup();
});

test('month and form filters reach the paged read, reset paging and keep the status tab', async () => {
  const request = mock.method(taxApi, 'listWithholdingCertificates', async () => data());
  const view = setup({ tab: 'external', rows: [] });
  view.query.set('periodKey', '2026-10'); view.query.set('formType', 'PND3');
  try {
    const html = view.render(true); await view.settle();
    assert.ok(html.includes('ภ.ง.ด.3')); assert.ok(html.includes('แบบภาษี'));
    assert.equal(request.mock.calls[0].arguments[1].periodKey, '2026-10');
    assert.equal(request.mock.calls[0].arguments[1].formType, 'PND3');
    view.find('SelectField', p => p.label === 'แบบภาษี').onChange({ target: { value: 'PND53' } });
    assert.match(view.replaced.at(-1)!, /formType=PND53/); assert.match(view.replaced.at(-1)!, /tab=external/); assert.match(view.replaced.at(-1)!, /page=1/);
  } finally { view.cleanup(); request.mock.restore(); }
});

test('month chooser uses the shared Thai select with all months and only server data months', () => {
  const view = setup({ result: { ...data(), months: ['2026-10', '2026-07'] } });
  try {
    const html = view.render();
    assert.doesNotMatch(html, /type="month"/);
    const chooser = view.find('SelectField', p => p.label === 'เดือนที่จ่าย');
    const options = React.Children.toArray(chooser.children.flat()) as React.ReactElement[];
    assert.deepEqual(options.map(option => (option.props as any).value), ['', '2026-10', '2026-07']);
    assert.deepEqual(options.map(option => (option.props as any).children), ['ทุกเดือน', 'ต.ค. 2569', 'ก.ค. 2569']);
    chooser.onChange({ target: { value: '2026-07' } });
    assert.match(view.replaced.at(-1)!, /periodKey=2026-07/);
    chooser.onChange({ target: { value: '' } });
    assert.doesNotMatch(view.replaced.at(-1)!, /periodKey=/);
  } finally { view.cleanup(); }
});


test('month, form and search share one row from 1024px; phone uses a single row target', () => {
  const view = setup({ result: data() });
  try {
    const html = view.render();
    const month = view.find('SelectField', p => p.label === 'เดือนที่จ่าย');
    const form = view.find('SelectField', p => p.label === 'แบบภาษี');
    assert.equal(month.disabled, form.disabled);
    assert.match(html, /grid-cols-1 items-end gap-4 lg:grid-cols-3/);
    assert.doesNotMatch(html, /<select/);
    const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /\.primary/);
    assert.match(css, /\.heading \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  } finally { view.cleanup(); }
});


test('concept list uses filtered metrics, separate numeric columns and the prominent pager without range text', () => {
  const result = { ...data([row()]), total: 41, sums: { withheld: '1234.50' } };
  const view = setup({ result }); const html = view.render();
  assert.match(html, /mangmee-flat/);
  assert.deepEqual(view.find('MetricGrid').items.map((item: any) => [item.label, item.value, item.unit]), [['ยังไม่ออก', '41', 'ใบ'], ['ภาษีที่หักไว้', '1,234.50', 'บาท']]);
  assert.equal(view.find('MetricGrid').columns, 2);
  for (const label of ['ผู้รับเงิน', 'แบบ', 'ยอดจ่าย', 'ภาษีหักไว้']) assert.ok(html.includes('>' + label + '</th>'), label);
  // สถานะ appears only when a row has something beyond the tab's own name to say.
  assert.equal(view.find('Pagination').prominent, true);
  assert.equal(view.find('Pagination').totalPages, 5);
  assert.doesNotMatch(html, /฿|รายจ่ายเลขที่|แสดง 1-/);
  view.cleanup();
});

test('payment date uses the recorded payment, never the expense date for pending unpaid or multiple payments', () => {
  for (const [payments, expected] of [
    [[], 'ยังไม่จ่าย'],
    [[{ paidAt: '2026-10-15', paidAtConfirmed: true }], '15 ต.ค. 2569'],
    [[{ paidAt: '2026-10-15' }, { paidAt: '2026-10-16' }], 'หลายการจ่าย'],
  ] as const) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ payments: payments as any }), companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    assert.ok(view.render().includes(expected));
    assert.ok(!view.render().includes('11 ต.ค. 2569'));
    view.cleanup();
  }
});

test('date order persists in the URL, resets the page and reaches the ten-row server query', async () => {
  const originalSelf = globalThis.self; globalThis.self = globalThis as any;
  const calls: any[] = [];
  const request = mock.method(taxApi, 'listWithholdingCertificates', async (_company: string, query: any) => { calls.push(query); return { ...data([row()]), total: 25 }; });
  const view = setup({ rows: [row()], result: { ...data([row()]), total: 25 } });
  try {
    view.query.set('page', '2'); view.query.set('periodKey', '2026-10');
    view.render(true); await view.settle();
    view.find('button', p => p['aria-label'] === 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่').onClick();
    const url = new URL(view.replaced.at(-1)!, 'http://localhost');
    assert.equal(url.searchParams.get('order'), 'oldest'); assert.equal(url.searchParams.has('page'), false);
    assert.equal(url.searchParams.get('periodKey'), '2026-10');
    view.query.set('order', 'oldest'); view.query.delete('page'); view.render(true); await view.settle();
    assert.equal(calls.at(-1).order, 'oldest'); assert.equal(calls.at(-1).pageSize, 10); assert.equal(calls.at(-1).page, 1);
    assert.equal(view.find('Pagination').totalPages, 3);
    view.find('button', p => p['aria-label'] === 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า').onClick();
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.has('order'), false);
  } finally { view.cleanup(); request.mock.restore(); if (originalSelf === undefined) delete (globalThis as any).self; else globalThis.self = originalSelf; }
});

test('all tab column widths total 100 percent and certificate metadata stays under the payee', () => {
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.table th \{[^}]*font-size: 13px; font-weight: 700; color: var\(--color-gray-500\)/);
  assert.doesNotMatch(css, /menuCell/);
  assert.match(css, /\.table \.status \{ text-align: right;/);
  for (const tab of ['pending', 'system', 'external', 'cancelled'] as const) for (const held of [false, true]) {
    const view = setup({ tab, rows: [row({ status: WHT_CERTIFICATE_TABS[tab], missing: held ? ['FORM_TYPE_UNRESOLVED'] : [], certificateNumber: 'WHT-2026-00065' })] });
    const html = view.render();
    assert.doesNotMatch(html, /<th[^>]*>หนังสือรับรอง<\/th>|ออกเมื่อ/);
    const columns = view.nodes.filter(node => node.tag === 'col');
    assert.ok(columns.length >= 5); assert.ok(columns.every(node => node.props.style.width.endsWith('%')));
    // With no action column, data columns fill 100% and the payee stays widest.
    const widths = columns.map(node => Number(node.props.style.width.replace('%', '')));
    assert.equal(widths.reduce((sum, width) => sum + width, 0), 100); assert.equal(Math.max(...widths), widths[0]);
    if (tab === 'system') assert.match(html, /WHT-2026-00065<\/span> · <span[^>]*>EX-01/);
    view.cleanup();
  }
});

test('rows and cards route to the first missing section by click or Enter without nested controls', () => {
  for (const [over, section] of [[{}, 'certificate'], [{ payments: [] }, 'payment'], [{ missing: ['FORM_TYPE_UNRESOLVED'] }, 'withholding']] as const) {
    const view = setup({ rows: [row(over as any)] });
    try {
      const html = view.render();
      for (const tag of ['tr', 'article']) {
        const props = view.find(tag, p => p.role === 'link');
        props.onClick(); assert.equal(view.pushed.at(-1), `/companies/co/expenses/expense-private?section=${section}`);
        const target = {}; let prevented = false; const before = view.pushed.length;
        props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() { prevented = true; } });
        assert.equal(prevented, true); assert.equal(view.pushed.length, before + 1);
        props.onKeyDown({ key: 'Enter', target: {}, currentTarget: target });
        assert.equal(view.pushed.length, before + 1);
      }
      assert.doesNotMatch(html, /ตัวเลือก|data-primary-action/);
      const source = readFileSync(new URL('./WhtCertificatesPage.tsx', import.meta.url), 'utf8');
      assert.match(source, /<MangmeeCard className="p-4">\s*<FilterTabs/);
    } finally { view.cleanup(); }
  }
});
test('shop rows use the banner destination and preserve every list filter', () => {
  for (const allowed of [true, false]) {
    const view = setup({ rows: [row({ payerMissing: ['ADDRESS'] })], permissions: [...permissions, ...(allowed ? ['company.legal_identity.manage'] : [])] });
    view.query.set('periodKey', '2026-10'); view.query.set('order', 'oldest'); view.render();
    view.find('article').onClick();
    if (allowed) {
      const banner = view.nodes.find(node => node.props.href?.includes('settings/profile'))!.props;
      assert.equal(view.pushed.at(-1), banner.href);
      assert.equal(new URL(view.pushed.at(-1)!, 'http://localhost').searchParams.get('returnTo'), `/companies/co/expenses/wht-certificates?${view.query}`);
    } else assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate');
    view.cleanup();
  }
});

test('expense-list typography, padding, rule and hover are reused on every table tab', () => {
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.name \{ font-size: 15px; color: var\(--color-gray-900\);[^}]*font-weight: 600/);
  assert.match(css, /\.number \{[^}]*color: var\(--color-gray-500\); font-size: 12px/);
  assert.match(css, /padding: calc\(var\(--spacing\) \* 3\) calc\(var\(--spacing\) \* 2\)/);
  assert.match(css, /\.table td.money \{ font-size: 15px; font-weight: 700; color: var\(--color-gray-900\)/);
  assert.match(css, /\.table \.date \{ font-size: 12px; color: var\(--color-gray-500\)/);
  assert.match(css, /border-bottom: 1px solid var\(--color-gray-50\)/);
  assert.match(css, /tr:hover \{ background: var\(--color-gray-50\)/);
});


test('WHT-OUTSIDE-2 recorded rows show an outside badge and the optional file in both layouts', () => {
  const view = setup({ rows: [row({ status: 'EXTERNAL_LINKED', externalAttachmentId: 'external-file' })], tab: 'external' });
  try {
    const html = view.render();
    assert.equal(view.nodes.filter(node => node.tag === 'ExpenseCertificateFile').length, 2);
    for (const node of view.nodes.filter(node => node.tag === 'ExpenseCertificateFile')) {
      assert.equal(node.props.attachmentId, 'external-file');
      assert.equal(node.props.handoffId, row().id);
    }
    assert.match(html, /ทำนอกระบบ/);
    assert.equal((html.match(/>ดูไฟล์</g) ?? []).length, 2);
  } finally { view.cleanup(); }
});


test('PND2 handoff offers the supported next action and retains its label filter and URL', async () => {
  const request = mock.method(taxApi, 'listWithholdingCertificates', async () => data());
  const view = setup({ rows: [row({ formType: 'PND2', prefill: { ...row().prefill, formType: 'PND2' }, systemIssuanceOpen: false })] });
  view.query.set('formType', 'PND2'); view.query.set('periodKey', '2026-10');
  try {
    const html = view.render(true); await view.settle();
    assert.match(html, /ภ.ง.ด.2/); assert.doesNotMatch(html, /ยังไม่รู้แบบภาษี/);
    assert.equal(request.mock.calls[0]!.arguments[1].formType, 'PND2');
    const filter = view.find('SelectField', props => props.label === 'แบบภาษี');
    assert.equal(filter.value, 'PND2');
    assert.match(renderToStaticMarkup(filter.children), /value="PND2"/);
    filter.onChange({ target: { value: 'PND2' } });
    assert.match(view.replaced.at(-1)!, /formType=PND2/);
    view.find('article').onClick();
    assert.equal(view.pushed.at(-1), '/companies/co/expenses/expense-private?section=certificate');
    assert.equal(view.nodes.some(node => node.tag === 'WhtIssueButton'), false);
  } finally { request.mock.restore(); view.cleanup(); }
});

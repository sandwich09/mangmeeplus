import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
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
const api = mutable('./expenses.api');
const downloads = mutable('@/common/files/download-artifact');
const { WhtCertificateCard, WhtCertificatesPage } = require('./WhtCertificatesPage');
for (const [ext, loader] of loaders) { if (loader) require.extensions[ext] = loader; else delete require.extensions[ext]; }
const permissions = ['wht.certificate.issue', 'wht.certificate.correct'];
const row = (over: Partial<WhtCertificateRow> = {}) => ({
  id: 'handoff-private', companyId: 'co', status: 'REQUIRED', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-private',
  payeeName: 'ร้านทดสอบชื่อยาวสำหรับโทรศัพท์', payeeTaxId: '1234567890123', expenseId: 'expense-private', expenseNumber: 'EX-01',
  documentDate: '2026-10-11', withheldAmount: '3', missing: [], systemIssuanceOpen: true, systemCorrectionOpen: true,
  systemReplacementOpen: true, certificateId: null, certificateNumber: null, certificateIssuedAt: null,
  prefill: { grossAmount: '100', withheldAmount: '3', payeeSnapshot: { name: 'ร้านทดสอบ', address: null } } as WhtCertificateRow['prefill'],
  externalCertificateNumber: null, externalIssuedDate: null, ...over,
} as WhtCertificateRow);
const data = (rows: WhtCertificateRow[] = []): WhtCertificateHandoffPageDto => ({ rows, total: rows.length, page: 1, pageSize: 20,
  counts: { REQUIRED: rows.filter(r => r.status === 'REQUIRED').length, SYSTEM_ISSUED: rows.filter(r => r.status === 'SYSTEM_ISSUED').length,
    EXTERNAL_LINKED: rows.filter(r => r.status === 'EXTERNAL_LINKED').length, CANCELLED: rows.filter(r => r.status === 'CANCELLED').length } });
function setup(opts: { tab?: WhtCertificateTab; search?: string; rows?: WhtCertificateRow[]; permissions?: string[]; loading?: boolean; error?: string; result?: WhtCertificateHandoffPageDto } = {}) {
  const query = new URLSearchParams({ tab: opts.tab ?? 'pending', search: opts.search ?? '' });
  const success: string[] = [], replaced: string[] = [];
  const props = { companyId: 'co', permissions: opts.permissions ?? permissions };
  const router = { replace: (href: string) => replaced.push(href), push: () => {}, prefetch: () => {} };
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: router as any },
    h(SearchParamsContext.Provider, { value: query }, h(PathnameContext.Provider, { value: '/companies/co/expenses/wht-certificates' },
      h(ToastContext.Provider, { value: { success: (text: string) => success.push(text), warning: () => {}, error: () => {} } }, h(WhtCertificatesPage, props))))),
    [opts.search ?? '', opts.result ?? data(opts.rows), opts.loading ?? false, opts.error ?? null, 0, null, {}]);
  return { ...view, query, props, success, replaced };
}
test('each card has one primary action; missing facts use the contract sentences and link to its expense', () => {
  for (const [r, label] of [
    [row(), 'ออกหนังสือรับรอง 50 ทวิ'],
    [row({ missing: ['FORM_TYPE_UNRESOLVED', 'INCOME_CATEGORY_OR_RATE_MISSING'] }), 'เปิดรายจ่ายเพื่อแก้ไข'],
    [row({ status: 'SYSTEM_ISSUED', certificateId: 'cert-private', certificateNumber: 'WT-01', certificateIssuedAt: '2026-10-11' }), 'ดาวน์โหลด'],
    // A row with nothing left to do carries no button: its expense number is the link.
    [row({ status: 'EXTERNAL_LINKED' }), null], [row({ status: 'CANCELLED' }), null],
    [row({ systemIssuanceOpen: false }), 'เปิดรายจ่าย'],
  ] as const) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: r, companyId: 'co', permissions, locale: 'th', busy: false, onAction: () => {} }));
    const html = view.render();
    assert.equal((html.match(/data-primary-action=/g) ?? []).length, label ? 1 : 0);
    // Exactly one control leads to the expense page: the button where the next step is there, otherwise the number.
    assert.equal((html.match(/href="\/companies\/co\/expenses\/expense-private"/g) ?? []).length, 1);
    if (label) assert.ok(html.includes(label)); else assert.ok(!html.includes('เปิดรายจ่าย'));
    assert.ok(html.includes('จ่าย ฿100.00 · หักไว้ ฿3.00')); assert.ok(html.includes('รายจ่ายเลขที่ <span class="whitespace-nowrap">EX-01</span>'));
    assert.doesNotMatch(html, /ภ\.ง\.ด\.|REQUIRED|SYSTEM_ISSUED|EXTERNAL_LINKED|CANCELLED|cert-private/);
    assert.match(html, /href="\/companies\/co\/expenses\/expense-private"/);
    if (r.missing.length) {
      assert.ok(html.includes('ข้อมูลไม่ครบ'));
      for (const reason of r.missing) assert.ok(html.includes(WHT_HANDOFF_MISSING_LABELS[reason]));
      assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
    }
    if (r.status === 'SYSTEM_ISSUED') { assert.ok(html.replace(/<[^>]*>/g, '').includes('เลขที่ WT-01 · ออกเมื่อ')); assert.ok(html.includes('>เลขที่ WT-01</span>')); assert.ok(!html.includes('<details'), 'a single rarer action is not hidden in a menu'); }
    view.cleanup();
  }
});
test('walk C: an empty tax id reads "-", a busy card says so on its one button, the search sentence is a line under the box', () => {
  const busy = certificateHarness(() => h(WhtCertificateCard, { row: row({ payeeTaxId: '' }), companyId: 'co', permissions, locale: 'th', busy: true, onAction: () => {} }));
  const html = busy.render();
  assert.ok(html.includes('เลขผู้เสียภาษี -')); assert.ok(html.includes('กำลังออกหนังสือรับรอง…')); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
  assert.equal((html.match(/data-primary-action=/g) ?? []).length, 1); busy.cleanup();
  const view = setup({ rows: [row()] }); const page = view.render();
  assert.equal(view.find('input').placeholder, 'ค้นหา'); assert.ok(page.includes('>ค้นชื่อผู้รับเงิน เลขผู้เสียภาษี เลขที่ใบ หรือเลขที่รายจ่าย</p>')); view.cleanup();
});
test('replacement copy is a quiet button under the download, without a menu, and requires both its permission and open route', () => {
  for (const allowed of [true, false]) for (const open of [true, false]) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ status: 'SYSTEM_ISSUED', certificateId: 'cert', systemReplacementOpen: open }),
      companyId: 'co', permissions: allowed ? permissions : ['wht.certificate.issue'], locale: 'th', busy: false, onAction: () => {} }));
    const html = view.render(); assert.equal(html.includes('พิมพ์ใบแทน (เลขที่เดิม)'), allowed && open);
    assert.ok(!html.includes('เพิ่มเติม')); assert.ok(!html.includes('เปิดรายจ่าย')); assert.equal((html.match(/data-primary-action=/g) ?? []).length, 1); view.cleanup();
  }
});
test('each tab and an unmatched search put its one empty sentence in EmptyState title', () => {
  const titles = { pending: 'ไม่มีรายการที่ต้องออกหนังสือรับรอง', system: 'ยังไม่มีใบที่ออกในระบบ', external: 'ยังไม่มีรายการที่บันทึกว่าออกเอง', cancelled: 'ไม่มีรายการที่ยกเลิก' };
  for (const tab of Object.keys(titles) as WhtCertificateTab[]) {
    const view = setup({ tab }); const html = view.render();
    assert.equal(view.find('EmptyState').title, titles[tab]);
    assert.equal(html.includes('เมื่อยืนยันรายจ่ายที่หักภาษี ณ ที่จ่าย รายการจะมาอยู่ที่นี่'), tab === 'pending');
    assert.equal(view.nodes.filter(n => n.tag === 'button' && 'aria-pressed' in n.props).length, 4);
    assert.equal(view.nodes.filter(n => n.tag === 'button' && n.props['aria-pressed'] === true).length, 1);
    assert.ok(html.includes('หัก ณ ที่จ่าย (50 ทวิ)')); view.cleanup();
  }
  const view = setup({ search: 'ไม่มี' }); view.render(); assert.equal(view.find('EmptyState').title, 'ไม่พบรายการที่ค้นหา'); view.cleanup();
});
test('loading, retry and forbidden use shared states without a request id and forbidden performs no read', async () => {
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => data());
  const denied = setup({ permissions: [] }); assert.match(denied.render(true), /ไม่มีสิทธิ์/); await denied.settle(); assert.equal(request.mock.callCount(), 0);
  const loading = setup({ loading: true, result: null as any }); loading.state[1] = null;
  loading.render(); assert.ok(loading.nodes.some(n => n.tag === 'LoadingState'));
  const failed = setup({ error: 'ยังโหลดไม่ได้ กรุณาลองใหม่' }); failed.render();
  const state = failed.find('ErrorState'); assert.equal(state.requestId, undefined); state.onRetry(); assert.equal(failed.state[4], 1);
  for (const view of [denied, loading, failed]) view.cleanup(); request.mock.restore();
});
test('list sends URL status/search/page and ignores a superseded company response', async () => {
  let resolveOld!: (value: WhtCertificateHandoffPageDto) => void;
  const request = mock.method(api, 'listWhtHandoffsPaged', (...args: any[]) => {
    assert.equal(args[1].status, 'EXTERNAL_LINKED'); assert.equal(args[1].search, 'ชื่อ'); assert.equal(args[1].pageSize, 20);
    return args[0] === 'co' ? new Promise<WhtCertificateHandoffPageDto>(resolve => { resolveOld = resolve; }) : Promise.resolve(data([row({ id: 'new' })]));
  });
  const view = setup({ tab: 'external', search: 'ชื่อ' });
  try { view.render(true); view.props.companyId = 'other'; view.render(true); await view.settle();
    resolveOld(data([row({ id: 'stale' })])); await view.settle(); assert.equal((view.state[1] as WhtCertificateHandoffPageDto).rows[0].id, 'new');
  } finally { view.cleanup(); request.mock.restore(); }
});
test('issue downloads, toasts the number and reloads; a server refusal stays on its card with suppressed toast', async () => {
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  const refusal = 'รายจ่ายเปลี่ยนไปแล้ว กรุณาเปิดรายจ่ายและตรวจสอบอีกครั้ง';
  let reject = false;
  const issue = mock.method(api, 'issueSystemWhtCertificate', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff-private', { suppressErrorToast: true }]);
    if (reject) throw { code: 'expense_wht_source_changed', message: refusal };
    return { certificateNumber: 'WT-01', pdfArtifact: { mimeType: 'application/pdf' } };
  });
  const view = setup({ rows: [row()] });
  try {
    view.render(); await view.find('WhtIssueButton', p => p.handoff.id === 'handoff-private').onIssue();
    assert.equal(download.mock.callCount(), 1); assert.deepEqual(view.success, ['ออกหนังสือรับรองเลขที่ WT-01 แล้ว']); assert.equal(view.state[4], 1);
    reject = true; view.render(); await view.find('WhtIssueButton', p => p.handoff.id === 'handoff-private').onIssue();
    assert.match(view.render(), new RegExp(refusal)); assert.equal(view.success.length, 1); assert.equal(download.mock.callCount(), 1);
  } finally { view.cleanup(); issue.mock.restore(); download.mock.restore(); }
});
test('download and replacement use the existing calls with one download and the replacement number toast', async () => {
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  const result = { certificateNumber: 'WT-01', pdfArtifact: { mimeType: 'application/pdf' } };
  const read = mock.method(api, 'downloadSystemWhtCertificate', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff-private', { suppressErrorToast: true }]); return result;
  });
  const replace = mock.method(api, 'issueSystemWhtReplacementCopy', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff-private', { suppressErrorToast: true }]); return result;
  });
  const view = setup({ tab: 'system', rows: [row({ status: 'SYSTEM_ISSUED', certificateId: 'cert', certificateNumber: 'WT-01' })] });
  try {
    view.render(); await view.find('button', p => p['data-primary-action'] === 'download').onClick();
    assert.equal(download.mock.callCount(), 1); assert.equal(view.state[4], 0); assert.deepEqual(view.success, []);
    view.render(); await view.find('button', p => p.children.includes('พิมพ์ใบแทน (เลขที่เดิม)')).onClick();
    assert.equal(download.mock.callCount(), 2); assert.equal(replace.mock.callCount(), 1);
    assert.deepEqual(view.success, ['พิมพ์ใบแทนเลขที่ WT-01 แล้ว']); assert.equal(view.state[4], 1);
  } finally { view.cleanup(); for (const stub of [download, read, replace]) stub.mock.restore(); }
});
test('tabs and debounced search persist in the URL, restore browser filters, and invalid pages return to the last page', async () => {
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => data());
  let runTimer: (() => void) | undefined;
  const timer = mock.method(globalThis, 'setTimeout', ((fn: () => void, delay: number) => { assert.equal(delay, 300); runTimer = fn; return 1; }) as any);
  const clear = mock.method(globalThis, 'clearTimeout', () => {});
  const view = setup();
  try {
    view.render(); view.find('button', p => p.children.includes('ออกในระบบแล้ว')).onClick();
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.get('tab'), 'system');
    view.find('input').onChange({ target: { value: 'ชื่อ & เลข' } }); view.render(true);
    assert.ok(runTimer); runTimer();
    assert.equal(new URL(view.replaced.at(-1)!, 'http://localhost').searchParams.get('search'), 'ชื่อ & เลข');
    view.query.set('search', 'จากลิงก์'); view.query.set('tab', 'cancelled'); view.query.set('page', '3');
    view.render(true); assert.equal(view.state[0], 'จากลิงก์'); await view.settle();
    const url = new URL(view.replaced.at(-1)!, 'http://localhost'); assert.equal(url.searchParams.get('tab'), 'cancelled'); assert.equal(url.searchParams.has('page'), false);
  } finally { view.cleanup(); for (const stub of [request, timer, clear]) stub.mock.restore(); }
});
test('phone card and wide table share actions; CSS keeps a single-line header, two-column tabs and 44px controls', () => {
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./WhtCertificatesPage.tsx', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/); assert.match(css, /min-height: 44px/);
  assert.match(css, /\.name[^}]*-webkit-line-clamp: 2/); assert.doesNotMatch(css.match(/\.name[^}]*}/)?.[0] ?? '', /white-space: nowrap/); assert.match(css, /\.badge[^}]*white-space: nowrap/);
  assert.match(css, /@container[^}]*\.cards \{ display: none;/); assert.doesNotMatch(css + source, /overflow-x|ภ\.ง\.ด\./);
  const view = setup({ rows: [row()] }); const html = view.render();
  assert.match(html, /data-testid="wht-certificate-card-list"/); assert.match(html, /data-testid="wht-certificate-table"/);
  view.cleanup();
  for (const [key, value] of Object.entries(workspaceDictionary.th).filter(([key]) => key.startsWith('expenses.certificates.'))) {
    assert.doesNotMatch(value.replace(/\{[^}]+\}/g, ''), new RegExp('[A-Za-z]|' + 'ทวิ' + ' 50')); assert.ok(key in workspaceDictionary.en);
  }
  for (const tab of Object.keys(WHT_CERTIFICATE_TABS)) assert.ok(source.includes('empty_${tab}'));
});


test('list pending cards remember cancellation; without a payee address the row offers the address step instead of issue', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['OLD-1', null]) {
    const r = row({ previousCertificate: { kind, number, cancelledAt: '2026-10-10T03:00:00Z' }, hasPayeeAddress: false, certificateNumber: null, certificateIssuedAt: null });
    const view = certificateHarness(() => h(WhtCertificateCard, { row: r, companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    const html = view.render().replace(/<[^>]*>/g, '');
    assert.ok(html.includes(kind === 'SYSTEM' ? 'ใบเดิม' : 'การบันทึกเดิม'));
    assert.equal(html.includes('เดิมเลขที่ OLD-1'), number !== null);
    assert.ok(html.includes('ถูกยกเลิกเมื่อ'));
    assert.ok(html.includes('ยังไม่มีที่อยู่ผู้รับเงิน'));
    assert.ok(html.includes('เพิ่มที่อยู่')); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
    assert.match(view.render(), /data-primary-action="address"/); assert.equal((html.match(/เพิ่มที่อยู่/g) ?? []).length, 1, 'the one button explains the address step');
    assert.ok(!html.includes('ออกเมื่อ')); assert.equal(view.find('button', p => p['data-primary-action'] === 'address').href, undefined);
    assert.equal((view.render().match(/data-primary-action=/g) ?? []).length, 1); view.cleanup();
  }
  for (const over of [{ hasPayeeAddress: true }, { missing: ['FORM_TYPE_UNRESOLVED'] as const }, { status: 'SYSTEM_ISSUED' as const }]) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row(over as any), companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    assert.ok(!view.render().includes('เพิ่มที่อยู่ก่อนจึงจะออกหนังสือรับรองได้')); view.cleanup();
  }
  assert.equal(workspaceDictionary.th['expenses.certificates.external'], 'ออกเองแล้ว');
});


test('a pending list row names missing payer fields and links managers to the profile without offering issue', () => {
  const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ payerMissing: ['ADDRESS'] }), companyId: 'co', permissions: [...permissions, 'company.legal_identity.manage'], locale: 'th', busy: false, onAction() {} }));
  const html = view.render(); assert.ok(html.includes('ข้อมูลร้านยังขาด: ที่อยู่ของร้าน')); assert.ok(html.includes('href="/companies/co/settings/profile?returnTo=')); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ')); view.cleanup();
});


test('cancelled cards show cancellation date, the history cause and typed reason instead of the issue date', () => {
  for (const eventType of ['CANCELLED_SOURCE_REOPENED', 'CANCELLED_SOURCE_VOIDED', 'EXTERNAL_RECORD_REMOVED'] as const) {
    const view = certificateHarness(() => h(WhtCertificateCard, { row: row({ status: 'CANCELLED', certificateNumber: 'WHT-OLD', certificateIssuedAt: '2026-10-09',
      cancellation: { cancelledAt: '2026-10-11T03:00:00Z', eventType, reason: 'บันทึกผิดรายการ' } }), companyId: 'co', permissions, locale: 'th', busy: false, onAction() {} }));
    const html = view.render(); assert.ok(html.includes('ยกเลิกเมื่อ')); assert.ok(!html.includes('ออกเมื่อ'));
    assert.ok(html.includes(eventType === 'CANCELLED_SOURCE_REOPENED' ? 'เพราะเอกสารถูกแก้ไข' : eventType === 'CANCELLED_SOURCE_VOIDED' ? 'เพราะเอกสารถูกยกเลิก' : 'ยกเลิกการบันทึกหนังสือรับรองที่ออกเอง'));
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
  assert.match(html, /<span class="unit">เลขที่ WHT-2026-00036<\/span>/);
  // The words may wrap before the number; the number itself never breaks.
  assert.match(html, /<span class="unit">รายจ่ายเลขที่ <span class="whitespace-nowrap">EXP-2026-00036<\/span><\/span>/);
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.name[^}]*-webkit-line-clamp: 2/); assert.match(css, /\.unit[^}]*display: inline-block[^}]*max-width: 100%/);
});


test('empty search points to every matching tab and keeps the search when viewing its results', () => {
  const result = data(); result.counts.SYSTEM_ISSUED = 1; result.counts.CANCELLED = 2;
  const view = setup({ search: 'WHT-2026-00037', result });
  try {
    const html = view.render();
    assert.ok(html.includes('ไม่พบในแท็บนี้ · พบ 1 รายการใน “ออกในระบบแล้ว”'));
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
  try { assert.ok(view.render().includes('จ่าย ฿2,500.00 · หักไว้ ฿75.00')); } finally { view.cleanup(); }
});
test('address buttons open the list dialog; saving re-reads the row before offering issue', async () => {
  const originalSelf = globalThis.self;
  globalThis.self = globalThis as any;
  const pending = row({ hasPayeeAddress: false });
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => data([row({ hasPayeeAddress: true, payeeAddress: '99 ถนนทดสอบ' })]));
  const view = setup({ rows: [pending] });
  try {
    view.render(); view.find('button', p => p['data-primary-action'] === 'address').onClick(); view.render();
    const dialog = view.find('WhtPayeeAddressDialog');
    assert.equal(dialog.row.id, pending.id); assert.equal(dialog.companyId, 'co');
    dialog.onSaved(); view.render(true); await view.settle();
    const html = view.render();
    assert.ok(!view.nodes.some(n => n.tag === 'WhtPayeeAddressDialog'));
    assert.ok(html.includes('ออกหนังสือรับรอง 50 ทวิ'));
    assert.ok(!html.includes('เพิ่มที่อยู่ก่อนจึงจะออกหนังสือรับรองได้'));
  } finally { view.cleanup(); request.mock.restore(); if (originalSelf === undefined) delete (globalThis as any).self; else globalThis.self = originalSelf; }
});


test('historical search names the old number and only names a certificate still in effect', () => {
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'] as const) {
    const value = row({ status, matchedPreviousNumber: 'WHT-OLD', certificateNumber: 'WHT-NEW', externalCertificateNumber: 'EXT-NEW' });
    const view = certificateHarness(() => h(WhtCertificateCard, { row: value, companyId: 'co', permissions, locale: 'th', busy: false, onAction() {}, onAddress() {} }));
    const html = view.render().replace(/<[^>]*>/g, '');
    assert.ok(html.includes('เลขที่ WHT-OLD ถูกแทนหรือยกเลิกแล้ว'));
    assert.equal(html.includes('ใบปัจจุบันคือ'), ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(status));
    if (status === 'SYSTEM_ISSUED') assert.ok(html.includes('ใบปัจจุบันคือ WHT-NEW'));
    if (status === 'EXTERNAL_LINKED') assert.ok(html.includes('ใบปัจจุบันคือ EXT-NEW'));
    view.cleanup();
  }
});
test('expense description is the first detail line on cards and is also shown in the table with ellipsis', () => {
  const view = setup({ rows: [row({ expenseDescription: 'ค่าเดินทาง; ค่าจอดรถ' })] });
  const html = view.render();
  assert.match(html, /class="facts"><p class="description" title="ค่าเดินทาง; ค่าจอดรถ">ค่าเดินทาง; ค่าจอดรถ<\/p>/);
  assert.equal((html.match(/class="description"/g) ?? []).length, 2);
  const css = readFileSync(new URL('./WhtCertificatesPage.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.description[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/);
  view.cleanup();
});

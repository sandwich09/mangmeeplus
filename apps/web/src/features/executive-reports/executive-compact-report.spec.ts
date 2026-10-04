import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXECUTIVE_WORDS as W, type ExecutiveAnalysis, type ExecutiveCompanies } from '@watchdog-bms/contracts';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const html = (component: React.ComponentType<any>, props: object) => renderToStaticMarkup(React.createElement(component, props));
const visible = (markup: string) => markup.replace(/<[^>]*>/g, '');
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const partial = { value: null, knownValue: 6, coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_FIRST_BUILD'] };
const cash = { ...partial, knownValue: 9900, currency: 'THB' };
const envelope = { period: { month: '2026-10', isPartialMonth: true }, build: { asOf: '2026-10-04' }, population: { eligibleCount: partial, unclassifiedCount: 0 }, coverage: { usage: partial, money: cash }, dataThrough: { billing: '2026-10-04', lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0, receiptsSatang: 0, refundsSatang: 0 } };
const nav = { params: new URLSearchParams('month=2026-10'), from: 'revenue', remember() {}, navigate() {} };

test('clean values keep full accessible qualifications, dots and no reference numbers', async () => {
  const { Figure } = await import('./ExecutiveReportContent');
  const marked = html(Figure, { value: partial });
  assert.equal(visible(marked), '6');
  assert.match(marked, /aria-label="อย่างน้อย 6 —/);
  assert.match(marked, /role="img"/); assert.match(marked, /title="/);
  assert.doesNotMatch(marked, /<sup|\[\d+\]/);
  assert.equal(visible(html(Figure, { value: cash, moneyValue: true })), '99.00');
  assert.equal(visible(html(Figure, { value: { ...partial, knownValue: undefined, coverage: 'unavailable' } })), '–');
  assert.match(html(Figure, { value: { value: 0, coverage: 'complete', reasonCodes: [] } }), /text-gray-600/);
});

test('one status detail deduplicates reasons; cells and KPI digits never contain sentences', async () => {
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  for (const coverage of ['complete', 'partial', 'unavailable'] as const) {
    const figure = coverage === 'complete' ? { ...cash, value: 9900, coverage, reasonCodes: [] } : { ...cash, coverage, knownValue: coverage === 'partial' ? 9900 : undefined };
    const data = { ...envelope, coverage: { money: figure, usage: { value: 6, coverage: 'complete', reasonCodes: [] } }, revenue: { receiptsSatang: figure, refundsSatang: figure, netReceiptsSatang: figure, taxSatang: figure, feesSatang: figure, disputedInvoiceCount: 0, trend: [], byPurchaseGroup: [{ key: 'PLAN', label: 'แพ็กเกจ', receiptsSatang: figure, refundsSatang: figure, netReceiptsSatang: figure }] } } as unknown as ExecutiveAnalysis;
    const markup = html(AnalysisContent, { data, nav, seller: null });
    const cells = markup.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
    const values = markup.match(/data-executive-value[^>]*>[\s\S]*?<\/div>/g) ?? [];
    assert.equal(values.length, 5);
    for (const cell of [...cells, ...values]) assert.doesNotMatch(visible(cell), /ข้อมูลก่อน|เฉพาะ|อย่างน้อย/);
    assert.doesNotMatch(markup, /<sup|\[\d+\]/);
    if (coverage !== 'complete') {
      const banner = markup.match(/<aside[^>]*executive-status[\s\S]*?<\/aside>/)?.[0] ?? '';
      const reason = coverage === 'partial' ? W.historyBeforeFirstBuild : W.historyBeforeFirstBuildUnavailable;
      assert.equal(visible(markup).split(reason).length - 1, 1);
      assert.ok(banner.includes(reason));
    }
  }
});

test('hoisting requires every non-empty value incomplete for one source, never hides mixed completeness', async () => {
  const logic = await import('./executive-reports.logic');
  const hoist = (logic as any).hoistedSource;
  assert.equal(typeof hoist, 'function');
  assert.equal(hoist([{ ...partial, source: 'usage' }, { ...partial, source: 'usage' }]), 'usage');
  assert.equal(hoist([{ ...partial, source: 'usage' }, { value: 0, coverage: 'complete', source: 'usage' }]), null);
  assert.equal(hoist([{ ...partial, source: 'usage' }, { ...partial, source: 'money' }]), null);
  assert.equal(hoist([]), null);
});

test('shared tables keep column structure fixed with dots, explicit widths, sticky names and compact mobile fields', async () => {
  const design = await import('./ExecutiveReportDesign');
  const Table = (design as any).ExecutiveTable;
  assert.equal(typeof Table, 'function');
  const { Figure } = await import('./ExecutiveReportContent');
  const render = (value: object) => html(Table, { title: W.purchase, columns: [{ label: W.company }, { label: 'ยอดรับสุทธิ (บาท)', width: 120 }], rows: [{ key: 'one', cells: ['ร้าน ก', React.createElement(Figure, { value: value as any, moneyValue: true })] }] });
  const marked = render(cash), complete = render({ ...cash, value: 9900, coverage: 'complete', reasonCodes: [] });
  const headers = (m: string) => m.match(/<th\b[^>]*>/g);
  assert.deepEqual(headers(marked), headers(complete));
  assert.match(marked, /<colgroup\b/); assert.match(marked, /<col[^>]*style="width:\d+px"/); assert.doesNotMatch(marked, /min-width:|max-h-/); assert.match(marked, /md:sticky md:left-0/);
  assert.match(marked, /whitespace-nowrap/); assert.match(marked, /border-gray-100/);
  assert.match(marked, /grid-cols-2/); assert.match(marked, /md:hidden/);
  const zero = html(Table, { title: W.companies, columns: [{ label: W.company }, { label: W.days }], rows: [{ key: "zero", cells: ["ร้าน ก", 0] }] });
  assert.match(zero, /<td[^>]*text-gray-600[^>]*>[\s\S]*?>0<\/td>/);
  assert.match(marked.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '', /role="img"/);
  assert.doesNotMatch(marked.match(/executive-figure[^>]*>[\s\S]*?<\/span>/)?.[0] ?? '', /role="img"/);
});

test('horizontal KPI digits and unit stay clean and reserve identical height/sub-line with or without a dot', async () => {
  const { ExecutiveKpi } = await import('./ExecutiveReportDesign');
  const render = (value: object) => html(ExecutiveKpi, { label: W.net, figure: value as any, moneyValue: true, unit: 'บาท' } as any);
  const marked = render(cash), complete = render({ ...cash, value: 9900, coverage: 'complete', reasonCodes: [] });
  assert.deepEqual(marked.match(/<(?:div|span)\b[^>]*class="[^"]*"[^>]*>/g)?.filter(s => !s.includes('executive-dot')).map(s => s.replace(/ aria-label="[^"]*"/g, '').replace(/ style="[^"]*"/g, '')), complete.match(/<(?:div|span)\b[^>]*class="[^"]*"[^>]*>/g)?.filter(s => !s.includes('executive-dot')).map(s => s.replace(/ aria-label="[^"]*"/g, '').replace(/ style="[^"]*"/g, '')));
  assert.match(marked, /h-26/); assert.match(marked, /size-10/);
  assert.match(marked, /rounded-full/); assert.match(marked, /py-2/); assert.match(marked, /font-semibold/); assert.match(marked, /leading-4/); assert.match(marked, /whitespace-nowrap/);
  assert.match(marked, /เฉพาะที่ยืนยันแล้ว/);
  assert.match(html(ExecutiveKpi, { label: W.paid, value: "0", unit: W.unitCompany }), /data-executive-value[^>]*text-gray-600/);
  assert.doesNotMatch(visible(marked.match(/data-executive-value[\s\S]*?<\/div>/)?.[0] ?? ''), /เฉพาะ|บาท/);
});

test('tabs expose keyboard navigation, URL choices and compatible legacy report views', async () => {
  const { REPORT_VIEWS } = await import('./executive-reports.words');
  assert.deepEqual(REPORT_VIEWS.revenue.map(v => v.value), ['summary', 'trend', 'unmatched', 'top']);
  assert.deepEqual(REPORT_VIEWS.usage.map(v => v.value), ['adoption', 'paid', 'ranking']);
  const logic = await import('./executive-reports.logic');
  const context = { defaultMonth: '2026-10', currentMonth: '2026-10', filters: Object.fromEntries(['industry', 'discovery', 'referringSales'].map(k => [k, [{ value: 'ALL' }]])) } as any;
  assert.equal(logic.reportView('revenue', new URLSearchParams('view=top')), 'top');
  assert.equal(logic.reportView('usage', new URLSearchParams('view=ranking')), 'ranking');
  assert.equal(logic.reportQuery('revenue', new URLSearchParams('view=trend'), context).view, 'summary');
  assert.equal(logic.reportQuery('usage', new URLSearchParams('view=paid'), context).view, 'adoption');
  const design = await import('./ExecutiveReportDesign');
  const Tabs = (design as any).ExecutiveTabs;
  assert.equal(typeof Tabs, 'function');
  const changed: string[] = [];
  const tree = Tabs({ label: W.revenue, tabs: REPORT_VIEWS.revenue, value: 'summary', onChange: (v: string) => changed.push(v) });
  const buttons = React.Children.toArray(tree.props.children) as React.ReactElement<any>[];
  let focused = false;
  buttons[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: { parentElement: { querySelectorAll: () => [{ focus() {} }, { focus() { focused = true; } }] } } });
  assert.deepEqual(changed, ['trend']); assert.ok(focused);
  assert.match(html(Tabs, { label: W.revenue, tabs: REPORT_VIEWS.revenue, value: 'top', onChange() {} }), /role="tablist"/);
  assert.match(source('./ExecutiveReportPage.tsx'), /<ExecutiveTabs/);
});

test('directory columns, closed row expanders and conditional rank/share replace the tall rows', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const row = { id: 'one', displayName: 'ร้าน ก', registeredName: 'บริษัท ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'เติบโต', planState: 'ACTIVE', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'EVER', usageGroup: 'ACTIVE', paidEver: { value: 'YES' }, metrics: { expenseReceiptCountLifetime: 6, expenseReceiptCountInPeriod: 2, activeDays: 1, activeUsers: 1, documents: 1, aiRequests: 1, netReceiptsSatang: 9900 }, lastActivityAt: '2026-10-04' };
  const render = (sortBy: string) => html(CompaniesContent, { data: { ...envelope, items: [{ ...row, rank: 1, cumulativeShare: { value: 100 } }], summary: { netReceiptsSatang: cash }, pagination: { total: 1 }, sort: { sortBy, sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav, selected: [], select() {} });
  const plain = render('joinedAt'), ranked = render('netReceipts');
  const head = plain.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '';
  const labels = ['บริษัท', 'กลุ่มธุรกิจ', 'แพ็กเกจ', 'สถานะ', 'ใบเสร็จสะสม', 'ใบเสร็จเดือน', 'วันใช้งาน', 'ใช้ระบบล่าสุด', 'สุทธิ'];
  let last = -1; for (const label of labels) { const at = head.indexOf(label); assert.ok(at > last, label); last = at; }
  assert.match(plain, /aria-expanded="false"/); assert.doesNotMatch(plain, /<details[^>]* open/);
  assert.doesNotMatch(head, /สะสม %|อันดับ/); assert.match(ranked.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '', /สะสม %/);
  assert.match(source('./ExecutiveReportDesign.tsx'), /stopPropagation/);
  assert.match(plain, /52px|h-12/);
  const withoutShare = (coverage: string, net: number) => html(CompaniesContent, { data: { ...envelope, coverage: { ...envelope.coverage, money: { ...cash, coverage, reasonCodes: coverage === 'complete' ? [] : cash.reasonCodes } }, items: [{ ...row, metrics: { ...row.metrics, netReceiptsSatang: net }, rank: 1, cumulativeShare: null }], summary: { netReceiptsSatang: cash }, pagination: { total: 1 }, sort: { sortBy: 'netReceipts', sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav, selected: [], select() {} });
  const nonPositive = withoutShare('complete', 0);
  assert.match(nonPositive.match(/<tr hidden=""[\s\S]*?<\/tr>/)?.[0] ?? '', /ไม่นับในสัดส่วน/);
  assert.doesNotMatch(withoutShare('partial', 9900), /ไม่นับในสัดส่วน/);

});

test('top revenue loads the existing summary at the same build and refuses to combine different builds', async () => {
  const ts = await import('typescript');
  const file = ts.createSourceFile('api.ts', source('./executive-reports.api.ts'), ts.ScriptTarget.Latest, true);
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getExecutiveReport')!;
  const code = ts.transpileModule(node.getText(file).replace(/^export /, '') + '\nreturn getExecutiveReport;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const changed of [false, true]) {
    const urls: string[] = [];
    const signal = new AbortController().signal;
    const load = new Function('executiveHref', 'authedApiFetch', code)((await import('./executive-reports.logic')).executiveHref, async (url: string, options: { signal: AbortSignal }) => {
      assert.equal(options.signal, signal); urls.push(url);
      return urls.length === 1 ? { build: { id: 'one' }, buildChanged: !changed, spendConcentration: {} } : { build: { id: changed ? 'two' : 'one' }, buildChanged: changed, revenue: { netReceiptsSatang: cash } };
    });
    const request = load('revenue', { section: 'revenue', view: 'top', month: '2026-10' }, signal);
    if (changed) await assert.rejects(request, /executive revenue builds differ/);
    else { const report = await request; assert.deepEqual(report.revenue.netReceiptsSatang, cash); assert.equal(report.buildChanged, true); }
    assert.equal(urls.length, 2);
    assert.match(urls[1], /view=summary/); assert.match(urls[1], /buildId=one/);
  }
});

test('every report panel keeps complete, partial and unavailable reasons out of cells and KPI values', async () => {
  const { OverviewContent, AnalysisContent, CompaniesContent, CompanyContent } = await import('./ExecutiveReportContent');
  for (const coverage of ['complete', 'partial', 'unavailable'] as const) {
    const figure = { value: coverage === 'complete' ? 6 : null, ...(coverage === 'partial' ? { knownValue: 6 } : {}), coverage, reasonCodes: coverage === 'complete' ? [] : ['HISTORY_BEFORE_FIRST_BUILD'] };
    const money = { ...figure, currency: 'THB' };
    const base = { ...envelope, coverage: { usage: figure, money }, population: { ...envelope.population, eligibleCount: figure } };
    const adoption = { population: 6, coverage, reasonCodes: figure.reasonCodes, segments: [{ key: 'EVER', count: 6, share: { value: 100 }, drilldownFilters: {} }] };
    const paid = { groups: [{ key: 'NOT_STARTED', count: 1, drilldownFilters: {} }], paidEver: { count: 1, drilldownFilters: {} }, usageUnassessed: { count: 0 }, paymentUnknown: { count: 0 }, fullyRefunded: { count: 0 } };
    const company = { id: 'one', displayName: 'ร้าน ก', registeredName: 'บริษัท ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'เติบโต', planState: 'ACTIVE', companyStatus: 'ACTIVE', discovery: { key: 'OTHER', label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, creditedSeller: {}, ownerContact: { status: 'NOT_PERMITTED' }, receiptAdoption: 'EVER', usageGroup: 'ACTIVE', paidEver: { value: 'YES' }, metrics: { expenseReceiptCountLifetime: 6, expenseReceiptCountInPeriod: 2, activeDays: 1, activeUsers: 1, documents: 1, aiRequests: 1, netReceiptsSatang: 9900 }, lastActivityAt: '2026-10-04', expenseReceiptCountLifetime: 6 };
    const side = { key: 'one', label: 'ร้าน ก', companies: figure, activeCompanies: figure, netReceiptsSatang: money, expenseReceiptCount: figure, netReceiptsPerCompanySatang: null, expenseReceiptsPerCompany: null, everAddedReceiptShare: null, drilldownFilters: {} };
    const detail = { ...base, company, monthReasonCodes: [], month: { paidEver: company.paidEver, usageGroup: 'ACTIVE', paidInMonth: true, positiveNetInMonth: true, usage: { ...company.metrics, activeDaysLine: 1, activeDaysWeb: 1, activeUsersLine: 1, activeUsersWeb: 1, expenseReceiptsLine: 1, expenseReceiptsWeb: 1 }, money: { receiptsSatang: money, refundsSatang: money, netReceiptsSatang: money, taxSatang: money, feesSatang: money, aiCostSatang: money } } };
    const cases: Array<[string, React.ComponentType<any>, object]> = [
      ['overview', OverviewContent, { data: { ...base, metrics: { companies: { ...figure, drilldownFilters: {} }, activeCompanies: { ...figure, drilldownFilters: {}, breakdown: {} }, companiesWithReceipts: { ...figure, drilldownFilters: {} }, netReceiptsSatang: { ...money, drilldownFilters: {} } }, expenseReceiptAdoption: adoption, paidUsage: paid, spendConcentration: { topShare: null, reasonCodes: [] } }, nav }],
      ...['adoption', 'paid'].map(view => [view, AnalysisContent, { data: { ...base, expenseReceiptAdoption: adoption, paidUsage: paid }, nav: { ...nav, params: new URLSearchParams({ view }) }, seller: null }] as [string, React.ComponentType<any>, object]),
      ['ranking', AnalysisContent, { data: { ...base, usageRanking: { ...figure, metric: 'activeDays', total: 6, drilldownFilters: {}, items: [{ ...company, rank: 1, value: 6 }] } }, nav: { ...nav, params: new URLSearchParams('view=ranking') }, seller: null }],
      ['customers', AnalysisContent, { data: { ...base, view: 'industry', groups: [{ key: 'one', label: 'ร้านค้า', companies: { count: 6, share: { value: 100 } }, paidEverCompanies: 6, companiesWithReceipts: figure, activeCompanies: figure, netReceiptsSatang: money, drilldownFilters: {} }] }, nav, seller: null }],
      ['compare', AnalysisContent, { data: { ...base, comparison: { sideA: side, sideB: { ...side, key: 'two' }, difference: { companies: 0, netReceiptsSatang: 0, netReceiptsPerCompanySatang: null, expenseReceiptCount: 0, expenseReceiptsPerCompany: null, everAddedReceiptShare: null, activeCompanies: 0 } } }, nav, seller: null }],
      ['companies', CompaniesContent, { data: { ...base, items: [company], summary: { netReceiptsSatang: money }, pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } }, nav, selected: [], select() {} }],
      ...['company', 'usage', 'history'].map(tab => [tab, CompanyContent, { data: detail, tab, history: { items: [] }, nav, admin: false, contactReadAt: '' }] as [string, React.ComponentType<any>, object]),
    ];
    for (const [name, component, props] of cases) {
      const markup = html(component, props);
      assert.doesNotMatch(markup, /<sup|\[\d+\]/, `${name}/${coverage}`);
      for (const cell of markup.match(/<td\b[\s\S]*?<\/td>/g) ?? []) assert.doesNotMatch(visible(cell), /ข้อมูลก่อนเริ่ม|ยังไม่มีตัวเลขของช่วง|ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่ม|นับผู้ที่ยืนยัน|อย่างน้อย|เฉพาะรายการ/, `${name}/${coverage}`);
      const tileValues = markup.match(/data-executive-value[^>]*>[\s\S]*?<\/div>/g) ?? [];
      if (['overview', 'paid', 'company', 'usage', 'history'].includes(name)) assert.ok(tileValues.length > 0, name);
      for (const value of tileValues) assert.doesNotMatch(visible(value), /ข้อมูลก่อน|เฉพาะ|อย่างน้อย|บาท/, `${name}/${coverage}`);
      if (coverage !== 'complete') {
        const reason = coverage === 'partial' ? W.historyBeforeFirstBuild : W.historyBeforeFirstBuildUnavailable;
        assert.equal(visible(markup).split(reason).length - 1, 1, `${name}/${coverage}`);
        assert.ok((markup.match(/<aside[^>]*executive-status[\s\S]*?<\/aside>/)?.[0] ?? '').includes(reason), name);
      }
    }
  }
});

test('row clicks open the link; comparison and expander events never navigate and expansion starts closed', async () => {
  const ts = await import('typescript');
  const design = await import('./ExecutiveReportDesign');
  const logic = await import('./executive-reports.logic');
  const file = ts.createSourceFile('design.tsx', source('./ExecutiveReportDesign.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ExecutiveTable')!;
  const code = ts.transpileModule(node.getText(file).replace(/^export /, '') + '\nreturn ExecutiveTable;', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  let expanded: string[] = [], navigations = 0, stopped = 0;
  const deps = { React, Children: React.Children, W, useState: () => [expanded, (next: (old: string[]) => string[]) => expanded = next(expanded)], useId: () => 'table', isValidElement: React.isValidElement, Fragment: React.Fragment, Figure: design.Figure, IncompleteDot: design.IncompleteDot, ColumnMark: React.createContext(null), Link: 'a', hoistedSource: logic.hoistedSource, reasons: () => '', columnAlign: () => '', desktopColumn: () => 'md:table-cell', ChevronDownIcon: () => null };
  const Table = new Function('deps', `const {${Object.keys(deps).join(',')}}=deps; ${code}`)(deps);
  const rows = [{ key: 'one', href: '/system/executive/companies/one', cells: ['ร้าน ก', 6], details: 'ข้อมูลรอง' }];
  const elements = (node: React.ReactNode): React.ReactElement<any>[] => React.Children.toArray(node).flatMap(child => React.isValidElement<any>(child) ? [child, ...elements((child.props as { children?: React.ReactNode }).children)] : []);
  const render = () => elements(Table({ title: W.companies, columns: [{ label: W.company }, { label: W.days }], rows }));
  const row = render().find(element => element.type === 'tr' && element.props.onClick)!;
  row.props.onClick({ target: { closest: () => null }, currentTarget: { querySelector: () => ({ click: () => navigations++ }) } });
  row.props.onClick({ target: { closest: () => ({ tagName: 'INPUT' }) }, currentTarget: { querySelector: () => { throw Error('checkbox navigated'); } } });
  assert.equal(navigations, 1);
  const button = render().find(element => element.type === 'button')!;
  assert.equal(button.props['aria-expanded'], false);
  button.props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 1); assert.deepEqual(expanded, ['one']);
  assert.equal(render().find(element => element.type === 'button')!.props['aria-expanded'], true);
  assert.equal(render().find(element => element.props.id === 'table-one')!.props.hidden, false);
  const card = render().find(element => element.type === 'tbody')!;
  assert.ok(elements(card).some(element => element.props.id === 'table-one'));
  assert.ok(elements(render().find(element => element.type === 'button')!).some(element => element.props.children === W.less));
});

test('complete selected-period data never receives an incomplete heading just because another source is late', async () => {
  const { ReportStatus } = await import('./ExecutiveReportDesign');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const data = { ...envelope, period: { month: '2026-09', isPartialMonth: false }, population: { eligibleCount: { ...complete, value: 6 } }, coverage: { money: complete, usage: complete }, dataThrough: { billing: '2026-10-01', lagging: ['billing'] } };
  const markup = html(ReportStatus, { data });
  assert.doesNotMatch(markup, /ตัวเลขบางส่วนยังไม่ครบ/); assert.doesNotMatch(markup, /role="img"/);
  assert.match(markup, /หมายเหตุข้อมูล/); assert.match(markup, /ข้อมูลเงินถึงวันที่/);
  assert.equal(html(ReportStatus, { data: { ...data, dataThrough: { lagging: [] } } }), '');
  const stale = html(ReportStatus, { data: { ...data, reasonCodes: ['SOURCE_STALE'] } });
  assert.match(stale.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? '', /ข้อมูลยังไม่ได้อัปเดต/);
  assert.equal(visible(stale).split('ข้อมูลยังไม่ได้อัปเดต').length - 1, 1);
  assert.doesNotMatch(stale, /ตัวเลขบางส่วนยังไม่ครบ/);
});

test('paid usage names the two unknown sources truthfully and keeps each sub-reason count once in the status detail', async () => {
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  const markup = html(AnalysisContent, { data: { ...envelope, expenseReceiptAdoption: { population: 0, segments: [], reasonCodes: [] }, paidUsage: { groups: [], paidEver: { count: 0, drilldownFilters: {} }, usageUnassessed: { count: 3, drilldownFilters: {} }, paymentUnknown: { count: 2, drilldownFilters: {}, byReason: { MANUAL_TERM_NO_RECEIPT: 2 } }, fullyRefunded: { count: 0 } } }, nav: { ...nav, params: new URLSearchParams('view=paid') }, seller: null });
  assert.match(markup, /ยังประเมินการใช้งานไม่ได้/); assert.match(markup, /ยังประเมินการชำระไม่ได้/);
  assert.equal(visible(markup).split(W.manualTerm).length - 1, 1);
  assert.match(visible(markup), /ผู้ดูแลตั้งแพ็กเกจให้ ไม่มีหลักฐานรับเงินในระบบ · 2 บริษัท/);
  const tileValues = markup.match(/data-executive-value[^>]*>[\s\S]*?<\/div>/g) ?? [];
  assert.equal(tileValues.length, 3);
  for (const value of tileValues) assert.doesNotMatch(visible(value), /ข้อมูล|ประเมิน|เฉพาะ|อย่างน้อย/);
});

test('keyboard tab focus survives a report reload without stealing focus from an input', async () => {
  const ts = await import('typescript');
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ExecutiveReportPage') as import('typescript').FunctionDeclaration;
  const effect = page.body!.statements.find(n => ts.isExpressionStatement(n) && n.getText(file).startsWith('useEffect(') && n.getText(file).includes('tabFocus.current'));
  assert.ok(effect);
  const callback = (effect as import('typescript').ExpressionStatement).expression as import('typescript').CallExpression;
  const code = ts.transpileModule(`return (${callback.arguments[0].getText(file)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const active of ['body', 'tab', 'input']) {
    let focused = false;
    const tabFocus = { current: 'ranking' as string | null }, body = {};
    const document = { body, activeElement: active === 'body' ? body : { getAttribute: () => active }, getElementById: (id: string) => { assert.equal(id, 'executive-tab-ranking'); return { focus: () => focused = true }; } };
    const run = (loading: boolean) => new Function('tabFocus', 'loading', 'document', code)(tabFocus, loading, document);
    run(true); assert.equal(tabFocus.current, 'ranking'); assert.equal(focused, false);
    run(false); assert.equal(tabFocus.current, null); assert.equal(focused, active !== 'input');
  }
});

test('round B c: hoisted source reasons cover wrapped values and mixed-source columns without repeated mobile label dots', async () => {
  const { ExecutiveTable, Figure } = await import('./ExecutiveReportDesign');
  const figure = (value: object, source = 'money') => React.createElement(Figure, { value: value as any, moneyValue: source !== 'usage', source });
  const rows = [
    { key: 'money', cells: ['เงิน', figure(cash)] },
    { key: 'other-reason', cells: ['คืนเงิน', React.createElement('div', {}, figure({ ...cash, reasonCodes: ['BILLING_SCAN_NOT_COMPLETE'] }))] },
    { key: 'ai', cells: ['ต้นทุน', figure({ ...cash, knownValue: undefined, coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] }, 'aiCost')] },
    { key: 'count', cells: ['บริษัท', figure(partial, 'usage')] },
    { key: 'empty', cells: ['ค่าเฉลี่ย', '–'] },
  ];
  const markup = html(ExecutiveTable, { title: W.revenue, columns: [{ label: W.item }, { label: W.unitInHeader(W.quantity, W.unitBaht) }], rows });
  const head = markup.match(/<thead[\s\S]*?<\/thead>/)![0];
  assert.equal((head.match(/executive-dot/g) ?? []).length, 1);
  assert.doesNotMatch(markup.replace(head, ''), /executive-dot/);
  assert.match(head, /absolute left-full/);
  const mixed = html(ExecutiveTable, { title: W.revenue, columns: [{ label: W.item }, { label: W.unitInHeader(W.quantity, W.unitBaht) }], rows: [rows[0], { key: 'complete', cells: ['ครบ', figure({ ...cash, value: 9900, coverage: 'complete', reasonCodes: [] })] }] });
  assert.doesNotMatch(mixed.match(/<thead[\s\S]*?<\/thead>/)![0], /executive-dot/);
  assert.equal((mixed.match(/executive-dot/g) ?? []).length, 1);
  assert.match(mixed, /absolute left-full top-1\/2 -translate-y-1\/2/);
  const exceptional = html(ExecutiveTable, { title: W.revenue, columns: [{ label: W.item }, { label: W.quantity, source: cash, sourceName: 'money' }], rows: [rows[0], { key: 'exception', cells: ['เฉพาะแถว', figure({ ...cash, reasonCodes: [...cash.reasonCodes, 'UNMATCHED_MONEY'] })] }] });
  assert.equal((exceptional.match(/executive-dot/g) ?? []).length, 2); // one header, one exceptional value
  const headerReason = exceptional.match(/<thead[\s\S]*?<\/thead>/)![0].match(/role="img"[^>]*title="([^"]*)"/)![1];
  assert.equal(headerReason.split(W.historyBeforeFirstBuild).length - 1, 1);
});

test('round B d: longest KPI value sets one scale through link wrappers; units never wrap and arrows own a slot', async () => {
  const { ExecutiveKpi, ExecutiveKpiStrip } = await import('./ExecutiveReportDesign');
  const children = [100000000, 9900, 0].map((n, i) => React.createElement('a', { href: '/', key: i }, React.createElement(ExecutiveKpi, { label: W.net, figure: { ...cash, knownValue: n } as any, moneyValue: true, unit: W.unitBaht, arrow: true })));
  const markup = html(ExecutiveKpiStrip, { children });
  const scales = [...markup.matchAll(/style="(--executive-kpi-digits:[^"]+)"/g)].map(m => m[1]);
  assert.equal(scales.length, 3); assert.equal(new Set(scales).size, 1);
  assert.equal(Number(scales[0].match(/digits:([^;]+)/)![1]), 12 * 0.62); // 1,000,000.00 has 12 characters
  assert.match(markup, /grid-cols-1[^>]*lg:grid-cols-2[^>]*xl:grid-cols-3/);
  assert.match(markup, /flex flex-nowrap items-baseline/);
  assert.match(markup, /grid-cols-\[minmax\(0,1fr\)_1rem\]/);
  assert.doesNotMatch(markup.match(/data-executive-label[^>]*>/)![0], /truncate/);
  assert.match(markup, /color:var\(--color-warning-700\)/);
  assert.doesNotMatch(markup, /absolute right-2|has-\[.executive-dot\]/);
});

test('round B e: open and closed months have distinct banners, unclamped summaries and a two-column definition list', async () => {
  const { ReportStatus } = await import('./ExecutiveReportDesign');
  const open = html(ReportStatus, { data: envelope });
  const closed = html(ReportStatus, { data: { ...envelope, period: { month: '2026-09', isPartialMonth: false } } });
  assert.match(open, /border-gold-300 bg-gold-100\/40/); assert.match(open, /เดือนนี้ยังไม่จบ/);
  assert.match(closed, /border-gray-200 bg-gray-50/); assert.match(closed.match(/<summary[\s\S]*?<\/summary>/)![0], /ข้อมูลก่อนเริ่มทำรายงาน/);
  for (const markup of [open, closed]) {
    assert.doesNotMatch(markup, /line-clamp|truncate/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /<dl[^>]*md:grid-cols-2/);
    assert.equal(visible(markup).split(W.incompleteLegend).length - 1, 1);
    assert.equal(visible(markup).split(W.historyBeforeFirstBuild).length - 1, 1);
  }
  assert.match(source('./ExecutiveReportDesign.tsx'), /onToggle=\{event => setOpen\(event.currentTarget.open\)\}/);
  assert.match(source('./ExecutiveReportDesign.tsx'), /group-open:rotate-180/);
});

test('round B f: all customer group bases use clean figures with the qualification after the unit', async () => {
  const { AnalysisContent, Figure } = await import('./ExecutiveReportContent');
  for (const view of ['industry', 'discovery', 'referringSales']) {
    const markup = html(AnalysisContent, { data: { ...envelope, view, groups: [] }, nav: { ...nav, from: 'customers' }, seller: null });
    assert.match(visible(markup), /จาก 6บริษัท/);
    assert.doesNotMatch(visible(markup), /จาก อย่างน้อย/);
    assert.match(markup, /aria-label="อย่างน้อย 6 บริษัท —/);
  }
  const moneyWithUnit = html(Figure, { value: cash, moneyValue: true, unit: W.unitBaht });
  assert.ok(moneyWithUnit.indexOf('>บาท<') < moneyWithUnit.indexOf('executive-dot'));
});

test('round B screenshots: purchase money has only header dots and incomplete trend uses one title dot', async () => {
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  const revenue = { receiptsSatang: cash, refundsSatang: cash, netReceiptsSatang: cash, taxSatang: cash, feesSatang: cash, disputedInvoiceCount: 0,
    byPurchaseGroup: ['FIRST', 'RENEWAL', 'UPGRADE', 'ADDON', 'UNKNOWN'].map((key, i) => {
      const value = { ...cash, knownValue: i === 3 ? undefined : 9900, coverage: i === 3 ? 'unavailable' : 'partial', reasonCodes: i === 3 ? ['ADDON_NOT_ON_SALE'] : ['BILLING_SCAN_NOT_COMPLETE'] };
      return { key, label: W.purchase, receiptsSatang: value, refundsSatang: value, netReceiptsSatang: value };
    }),
    trend: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map(month => ({ month, netReceiptsSatang: cash })),
  };
  const purchase = html(AnalysisContent, { data: { ...envelope, revenue }, nav, seller: null });
  const head = purchase.match(/<thead[\s\S]*?<\/thead>/)![0];
  assert.equal((head.match(/executive-dot/g) ?? []).length, 3);
  for (const td of purchase.match(/<td\b[\s\S]*?<\/td>/g) ?? []) assert.doesNotMatch(td, /executive-dot/);
  const trend = html(AnalysisContent, { data: { ...envelope, revenue }, nav: { ...nav, params: new URLSearchParams('view=trend') }, seller: null });
  const panel = trend.slice(trend.indexOf('id="executive-panel"'));
  assert.equal((panel.match(/executive-dot/g) ?? []).length, 1);
  assert.doesNotMatch(panel.match(/executive-trend-labels[\s\S]*?<\/div>/)![0], /executive-dot/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { executivePeriodReportWords } from '@watchdog-bms/contracts';

const W = executivePeriodReportWords();
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = (component: React.ComponentType<any>, props: object) => renderToStaticMarkup(React.createElement(component, props));
const partial = { value: null, knownValue: 9900, coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_FIRST_BUILD'], currency: 'THB' };

test('A: executive markup owns its styles without unlayered Mangmee overrides', async () => {
  for (const folder of ['./', '../executive-users/']) for (const file of readdirSync(new URL(folder, import.meta.url)).filter(file => file.endsWith('.tsx'))) {
    assert.doesNotMatch(source(folder + file), /\[&[^\s]*mangmee-|mangmee-stat-|mangmee-icon-frame|<MangmeePage\b/, file);
  }
  const { ExecutiveKpi, ExecutivePage } = await import('./ExecutiveReportDesign') as any;
  const tile = html(ExecutiveKpi, { label: W.net, figure: partial, moneyValue: true, unit: W.unitBaht });
  assert.match(tile, /data-executive-kpi/); assert.match(tile, /data-executive-value/);
  assert.match(tile, /font-size:18px/); assert.match(tile, /rounded-full/);
  for (const figure of [partial, { ...partial, value: 9900, coverage: 'complete' }, { ...partial, knownValue: 1500200 }]) {
    assert.match(html(ExecutiveKpi, { label: W.net, figure, moneyValue: true }), /font-size:18px/);
  }
  assert.match(html(ExecutivePage, { title: W.overview, description: W.descriptions.overview, children: 'body' }), /text-brand-800/);
});

test('A: incomplete words and muted figures meet 4.5:1 from existing tokens', async () => {
  const { ExecutiveKpi, Figure } = await import('./ExecutiveReportDesign');
  const tile = html(ExecutiveKpi, { label: W.net, figure: partial, moneyValue: true });
  assert.match(tile, /color:var\(--color-warning-700\)/); assert.doesNotMatch(tile, /color:var\(--color-gold-500\)|text-gray-400/);
  assert.match(html(Figure, { value: { value: 0, coverage: 'complete', reasonCodes: [] } }), /text-gray-600/);
  const tokens = source('../../../../../packages/design-tokens/generated/web/theme.css');
  const rgb = (token: string) => tokens.match(new RegExp(`--color-${token}: #([0-9a-f]{6})`))![1].match(/../g)!.map(v => parseInt(v, 16) / 255);
  const luminance = (rgb: number[]) => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const token of ['warning-700', 'gray-600']) for (const background of [[1, 1, 1], rgb('gold-100').map(v => v * .4 + .6)]) {
    assert.ok((luminance(background) + .05) / (luminance(rgb(token)) + .05) >= 4.5, token);
  }
});

test('B1: first-visit ranking, top payers and all ranks have one question mark', async () => {
  const { menuHref, executiveHref } = await import('./executive-reports.logic') as any;
  for (const [section, extra] of [['usage', { view: 'ranking' }], ['revenue', { view: 'top' }], ['companies', { sortBy: 'netReceipts', sortDir: 'desc' }], ['companies', { pick: 'packageLabel=a&b c' }]] as const) {
    const href = menuHref(section, new URLSearchParams(), extra);
    assert.equal(href.split('?').length, 2, href);
    assert.equal(new URL(href, 'https://test.invalid').pathname, `/system/executive/${section}`);
    assert.deepEqual(Object.fromEntries(new URL(href, 'https://test.invalid').searchParams), extra);
  }
  assert.equal(executiveHref('/system/executive', {}), '/system/executive');
  for (const file of ['ExecutiveReportContent.tsx', 'ExecutiveReportPage.tsx', 'executive-reports.api.ts']) assert.doesNotMatch(source('./' + file), /\}&(?:view|by|sortBy)|\?\$\{(?:next|current|params)\}/, file);
});

test('B2: tables grow with the page and every sticky header clears the app bar and row controls', async () => {
  const { ExecutiveTable } = await import('./ExecutiveReportDesign');
  const table = html(ExecutiveTable, { title: W.company, columns: [{ label: W.company }], rows: [{ key: 'a', cells: ['ร้าน ก'] }] });
  assert.doesNotMatch(table, /overflow-auto|max-h-|min-width:/);
  assert.match(table, /sticky top-20 z-30/);
});

test('B3: filter sheet explicitly fills the phone and has an anchored desktop width', () => {
  const filters = source('./ExecutiveFilters.tsx');
  assert.match(filters, /left-0 right-0[^"\n]*w-full/);
  assert.match(filters, /md:left-\[/); assert.match(filters, /md:right-auto/); assert.match(filters, /md:w-96/); assert.match(filters, /m-0/);
});

function selectHarness(open: boolean, searchable = false) {
  const file = ts.createSourceFile('select.tsx', source('../../common/components/field/ThemedSelect.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = file.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(file).replace(/^export /, '')).join('\n');
  const effects: Array<() => void> = [], focused: string[] = [];
  const buttons = ['one', 'two'].map(name => ({ focus: () => focused.push(name) }));
  const details = { open, removeAttribute: () => details.open = false }, summary = { focus: () => focused.push('summary') };
  const input = { focus: () => focused.push('search') };
  const refs = [{ current: details }, { current: summary }, { current: null }, { current: { querySelectorAll: () => buttons, querySelector: (query: string) => query.includes('input') ? input : buttons[0] } }];
  let state = 0, ref = 0;
  const deps = { React, Children: React.Children, Fragment: React.Fragment, isValidElement: React.isValidElement, useId: () => 'select', useRef: (v: unknown) => refs[ref++] ?? { current: v }, useState: (v: unknown) => [state++ === 1 ? open : v, () => {}], useEffect: (fn: () => void) => effects.push(fn), useCallback: (fn: unknown) => fn, useCloseOnOutsideClick() {}, PopoverPanel: 'panel', cx: (...args: string[]) => args.join(' '), document: { activeElement: summary }, window: { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame() {} }, HTMLInputElement: class {} };
  const js = ts.transpileModule(functions + '\nreturn ThemedSelect;', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const component = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}`)(deps);
  const tree = component({ searchable, children: React.createElement('option', { value: 'one' }, 'หนึ่ง') });
  const children = React.Children.toArray(tree.props.children) as React.ReactElement<any>[];
  return { trigger: children.find(n => n.type === 'summary')!, panel: children.find(n => n.type === 'panel')!, effects, focused, details };
}

test('B4: select arrows work from the trigger, search focuses after mount, Escape closes only options', () => {
  const closed = selectHarness(false);
  assert.equal(typeof closed.trigger.props.onKeyDown, 'function');
  closed.trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(closed.details.open, true);
  const opened = selectHarness(true);
  opened.trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, target: {} });
  assert.deepEqual(opened.focused, ['one']);
  let prevented = false, stopped = false;
  opened.panel.props.onKeyDown({ key: 'Escape', target: {}, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(opened.details.open, false); assert.ok(prevented && stopped);
  const search = selectHarness(true, true); search.effects.forEach(fn => fn());
  assert.ok(search.focused.includes('search'));
});

test('B5: one read status, retained content, and export busy only while creating a file', () => {
  const page = source('./ExecutiveReportPage.tsx');
  assert.doesNotMatch(page, /loading=\{loading\}[^\n]*W\.export\.action|loading \? W\.loading/);
  assert.match(page, /const visibleData = !periodInvalid && samePeriod && context[^\n]*\? data : null/);
  // The whole report is covered while it is read again; a tab's own read covers only its panel (see the panel test).
  assert.match(page, /const covered = reading && !panelRead;/); assert.match(page, /covered && !!visibleData/); assert.match(page, /inert=\{covered/);
  assert.doesNotMatch(page, /\[queryKey, section, targetCompanyId, attempt, problem, tab/);
  assert.match(page, /\[.*historyPage.*\]/);
});

test('C8/C12/C14: one atomic directory filter, centred time controls, one-page paging hidden and not-found alone', () => {
  const page = source('./ExecutiveReportPage.tsx'), filters = source('./ExecutiveFilters.tsx');
  assert.doesNotMatch(page, /DIRECTORY_FILTERS\.map\(filterControl\)|activeLabels\.map/);
  assert.match(filters, /DIRECTORY_FILTERS/); assert.match(filters, /W.companyFilters/);
  assert.match(page, /directory=\{section === 'companies'\}/);
  assert.match(page, /executive-time-row[^"\n]*items-center/);
  assert.match(page, /pagination.totalPages > 1/);
  assert.match(page, /context && !exportOpen && failed\?\.kind !== 'notFound'/);
});

test('owner 2026-10-05: a row opener exists only where opening shows something, and a purchase type row shows its own tax and fee', async () => {
  const { ExecutiveTable } = await import('./ExecutiveReportDesign');
  const table = (columns: object[]) => html(ExecutiveTable, { title: W.purchase, columns, rows: [{ key: 'a', cells: ['ก', 1, 2] }] });
  // Every column is on screen on every layout: no opener and no opened row.
  assert.doesNotMatch(table([{ label: 'ก' }, { label: 'ข' }, { label: 'ค' }]), /aria-expanded|data-row-details/);
  // A column only the wide table has: the opener, its column and the opened row exist on the narrow table alone.
  const narrow = table([{ label: 'ก' }, { label: 'ข' }, { label: 'ค', hide: 'narrow' }]);
  assert.match(narrow, /<td class="[^"]*hidden md:table-cell @min-\[936px\]:hidden"><button[^>]*aria-expanded="false"/);
  assert.match(narrow, /<tr hidden="" id="[^"]*" class="bg-gray-50 hidden md:table-row @min-\[936px\]:hidden">/);
  assert.match(narrow, /<col class="hidden md:table-column @min-\[936px\]:hidden" style="width:44px"\/>/);
  // A column kept off the phone card: the opener is on the phone alone, and the opened row shows that one column.
  const phone = table([{ label: 'ก' }, { label: 'ข' }, { label: 'ค', mobile: false }]);
  assert.match(phone, /<td class="[^"]*block md:hidden @min-\[936px\]:hidden"><button/);
  assert.deepEqual([...(phone.match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '').matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map(match => match[1]), ['ค']);
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  const money = { value: 9900, coverage: 'complete', reasonCodes: [], currency: 'THB' };
  const row = { receiptsSatang: money, refundsSatang: money, netReceiptsSatang: money, taxSatang: { ...money, value: 648 }, feesSatang: { ...money, value: 361 } };
  const data = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money, usage: money }, population: { eligibleCount: money, unclassifiedCount: 0 }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 },
    revenue: { ...row, disputedInvoiceCount: 0, trend: [], byPurchaseGroup: [{ key: 'RENEWAL', label: 'ต่ออายุ', ...row }] } };
  const purchase = html(AnalysisContent, { data, nav: { params: new URLSearchParams(), from: 'revenue', remember() {} }, seller: null });
  const head = [...(purchase.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th[^>]*title="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(head, ['ประเภทการซื้อ', 'เงินรับ (บาท)', 'คืนเงิน (บาท)', 'ยอดรับสุทธิ (บาท)', 'ภาษีมูลค่าเพิ่ม (บาท)', 'ค่าธรรมเนียม (บาท)']);
  const openedRow = purchase.match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '';
  assert.match(openedRow, /<dt[^>]*>ภาษีมูลค่าเพิ่ม \(บาท\)<\/dt><dd[^>]*>[\s\S]*?6\.48/); assert.match(openedRow, /<dt[^>]*>ค่าธรรมเนียม \(บาท\)<\/dt><dd[^>]*>[\s\S]*?3\.61/);
  // On the wide table all five figures are columns, so nothing is left to open there.
  assert.match(purchase, /<td class="[^"]*block md:table-cell @min-\[936px\]:hidden"><button/);
});

test('owner 2026-10-05: ten companies a page, a pager nobody overlooks, and one line of header controls', async () => {
  const { reportQuery } = await import('./executive-reports.logic');
  const context = { currentMonth: '2026-10', defaultMonth: '2026-10', builtMonths: ['2026-10'], filters: { industry: [], discovery: [], referringSales: [] } } as any;
  assert.equal(reportQuery('companies', new URLSearchParams(), context).pageSize, 10);
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /<Pagination prominent /);
  // The pager sits under the list: a new page is read from its first row, clear of the sticky bar.
  assert.match(page, /id="executive-results" className="[^"]*scroll-mt-32/); assert.match(page, /getElementById\('executive-results'\)\?\.scrollIntoView\(\)/);
  const { Pagination } = await import('../../common/components/data-table/Pagination');
  const pager = html(Pagination, { page: 2, totalPages: 3, onPageChange() {}, prominent: true });
  assert.match(pager, />หน้า 2 จาก 3</);
  // Both ends are bordered buttons a thumb can hit (44 px), with the arrow hidden from the spoken name.
  assert.equal((pager.match(/<button[^>]*border border-gray-300[^>]*min-h-11/g) ?? []).length, 2);
  assert.match(pager, /<span aria-hidden="true">←<\/span>ก่อนหน้า/); assert.match(pager, /ถัดไป<span aria-hidden="true">→<\/span>/);
  assert.match(html(Pagination, { page: 1, totalPages: 3, onPageChange() {}, prominent: true }), /<button[^>]*disabled=""[^>]*>[\s\S]*?ก่อนหน้า/);
  // The plain pager other screens use keeps its look.
  assert.doesNotMatch(html(Pagination, { page: 2, totalPages: 3, onPageChange() {} }), /border-gray-300|aria-hidden/);
  // Search, sort and export share one 44 px line: nothing hangs under the search box, the sort is named and never squeezed into a fixed column.
  const controls = page.match(/const directoryControls = [^\n]*\n[^\n]*\n[^\n]*/)?.[0] ?? '';
  assert.match(controls, /placeholder=\{W\.searchHint\}/); assert.doesNotMatch(controls, /hint=\{|md:w-80"|grid-cols-/);
  assert.match(controls, /<DesignIcons\.search /);
  assert.match(controls, /<SelectField id="executive-sort" label=\{W\.sort\} frameClassName="[^"]*!flex-row[^"]*md:\[&>details\]:flex-none/);
  assert.doesNotMatch(controls, /executive-sort"[^>]*sr-only/);
  assert.match(source('./ExecutiveReportDesign.tsx'), /max-xl:order-last max-xl:basis-full/);
});

test('C11/C13/C16: account controls, genuine export list and unchanged admin menu words', () => {
  const content = source('./ExecutiveReportContent.tsx');
  assert.doesNotMatch(content, /panel = <Card title=\{W.figure\}/);
  const account = source('../executive-users/ExecutiveUserPage.tsx');
  assert.match(account, /min-h-11/); assert.match(account, /border-t/);
  const panel = source('./ExecutiveExportPanel.tsx');
  assert.ok(panel.indexOf('{canExportContacts(') < panel.indexOf('<Button loading='));
  assert.match(panel, /<ul[^>]*list-disc/); assert.match(panel, /executivePeriodExportColumns[^]*\.map\(/);
  const header = source('../../common/components/app-shell/SystemHeader.tsx');
  assert.doesNotMatch(header, /thaiLabel\(section.label\)/);
  assert.match(header, /onReport \? \[\.\.\.reportSections, \.\.\.adminSections\]/);
});

test('C6/C15: ring and swatches share tokens; follow-up rows appear once, in the band', async () => {
  const { OverviewContent } = await import('./ExecutiveReportContent');
  const count = { value: 2, coverage: 'complete', reasonCodes: [], drilldownFilters: {} };
  const base = { period: { month: '2026-09', isPartialMonth: false }, build: { asOf: '2026-10-04' }, coverage: { money: count, usage: count }, dataThrough: { lagging: [] }, reasonCodes: [], population: { eligibleCount: count }, unmatchedMoney: { count: 0 } };
  const data = { ...base, metrics: { companies: count, activeCompanies: { ...count, breakdown: {} }, companiesWithReceipts: count, netReceiptsSatang: { ...count, currency: 'THB' } }, expenseReceiptAdoption: { population: 2, segments: [{ key: 'EVER', count: 1, share: { value: 50 }, drilldownFilters: {} }, { key: 'NEVER', count: 1, share: { value: 50 }, drilldownFilters: {} }] }, asOfFigures: { asOf: '2026-10-04', receiptBuckets: [], packages: [], receipts7: count, receipts30: count, receiptDays30AtLeast2: count, followUp: { neverUsed: { ...count, value: 1 }, churn: { ...count, value: 1 } } }, paidUsage: { groups: [{ key: 'NOT_STARTED', count: 1, drilldownFilters: {} }, { key: 'INACTIVE', count: 1, drilldownFilters: {} }] }, spendConcentration: { topShare: { value: 50 }, reasonCodes: [] } };
  const markup = html(OverviewContent, { data, nav: { params: new URLSearchParams(), from: 'overview', remember() {}, navigate() {} } });
  const swatches = [...markup.matchAll(/<span[^>]*class="h-4 w-4 shrink-0 rounded-sm border[^>]*>/g)].map(([tag]) => tag);
  for (const [i, key] of ['EVER', 'NEVER'].entries()) {
    const ring = markup.match(new RegExp(`<circle[^>]*data-segment="${key}"[^>]*stroke="([^"]+)"`))![1];
    const swatch = swatches[i].match(/background-color:([^;"]+)/)?.[1] ?? `var(--color-${swatches[i].match(/bg-([a-z]+-\d+)/)?.[1]})`;
    assert.equal(swatch, ring, key);
  }
  assert.match(markup, /executive-follow-up-band[^"\n]*flex-col[^"\n]*sm:flex-row/);
  const text = markup.replace(/<[^>]*>/g, '');
  const { EXECUTIVE_SHEET_WORDS } = await import('@watchdog-bms/contracts');
  for (const label of [EXECUTIVE_SHEET_WORDS.invite, EXECUTIVE_SHEET_WORDS.followExisting]) assert.equal(text.split(label).length - 1, 1, label);
});

test('C7: the payment status of a company is said once, in the sheet\'s own line of the opened row', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const { companyFacts } = await import('./executive-company.fixture');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const row = { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'เติบโต', planState: 'ACTIVE', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'NEVER', paidEver: { value: 'NO' }, metrics: { expenseReceiptCountLifetime: 0, expenseReceiptCountInPeriod: 0, activeDays: 0, activeUsers: 0, documents: 0, aiRequests: 0, netReceiptsSatang: 0 }, ...companyFacts(), sheet: { ...companyFacts().sheet, paymentState: { paidEver: 'NO', fullyRefunded: false } } };
  const data = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money: complete, usage: complete }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, population: {}, items: [row], sort: { sortBy: 'joinedAt' }, summary: { netReceiptsSatang: { value: 0, ...complete } }, pagination: { total: 1 } };
  const nav = { params: new URLSearchParams(), from: 'companies' };
  const markup = html(CompaniesContent, { data, nav });
  // The status is not a column of the sheet: the closed row does not say it.
  assert.doesNotMatch(markup.replace(/<tr hidden=""[\s\S]*?<\/tr>/g, ''), /ยังไม่เคยชำระเงิน/);
  const opened = markup.match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '';
  assert.equal(opened.split('ยังไม่เคยชำระเงิน').length - 1, 1);
  assert.match(opened, /<dt[^>]*>สถานะการชำระ<\/dt><dd[^>]*>ยังไม่เคยชำระเงิน<\/dd>/);
  assert.doesNotMatch(opened, /การชำระและใช้งาน/);
  // A status of the chosen period that says more than the payment state is read in the period's own group.
  const active = html(CompaniesContent, { data: { ...data, items: [{ ...row, usageGroup: 'ACTIVE', paidEver: { value: 'YES' }, sheet: { ...row.sheet, paymentState: { paidEver: 'YES', fullyRefunded: false } } }] }, nav });
  assert.match(active, /<dt[^>]*>การชำระและใช้งาน<\/dt>/); assert.match(active, /<dt[^>]*>สถานะการชำระ<\/dt><dd[^>]*>เคยชำระเงิน<\/dd>/);
});

test('round B d: every revenue tile belongs to the shared equal-width strip', () => {
  assert.match(source('./ExecutiveReportContent.tsx'), /<ExecutiveKpiStrip>\{figures.map/);
  assert.match(source('./ExecutiveReportDesign.tsx'), /grid-cols-2/);
});

test('B5: retained data is never rendered after denied access, a missing company or an unavailable month', () => {
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration;
  const declaration = page.body!.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]).find(n => n.name.getText(file) === 'visibleData')!;
  const js = ts.transpileModule(`return ${declaration.initializer!.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const data = { private: true };
  const visible = new Function('context', 'failed', 'data', 'dataKey', 'requestKey', 'periodInvalid', 'samePeriod', js);
  const shown = (...args: unknown[]) => visible(...args, undefined, undefined, false, true);
  for (const kind of ['denied', 'notFound', 'noData']) assert.equal(shown({}, { kind }, data), null, kind);
  assert.equal(shown(null, null, data), null);
  assert.equal(shown({}, { kind: 'error' }, data), data);
  assert.equal(shown({}, null, data), data);
});

test('B5: a history read failure belongs to the history tab and export never previews a different query', () => {
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration;
  const declaration = page.body!.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]).find(n => n.name.getText(file) === 'failed')!;
  const js = ts.transpileModule(`return ${declaration.initializer!.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const failure = { kind: 'error', text: W.readFailed };
  const failed = new Function('shared', 'failure', 'historyFailure', 'tab', js);
  assert.equal(failed({}, null, failure, 'history'), failure);
  for (const tab of ['company', 'usage']) assert.equal(failed({}, null, failure, tab), null);
  assert.equal(failed({ failure }, null, null, 'company'), failure);
  assert.match(source('./ExecutiveReportPage.tsx'), /exportOpen && context && visibleData && dataKey === requestKey && !reading/);
});

test('round A: optional executive field and picker styles preserve ordinary hints, sizes and disabled days', async () => {
  const { TextField } = await import('../../common/components/field/Field');
  const props = { id: 'search', label: W.search, hint: W.searchHint };
  assert.match(html(TextField, props), /id="search-hint"[^>]*text-gray-400/);
  assert.match(html(TextField, { ...props, hintClassName: 'truncate text-gray-600' }), /id="search-hint"[^>]*text-gray-600/);
  const code = source('../../common/components/field/ThemedDate.tsx').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const js = ts.transpileModule(code + '\nreturn ThemedDate;', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const renderPicker = (options: object) => {
    let state = 0;
    const deps = { React, useWorkspaceLocale: () => 'th', useState: (value: any) => [state++ === 0 ? true : typeof value === 'function' ? value() : value, () => {}], useRef: () => ({ current: null }), useEffect() {}, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useCloseOnOutsideClick() {}, cx: (...values: string[]) => values.filter(Boolean).join(' '), PopoverPanel: 'panel' };
    const Picker = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}`)(deps);
    return elements(Picker({ value: '2026-10-04', max: '2026-10-04', ...options }));
  };
  const ordinary = renderPicker({});
  const selected = ordinary.find(e => e.type === 'button' && e.props.children === 4)!;
  const future = ordinary.find(e => e.type === 'button' && e.props.children === 5)!;
  assert.match(selected.props.className, /bg-brand-500/);
  assert.equal(future.props.disabled, true); assert.match(future.props.className, /disabled:opacity-30/);
  assert.doesNotMatch(ordinary.find(e => e.type === 'panel')!.props.className, /\[&_button\]/);
  assert.match(renderPicker({ mode: 'month', value: '2026-10', panelClassName: '[&_button]:min-h-11 [&_button]:min-w-11' }).find(e => e.type === 'panel')!.props.className, /\[&_button\]:min-h-11/);
  assert.match(source('./ExecutivePeriodControl.tsx'), /panelClassName="\[&_button\]:min-h-11/);
});

function elements(node: React.ReactNode): React.ReactElement<any>[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement(child) ? [child, ...elements((child.props as { children?: React.ReactNode }).children)] : []);
}

test('round A: the compact frame places directory controls in the header and has no empty chip row', async () => {
  const { ExecutivePage } = await import('./ExecutiveReportDesign');
  const markup = html(ExecutivePage, { compact: true, eyebrow: W.report, title: W.companies, description: W.descriptions.companies, actions: 'action', controls: 'search/sort', children: 'body' });
  assert.match(markup, /flex-col gap-2/); assert.match(markup, /data-breadcrumb[^>]*sr-only/);
  assert.match(markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '', /search\/sort/);
  assert.doesNotMatch(markup, /sm:text-3xl|pb-3/);
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /<ExecutivePage compact controls=\{directoryControls\}/);
  assert.match(source('./ExecutiveReportDesign.tsx'), /gap-2 pb-1/); // search hint stays clear of the rule
  assert.match(page, /executive-time-row[^"\n]*items-center[^"\n]*py-0/);
  assert.doesNotMatch(page, /activeLabels\.map|<div className="flex flex-wrap gap-2">\{activeLabels/);
  assert.doesNotMatch(source('./ExecutiveReportDesign.tsx').match(/executive-status[^]*?<\/aside>/)?.[0] ?? '', /py-2/);
  const { ExecutiveFilters } = await import('./ExecutiveFilters');
  const filters = html(ExecutiveFilters, { context: { filters: { industry: [], discovery: [], referringSales: [] } }, values: {}, errors: {}, apply() {}, clear() {} });
  assert.doesNotMatch(filters, /data-filter-chips/);
});

test('owner\'s sheet: the nine columns fit a 1280 px screen, a fact the list is ordered by joins them, and contacts exist only with the right', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const { ExecutiveTable } = await import('./ExecutiveReportDesign');
  const { companyFacts } = await import('./executive-company.fixture');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const row = { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'ทดลองใช้ฟรีสำหรับร้านอาหาร', planState: 'TRIAL', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'NEVER', paidEver: { value: 'NO' }, metrics: { expenseReceiptCountLifetime: 6, expenseReceiptCountInPeriod: 3, activeDays: 2, activeUsers: 1, documents: 1, aiRequests: 5, netReceiptsSatang: 9900 }, cumulativeShare: { value: 100 }, ...companyFacts({ ownerContact: { status: 'OK', email: 'owner@example.test', phoneNumber: '081-000 0001' } }) };
  const base = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money: complete, usage: complete }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, population: {}, items: [row], summary: { netReceiptsSatang: { value: 9900, ...complete } }, pagination: { total: 1 } };
  const table = (sortBy: string, item: object = row) => elements((CompaniesContent as any)({ data: { ...base, items: [item], sort: { sortBy, sortDir: 'desc' } }, nav: { params: new URLSearchParams(), from: 'companies' } })).find(e => e.type === ExecutiveTable)!;
  const labels = (sortBy: string, item: object = row) => table(sortBy, item).props.columns.map((c: any) => c.label);
  const NINE = ['บริษัท / ร้าน', 'ประเภทกิจการ', 'แพ็กเกจ', 'ใบเสร็จในระบบ (รายการ)', 'เพิ่มใบเสร็จล่าสุด', 'สิ้นสุดแพ็กเกจ', 'อีเมล', 'เบอร์โทร', 'หมายเหตุ'];
  for (const sortBy of ['joinedAt', 'companyName', 'receiptsLifetime', 'lastReceiptAt', 'planEndsAt']) {
    const { props } = table(sortBy);
    assert.equal(props.sheet, true); assert.deepEqual(labels(sortBy), NINE, sortBy);
    // A 1280 px screen leaves the table 974 px: the nine columns and the opener fit, so nothing scrolls sideways there.
    assert.ok(props.columns.reduce((n: number, c: any) => n + c.width, 44) <= 974, sortBy);
    // No column is dropped at any width or kept off the phone card: a narrower card scrolls instead.
    assert.ok(props.columns.every((c: any) => c.hide === undefined && c.mobile === undefined));
    assert.deepEqual(props.columns.filter((c: any) => c.sort).map((c: any) => c.label), sortBy === 'joinedAt' ? [] : [NINE[['companyName', 'receiptsLifetime', 'lastReceiptAt', 'planEndsAt'].indexOf(sortBy) && ['companyName', 'receiptsLifetime', 'lastReceiptAt', 'planEndsAt'].indexOf(sortBy) + 2]], sortBy);
  }
  // Ordered by a fact outside the nine: that fact is read right after the name and carries the order's arrow.
  for (const [sortBy, label] of [['netReceipts', 'ยอดรับสุทธิ (บาท)'], ['receipts7', 'ใบเสร็จใหม่ 7 วัน'], ['lifetimeNetSatang', 'ชำระสุทธิสะสม (บาท)'], ['daysSinceLastReceipt', 'ห่างจากใบเสร็จล่าสุด (วัน)'], ['aiRequests30', 'คำขอผู้ช่วย 30 วัน'], ['activeDays', W.days], ['lastActivityAt', W.lastActivity]] as const) {
    assert.deepEqual(labels(sortBy), [NINE[0], label, ...NINE.slice(1)], sortBy);
    assert.equal(table(sortBy).props.columns[1].sort, 'descending', sortBy);
  }
  const { EXECUTIVE_SORT_OPTIONS } = await import('@watchdog-bms/contracts');
  for (const { sortBy } of EXECUTIVE_SORT_OPTIONS) for (const status of ['OK', 'NOT_PERMITTED']) {
    const props = table(sortBy, { ...row, ownerContact: { ...row.ownerContact, status } }).props;
    assert.ok(props.columns.reduce((n: number, c: any) => n + c.width, 44) <= 974, `${sortBy} ${status}`);
    assert.equal(props.columns[0].width, 150, sortBy);
    for (const label of ['ใบเสร็จในระบบ (รายการ)', 'เพิ่มใบเสร็จล่าสุด', 'สิ้นสุดแพ็กเกจ', 'เบอร์โทร']) {
      assert.equal(props.columns.find((c: any) => c.label === label)?.width, table('joinedAt', { ...row, ownerContact: { ...row.ownerContact, status } }).props.columns.find((c: any) => c.label === label)?.width);
    }
  }
  // The headers that take two lines break before a whole word, never inside one the browser does not know.
  const rendered = html(ExecutiveTable, table('joinedAt').props);
  for (const [first, second] of [['ใบเสร็จในระบบ ', '(รายการ)'], ['เพิ่มใบเสร็จ', 'ล่าสุด'], ['สิ้นสุด', 'แพ็กเกจ']]) assert.ok(rendered.includes(`<span class="whitespace-nowrap">${first}</span><wbr/><span class="whitespace-nowrap">${second}</span>`), second);
  // With the contact right: two links the reader presses to write or call. The phone link carries digits only.
  const emailLink = rendered.match(/<a href="mailto:owner@example\.test"[^>]*>[\s\S]*?<\/a>/)![0];
  assert.match(emailLink, /title="owner@example\.test"/); assert.match(emailLink, />owner<wbr class="max-md:hidden"\/>@example\.test<\/a>/);
  assert.match(emailLink, /md:whitespace-normal md:\[overflow-wrap:anywhere\]/); assert.doesNotMatch(emailLink, /\s(?:truncate|line-clamp)/);
  assert.match(rendered, /<a href="tel:0810000001"[^>]*>081-000 0001<\/a>/);
  assert.match(rendered, /md:line-clamp-2 md:break-normal md:\[overflow-wrap:break-word\]/);
  // Without it the API returns no contact: the two columns do not exist, and no cell is empty or masked.
  const hidden = { ...row, ownerContact: { status: 'NOT_PERMITTED' } };
  assert.deepEqual(labels('joinedAt', hidden), NINE.filter(label => label !== 'อีเมล' && label !== 'เบอร์โทร'));
  assert.doesNotMatch(html(ExecutiveTable, table('joinedAt', hidden).props), /mailto:|tel:|owner@example|0810000001|081-000/);
  assert.ok(table('joinedAt', hidden).props.columns.reduce((n: number, c: any) => n + c.width, 44) <= 974);
  // No owner account (or several): said once, in the first of the two cells; the other reads "–".
  const noOwner = html(ExecutiveTable, table('joinedAt', { ...row, ownerContact: { status: 'NO_CURRENT_OWNER' } }).props).replace(/<tr hidden=""[\s\S]*?<\/tr>/g, '');
  assert.equal(noOwner.split('ไม่พบบัญชีเจ้าของปัจจุบัน').length - 1, 2); // the visible words and their title
  assert.doesNotMatch(noOwner, /mailto:|tel:/);
  // The phone card: label left, value right, on its own line for every column; the card grid of other tables is not used.
  assert.match(rendered, /<tr[^>]*class="relative grid grid-cols-1 /); assert.doesNotMatch(rendered, /--mobile-columns/);
  assert.match(rendered, /<td class="[^"]*flex items-baseline justify-between gap-3[^"]*"><span class="shrink-0 text-xs leading-5 text-gray-600 md:hidden">ประเภทกิจการ<\/span>/);
  // The card scrolls sideways under the width of its columns, with the first column held in place above the rest.
  assert.match(rendered, /<div class="relative min-w-0 @container md:overflow-x-auto"><table style="--sheet-width:974px" class="[^"]*md:min-w-\[var\(--sheet-width\)\]/);
  assert.match(rendered, /<th[^>]*title="บริษัท \/ ร้าน"[^>]*class="whitespace-normal leading-4 md:sticky md:left-0 md:z-20 /);
  assert.doesNotMatch(rendered.match(/<thead[\s\S]*?<\/thead>/)![0], /sticky top-20/);
});

test('sweep 2026-10-05: the chosen tab and period stay in view, tables stay inside their cards, and the small things a reader trips on', async () => {
  const design = source('./ExecutiveReportDesign.tsx'), content = source('./ExecutiveReportContent.tsx'), page = source('./ExecutiveReportPage.tsx');
  const { EXECUTIVE_PERIOD_WORDS: P } = await import('@watchdog-bms/contracts');
  // A row that scrolls sideways (the tabs, the period presets on a phone) keeps its chosen item in view, moving sideways only.
  assert.match(design, /if \(a\.left < b\.left\) row\.scrollLeft -= b\.left - a\.left; else if \(a\.right > b\.right\) row\.scrollLeft \+= a\.right - b\.right;/);
  assert.match(design, /<ChosenInView id=\{`executive-tab-\$\{value\}`\} \/>/); assert.doesNotMatch(design, /scrollIntoView/);
  assert.match(source('./ExecutivePeriodControl.tsx'), /useEffect\(\(\) => keepInView\(row\.current\?\.querySelector\('\[aria-pressed="true"\]'\)\), \[period\?\.appliedPreset\]\);/);
  // The header's amber dot ends inside its own column (the next header covered a third of it), and the sort arrow stands off its label.
  assert.match(design, /<span className="absolute left-full top-1\/2 -ml-0\.5 -translate-y-1\/2">/); assert.match(design, /<span aria-hidden="true" className="ml-1">\{column\.sort === 'ascending' \? '↑' : '↓'\}<\/span>/);
  // A card narrower than 936 px keeps the customer tables inside it: two counts move to the opened row; the seller table is narrower.
  assert.match(content, /\{ label: W\.filterLabels\.paidEver, width: 110, hide: 'narrow' \}, \{ label: W\.active, width: 110, hide: 'narrow' \}/);
  assert.match(content, /\{ label: W\.creditedSeller, width: 260 \}/);
  // One wrap rule for the whole report; a company page without the filter button still has air in its period row.
  assert.match(page, /executive-report mx-auto max-w-7xl px-3 py-2 text-base text-pretty sm:px-6/); assert.match(page, /\$\{section === 'detail' \? 'py-2' : 'py-0'/);
  // "Current, data through" is said once above the company's cards; definitions are the small grey line they are elsewhere.
  assert.equal(content.split('{W.current} · {W.through(reportDateTime(data.build.asOf))}').length - 1, 1);
  assert.match(content, /<p className="text-xs text-gray-600">\{W\.documentDefinition\} · \{W\.usersDefinition\} · \{W\.aiDefinition\}<\/p>/);
  // No value reads "–": an event without a package, a date the report does not have.
  assert.match(content, /event\.planLabel \|\| '–'/); assert.doesNotMatch(content, /'—'/);
  const { reportDate, reportDateTime } = await import('./executive-reports.logic');
  assert.equal(reportDate(null), '–'); assert.equal(reportDateTime(undefined), '–'); assert.equal(reportDate('2026-10-02T17:00:00.000Z'), '3 ต.ค. 2569');
  // Sentences true in every case: a range of months is not "the month"; fewer than ten ranked companies are not "the first ten"; a year does not run into the next word.
  assert.equal(P.spendTitle('ช่วงเดือน ก.ย. 2569'), 'รายรับช่วงเดือน ก.ย. 2569 มาจากลูกค้ากลุ่มใด');
  assert.equal(W.rankBase(22, 'ใบเสร็จในช่วงนี้'), 'ไม่เกิน 10 อันดับแรกจาก 22 บริษัท ตามใบเสร็จในช่วงนี้ · บริษัทที่เป็น 0 ไม่อยู่ในอันดับ');
  assert.equal(W.followUpDescriptions.top, 'ดูสัดส่วนรายรับของกลุ่มที่จ่ายสูงสุดในช่วงเดือนที่เลือก'); assert.match(W.followUpDescriptions.INACTIVE, /ในช่วงเดือนที่เลือก$/);
  // The company page: its contact is a link to write or call, as in the list; a company without one says so in words.
  const { CompanyContent } = await import('./ExecutiveReportContent'); const { companyFacts } = await import('./executive-company.fixture');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const detail = (ownerContact: object) => html(CompanyContent, { data: { build: { id: 'b', asOf: '2026-10-04T00:00:00Z' }, period: { month: '2026-09' }, dataThrough: { lagging: [] }, appliedFilters: { global: {}, directory: {} }, coverage: { usage: complete, money: complete }, monthReasonCodes: [], month: null,
    company: { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, companyStatus: 'ACTIVE', planState: 'PAID_ACTIVE', planLabel: 'เติบโต', discovery: { key: 'LINE', label: 'ไลน์' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีเซลล์ผู้แนะนำ' }, creditedSeller: {}, ...companyFacts(), ownerContact } },
    tab: 'company', history: null, admin: false, nav: { params: new URLSearchParams(), from: 'detail', remember() {}, navigate() {} }, contactReadAt: '2026-10-04T00:00:00Z' });
  const linked = detail({ status: 'OK', email: 'owner@example.test', phoneNumber: '081-000 0001' });
  assert.match(linked, /<a href="mailto:owner@example\.test"[^>]*>owner@example\.test<\/a>/); assert.match(linked, /<a href="tel:0810000001"[^>]*>081-000 0001<\/a>/);
  assert.doesNotMatch(detail({ status: 'OK', email: null, phoneNumber: null }), /mailto:|tel:/); assert.doesNotMatch(detail({ status: 'NOT_PERMITTED' }), /mailto:|tel:|owner@example/);
  // The quick filter that opens the package filter keeps its word whole when the row is full.
  assert.match(content, /<Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick=\{\(\) => \{ const panel = document\.getElementById\('executive-filter-packageLabel'\)/);
});

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

test('B1: first-visit ranking, top payers, all ranks and company comparison have one question mark', async () => {
  const { menuHref, executiveHref } = await import('./executive-reports.logic') as any;
  for (const [section, extra] of [['usage', { view: 'ranking' }], ['revenue', { view: 'top' }], ['companies', { sortBy: 'netReceipts', sortDir: 'desc' }], ['compare', { by: 'company', a: 'a&b', b: 'c d' }]] as const) {
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
  assert.match(page, /reading && !!visibleData/); assert.match(page, /inert=\{reading/);
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

test('C10/C11/C13/C16: concise comparison, account controls, genuine export list and unchanged admin menu words', () => {
  const page = source('./ExecutiveReportPage.tsx'), content = source('./ExecutiveReportContent.tsx');
  assert.doesNotMatch(page, /<option value="">\{W.choose\}/); assert.doesNotMatch(content, /panel = <Card title=\{W.figure\}/);
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

test('C7: the directory does not repeat the main payment status in the expander', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const row = { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'เติบโต', planState: 'ACTIVE', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'NEVER', paidEver: { value: 'NO' }, metrics: { expenseReceiptCountLifetime: 0, expenseReceiptCountInPeriod: 0, activeDays: 0, activeUsers: 0, documents: 0, aiRequests: 0, netReceiptsSatang: 0 } };
  const data = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money: complete, usage: complete }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, population: {}, items: [row], sort: { sortBy: 'joinedAt' }, summary: { netReceiptsSatang: { value: 0, ...complete } }, pagination: { total: 1 } };
  const markup = html(CompaniesContent, { data, nav: { params: new URLSearchParams(), from: 'companies' }, selected: [], select() {} });
  const main = markup.replace(/<tr hidden=""[\s\S]*?<\/tr>/g, '');
  assert.equal(main.replace(/<[^>]*>/g, '').split('ยังไม่เคยชำระเงิน').length - 1, 1);
  assert.doesNotMatch(markup.match(/executive-usage-summary[\s\S]*?<\/td>/)?.[0] ?? '', /ยังไม่เคยชำระเงิน/);
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

test('C10: comparison titles and side headers preserve free company names from the API', async () => {
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  const count = { value: 1, coverage: 'complete', reasonCodes: [] };
  const side = { key: 'one', label: 'AI', companies: count, activeCompanies: count, netReceiptsSatang: { ...count, currency: 'THB' }, expenseReceiptCount: count, netReceiptsPerCompanySatang: null, expenseReceiptsPerCompany: null, everAddedReceiptShare: null };
  const data = { period: { month: '2026-09' }, build: {}, coverage: { money: count, usage: count }, population: { eligibleCount: count }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, comparison: { dimension: 'company', sideA: side, sideB: { ...side, key: 'two', label: 'IG' }, difference: { companies: 0, activeCompanies: 0, netReceiptsSatang: 0, expenseReceiptCount: 0, netReceiptsPerCompanySatang: null, expenseReceiptsPerCompany: null, everAddedReceiptShare: null } } };
  const markup = html(AnalysisContent, { data, nav: { params: new URLSearchParams(), from: 'compare', remember() {} }, seller: null });
  assert.match(markup, /เปรียบเทียบ · AI · IG/); assert.match(markup, /ฝั่งแรก · AI/); assert.match(markup, /ฝั่งที่สอง · IG/);
  assert.doesNotMatch(markup, /ปัญญาประดิษฐ์|อินสตาแกรม/);
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
  assert.match(source('./ExecutiveReportPage.tsx'), /hintClassName="truncate text-gray-600"/);
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

test('round A: directory column budgets fit both widths, keep the real sort and expose three or four mobile figures', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const { ExecutiveTable } = await import('./ExecutiveReportDesign');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const row = { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'ทดลองใช้ฟรีสำหรับร้านอาหาร', planState: 'TRIAL', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'NEVER', paidEver: { value: 'NO' }, metrics: { expenseReceiptCountLifetime: 6, expenseReceiptCountInPeriod: 3, activeDays: 2, activeUsers: 1, documents: 1, aiRequests: 5, netReceiptsSatang: 9900 }, cumulativeShare: { value: 100 } };
  const base = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money: complete, usage: complete }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, population: {}, items: [row], summary: { netReceiptsSatang: { value: 9900, ...complete } }, pagination: { total: 1 } };
  for (const sortBy of ['joinedAt', 'companyName', 'netReceipts', 'expenseReceiptCount', 'activeDays', 'aiRequests', 'lastActivityAt']) {
    const tree = (CompaniesContent as any)({ data: { ...base, sort: { sortBy, sortDir: 'desc' } }, nav: { params: new URLSearchParams(), from: 'companies' }, selected: [], select() {} });
    const table = elements(tree).find(e => e.type === ExecutiveTable)!;
    const columns = table.props.columns;
    assert.equal(table.props.compactMobile, true);
    assert.equal(columns.find((c: any) => c.control).label, W.shortCompare);
    for (const [wide, budget] of [[false, 694], [true, 936]] as const) assert.ok(columns.filter((c: any) => c.hide !== 'always' && (wide || c.hide !== 'narrow')).reduce((n: number, c: any) => n + c.width, 44) <= budget, `${sortBy}/${wide}`);
    const mobile = columns.filter((c: any) => c.mobile);
    assert.equal(mobile.length, sortBy === 'aiRequests' ? 4 : 3);
    const sorted = columns.filter((c: any) => c.sort);
    assert.equal(sorted.length, 1, sortBy);
    assert.equal(sorted[0].hide, undefined, sortBy);
    if (sortBy === 'joinedAt') { assert.equal(sorted[0].label, W.shortJoined); assert.equal(columns.find((c: any) => c.label === W.company).sort, undefined); }
    if (sortBy === 'aiRequests') assert.ok(mobile.some((c: any) => c.label === W.ai));
    const rendered = html(ExecutiveTable, table.props);
    assert.match(rendered, /grid-cols-\[repeat\(var\(--mobile-columns\),minmax\(0,1fr\)\)\]/);
    assert.match(rendered, /title="ทดลองใช้ฟรีสำหรับร้านอาหาร/);
    assert.match(rendered, /min-w-0 truncate/);
    const packageBadge = rendered.match(/<span class="mangmee-badge[^>]*><span[^>]*title="ทดลองใช้ฟรีสำหรับร้านอาหาร"[^>]*>[\s\S]*?<\/span><\/span>/)![0];
    assert.equal(packageBadge.replace(/<[^>]*>/g, ''), row.planLabel);
    assert.match(rendered, /text-xs leading-4 text-gray-600/);
    assert.match(rendered, /@min-\[936px\]:table-cell/);
    assert.doesNotMatch(rendered, /⌃|⌄|max-h-|overflow-auto/);
  }
  assert.match(source('./ExecutiveReportContent.tsx'), /label === W.shortRefunds \? \{ hide: 'narrow'/);
});

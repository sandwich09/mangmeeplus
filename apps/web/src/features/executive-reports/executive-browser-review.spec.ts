import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { EXECUTIVE_WORDS as W } from '@watchdog-bms/contracts';

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
  assert.match(tile, /text-\[26px\]/); assert.match(tile, /rounded-full/);
  for (const figure of [partial, { ...partial, value: 9900, coverage: 'complete' }, { ...partial, knownValue: 1500200 }]) {
    assert.doesNotMatch(html(ExecutiveKpi, { label: W.net, figure, moneyValue: true }), /style="[^"]*(?:font-size|color):/);
  }
  assert.match(html(ExecutivePage, { title: W.overview, description: W.descriptions.overview, children: 'body' }), /text-brand-800/);
});

test('A: incomplete words and muted figures meet 4.5:1 from existing tokens', async () => {
  const { ExecutiveKpi, Figure } = await import('./ExecutiveReportDesign');
  const tile = html(ExecutiveKpi, { label: W.net, figure: partial, moneyValue: true });
  assert.match(tile, /text-warning-700/); assert.doesNotMatch(tile, /color:var\(--color-gold-500\)|text-gray-400/);
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

test('B2: sticky headers stay in their isolated, bounded scroll context below the app bar', async () => {
  const { ExecutiveTable } = await import('./ExecutiveReportDesign');
  const table = html(ExecutiveTable, { title: W.company, columns: [{ label: W.company }], rows: [{ key: 'a', cells: ['ร้าน ก'] }] });
  assert.match(table, /^<div class="[^"]*relative[^"]*isolate[^"]*overflow-auto[^"]*md:max-h-\[560px\]/);
  assert.match(table, /sticky top-0/);
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
  assert.match(page, /const visibleData = context[^\n]*\? data : null/);
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
  assert.match(panel, /<ul[^>]*list-disc/); assert.match(panel, /executiveExportColumns[^]*\.map\(/);
  const header = source('../../common/components/app-shell/SystemHeader.tsx');
  assert.doesNotMatch(header, /thaiLabel\(section.label\)/);
  assert.match(header, /onReport \? \[\.\.\.reportSections, \.\.\.adminSections\]/);
});

test('C6/C15: ring and swatches share tokens; follow-up rows appear once, in the band', async () => {
  const { OverviewContent } = await import('./ExecutiveReportContent');
  const count = { value: 2, coverage: 'complete', reasonCodes: [], drilldownFilters: {} };
  const base = { period: { month: '2026-09', isPartialMonth: false }, build: { asOf: '2026-10-04' }, coverage: { money: count, usage: count }, dataThrough: { lagging: [] }, reasonCodes: [], population: { eligibleCount: count }, unmatchedMoney: { count: 0 } };
  const data = { ...base, metrics: { companies: count, activeCompanies: { ...count, breakdown: {} }, companiesWithReceipts: count, netReceiptsSatang: { ...count, currency: 'THB' } }, expenseReceiptAdoption: { population: 2, segments: [{ key: 'EVER', count: 1, share: { value: 50 }, drilldownFilters: {} }, { key: 'NEVER', count: 1, share: { value: 50 }, drilldownFilters: {} }] }, paidUsage: { groups: [{ key: 'NOT_STARTED', count: 1, drilldownFilters: {} }, { key: 'INACTIVE', count: 1, drilldownFilters: {} }] }, spendConcentration: { topShare: { value: 50 }, reasonCodes: [] } };
  const markup = html(OverviewContent, { data, nav: { params: new URLSearchParams(), from: 'overview', remember() {}, navigate() {} } });
  const swatches = [...markup.matchAll(/<span[^>]*class="h-4 w-4 shrink-0 rounded-sm border[^>]*>/g)].map(([tag]) => tag);
  for (const [i, key] of ['EVER', 'NEVER'].entries()) {
    const ring = markup.match(new RegExp(`<circle[^>]*data-segment="${key}"[^>]*stroke="([^"]+)"`))![1];
    const swatch = swatches[i].match(/background-color:([^;"]+)/)?.[1] ?? `var(--color-${swatches[i].match(/bg-([a-z]+-\d+)/)?.[1]})`;
    assert.equal(swatch, ring, key);
  }
  assert.match(markup, /executive-follow-up-band[^"\n]*flex-col[^"\n]*sm:flex-row/);
  const text = markup.replace(/<[^>]*>/g, '');
  const { EXECUTIVE_REPORT_LABELS: labels } = await import('@watchdog-bms/contracts');
  for (const key of ['NOT_STARTED', 'INACTIVE']) assert.equal(text.split(labels.usageGroup[key]).length - 1, 1, key);
});

test('C7: the directory does not repeat the main payment status in the expander', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const complete = { coverage: 'complete', reasonCodes: [] };
  const row = { id: 'a', displayName: 'ร้าน ก', provinceLabel: 'กรุงเทพ', joinedAt: '2026-07-02', industryGroup: { label: 'ร้านค้า' }, planLabel: 'เติบโต', planState: 'ACTIVE', companyStatus: 'ACTIVE', discovery: { label: 'อื่น ๆ' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีผู้แนะนำ' }, receiptAdoption: 'NEVER', paidEver: { value: 'NO' }, metrics: { expenseReceiptCountLifetime: 0, expenseReceiptCountInPeriod: 0, activeDays: 0, activeUsers: 0, documents: 0, aiRequests: 0, netReceiptsSatang: 0 } };
  const data = { period: { month: '2026-09', isPartialMonth: false }, build: {}, coverage: { money: complete, usage: complete }, dataThrough: { lagging: [] }, reasonCodes: [], unmatchedMoney: { count: 0 }, population: {}, items: [row], sort: { sortBy: 'joinedAt' }, summary: { netReceiptsSatang: { value: 0, ...complete } }, pagination: { total: 1 } };
  const markup = html(CompaniesContent, { data, nav: { params: new URLSearchParams(), from: 'companies' }, selected: [], select() {} });
  assert.equal(markup.replace(/<[^>]*>/g, '').split('ยังไม่เคยชำระเงิน').length - 1, 1);
});

test('C9: revenue has a mobile snap strip', () => {
  assert.match(source('./ExecutiveReportContent.tsx'), /snap-x[^"\n]*xl:grid[^"\n]*xl:grid-cols-5/);
});

test('B5: retained data is never rendered after denied access, a missing company or an unavailable month', () => {
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration;
  const declaration = page.body!.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]).find(n => n.name.getText(file) === 'visibleData')!;
  const js = ts.transpileModule(`return ${declaration.initializer!.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const data = { private: true };
  const visible = new Function('context', 'failed', 'data', 'dataKey', 'requestKey', js);
  for (const kind of ['denied', 'notFound', 'noData']) assert.equal(visible({}, { kind }, data), null, kind);
  assert.equal(visible(null, null, data), null);
  assert.equal(visible({}, { kind: 'error' }, data), data);
  assert.equal(visible({}, null, data), data);
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

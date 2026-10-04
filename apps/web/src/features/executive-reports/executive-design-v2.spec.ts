import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { EXECUTIVE_WORDS as W, EXECUTIVE_REPORT_LABELS, type ExecutiveOverview, type ExecutiveCompanies } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const count = (value: number) => ({ value, coverage: 'complete', reasonCodes: [] });
const nav = { params: new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK'), from: 'overview', remember: () => {}, navigate: () => {} };
const envelope = { period: { month: '2026-09' }, dataThrough: { lagging: [] }, coverage: { usage: { coverage: 'complete', reasonCodes: [] }, money: { coverage: 'complete', reasonCodes: [] } } };
const overview = (groups: unknown[], segments = [
  { key: 'EVER', count: 1, share: { value: 33.3 }, drilldownFilters: { receiptAdoption: 'EVER' } },
  { key: 'NEVER', count: 1, share: { value: 33.3 }, drilldownFilters: { receiptAdoption: 'NEVER' } },
  { key: 'UNKNOWN', count: 1, share: { value: 33.3 }, drilldownFilters: { receiptAdoption: 'UNKNOWN' } },
]) => ({ ...envelope, metrics: { companies: { ...count(3), unclassifiedCount: 2, drilldownFilters: {} }, activeCompanies: { ...count(1), breakdown: { notPaid: 1 }, drilldownFilters: {} }, companiesWithReceipts: { ...count(1), drilldownFilters: {} }, netReceiptsSatang: { ...count(100), drilldownFilters: {} } }, expenseReceiptAdoption: { population: 3, segments, reasonCodes: [], roundingNote: true }, paidUsage: { groups }, spendConcentration: { topShare: null, reasonCodes: [] } }) as unknown as ExecutiveOverview;
const render = (component: React.ComponentType<any>, props: object) => renderToStaticMarkup(React.createElement(component, props));

test('v2 donut uses exact count arcs, centre total, returned legend shares and a hatched unknown', async () => {
  const { OverviewContent } = await import('./ExecutiveReportContent');
  const html = render(OverviewContent, { data: overview([]), nav });
  const arcs = [...html.matchAll(/<circle[^>]*data-segment="([^"]+)"[^>]*>/g)].map(([tag, key]) => ({ key, size: Number(tag.match(/stroke-dasharray="([\d.]+)/)?.[1]), offset: Number(tag.match(/stroke-dashoffset="(-?[\d.]+)/)?.[1]) }));
  assert.deepEqual(arcs.map(x => x.key), ['EVER', 'NEVER', 'UNKNOWN']);
  assert.ok(Math.abs(arcs.reduce((sum, arc) => sum + arc.size, 0) - 100) < 0.00001);
  assert.ok(Math.abs(arcs[1].offset + 100 / 3) < 0.00001);
  assert.match(html, /executive-donut-total[^>]*>3</);
  assert.match(html, /--color-gold-500/); assert.match(html, /<pattern/); assert.match(html, /stroke="url\(#/);
  assert.equal((html.match(/33\.3%/g) ?? []).length, 6); // aria-label and visible legend
  for (const key of ['EVER', 'NEVER', 'UNKNOWN']) assert.ok(html.includes(`receiptAdoption%3D${key}`));
  assert.ok(html.includes(W.rounding));
  const empty = render(OverviewContent, { data: { ...overview([]), expenseReceiptAdoption: { population: 0, segments: [], reasonCodes: [] } }, nav });
  assert.doesNotMatch(empty, /data-segment|NaN|Infinity/);
});

test('v2 follow-up band includes only known positive groups and exact drill links', async () => {
  const { OverviewContent } = await import('./ExecutiveReportContent');
  const group = (key: string, n: unknown) => ({ key, count: n, drilldownFilters: { usageGroup: key } });
  for (const groups of [[], [group('NOT_STARTED', 0), group('INACTIVE', 0)], [group('NOT_STARTED', null), group('INACTIVE', undefined)]]) assert.doesNotMatch(render(OverviewContent, { data: overview(groups), nav }), /executive-follow-up-band/);
  const html = render(OverviewContent, { data: overview([group('NOT_STARTED', 4), group('INACTIVE', 0), group('ACTIVE', 20)]), nav });
  const band = html.match(/<aside[^>]*class="[^"]*executive-follow-up-band[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.match(band, /ควรติดตาม:/); assert.match(band, /usageGroup%3DNOT_STARTED/);
  assert.doesNotMatch(band, /usageGroup%3DINACTIVE|usageGroup%3DACTIVE/); assert.match(band, /4/);
});

test('v2 KPI icons and arrows stay compact while long payment context lives outside the tiles', async () => {
  const { OverviewContent } = await import('./ExecutiveReportContent');
  const html = render(OverviewContent, { data: overview([]), nav });
  assert.equal((html.match(/data-executive-icon/g) ?? []).length, 4);
  assert.match(html, /executive-kpi-link/); assert.match(html, /aria-hidden="true"[^>]*>→/);
  assert.match(html, /data-executive-sub[\s\S]*ยังไม่ได้จัดประเภท 2 บริษัท[\s\S]*?<\/section>/);
  const tiles = html.match(/<section[^>]*data-executive-kpi[\s\S]*?<\/section>/g) ?? [];
  assert.equal(tiles.length, 4);
  for (const tile of tiles) assert.doesNotMatch(tile, /ยังไม่เคยชำระแต่ใช้งานอยู่/);
  assert.match(html, /ยังไม่เคยชำระแต่ใช้งานอยู่ 1 บริษัท/);
});

test('v2 directory exposes available fields as sticky columns and the same two-column mobile row', async () => {
  const { CompaniesContent } = await import('./ExecutiveReportContent');
  const row = { id: 'row', displayName: 'ร้าน ก', registeredName: null, provinceLabel: 'เชียงใหม่', joinedAt: '2026-09-01T00:00:00Z', industryGroup: { label: 'ร้านอาหาร' }, companyStatus: 'ACTIVE', planState: 'ACTIVE', planLabel: 'ร้านเติบโต', discovery: { label: 'Facebook' }, signupRail: 'line-oa', referrer: { label: 'ไม่ระบุ' }, paidEver: { value: 'YES' }, usageGroup: 'ACTIVE', receiptAdoption: 'EVER', metrics: { expenseReceiptCountLifetime: 27, expenseReceiptCountInPeriod: 7, activeDays: 3, activeUsers: 2, documents: 4, aiRequests: 5, netReceiptsSatang: 10000 }, lastActivityAt: null };
  const data = { ...envelope, summary: { netReceiptsSatang: count(10000) }, items: [row], pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies;
  const html = render(CompaniesContent, { data, nav, selected: [], select: () => {} });
  const head = html.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '';
  for (const word of [W.company, W.group, W.lifetimeReceipts, W.receiptCount, W.days, W.lastActivity, W.shortPlan, W.shortNet]) assert.ok(head.includes(word), word);
  assert.match(head, /sticky/); assert.match(html, /grid-cols-2/); assert.match(html, /md:table-row/);
  assert.match(html, /after:absolute after:inset-0/); assert.match(html, />27</);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.doesNotMatch(head, /7 วัน|30 วัน|ประเภทกิจการ|เพิ่มใบเสร็จล่าสุด/);
});

function componentFunction(path: string, name: string, deps: Record<string, unknown>) {
  const file = ts.createSourceFile('component.tsx', source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  const js = ts.transpileModule(node.getText(file).replace(/^export /, '') + `\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}`)({ React, ...deps });
}
function elements(tree: React.ReactNode): Array<React.ReactElement<any>> {
  return React.Children.toArray(tree).flatMap(node => React.isValidElement(node) ? [node, ...elements((node.props as any).children)] : []);
}

test('v2 filter drafts apply atomically, dismiss without mutation, clear and remove a single chip', async () => {
  const { GLOBAL_FILTERS, DIRECTORY_FILTERS, FILTER_URL, changedParams } = await import('./executive-reports.logic');
  const { Button } = await import('../../common/components/button');
  const { SelectField } = await import('../../common/components/field/Field');
  const { thaiLabel } = await import('./executive-reports.words');
  const state: any[] = [], refs: any[] = []; let cursor = 0, refCursor = 0, hidden = 0;
  const calls: any[] = [];
  const context = { filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) };
  const values = { industry: 'ALL', discovery: 'FACEBOOK', referringSales: 'ALL' };
  const Filters = componentFunction('./ExecutiveFilters.tsx', 'ExecutiveFilters', { React, W, Button, SelectField, thaiLabel, window: { innerHeight: 844 }, GLOBAL_FILTERS, DIRECTORY_FILTERS, FILTER_URL, DesignIcons: { filter: () => null }, useBodyScrollLock: () => {}, useId: () => 'filters', useEffect: () => {}, useRef: () => refs[refCursor++] ?? (refs[refCursor - 1] = { current: { hidePopover: () => hidden++, getBoundingClientRect: () => ({ left: 20, bottom: 60 }) } }), useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => state[index] = typeof next === 'function' ? next(state[index]) : next]; } });
  const tree = () => { cursor = 0; refCursor = 0; return elements(Filters({ context, values, errors: {}, apply: (changes: unknown) => calls.push(changes), clear: () => calls.push('clear') })); };
  const trigger = () => tree().find(x => x.type === Button && x.props.popoverTarget)!;
  assert.ok(trigger()); assert.equal(trigger().props['aria-expanded'], false);
  trigger().props.onClick();
  tree().find(x => x.props.popover === 'auto')!.props.onToggle({ newState: 'open' });
  assert.equal(trigger().props['aria-expanded'], true);
  tree().find(x => x.props.popover === 'auto')!.props.onToggle({ newState: 'closed', target: {}, currentTarget: {} });
  assert.equal(trigger().props['aria-expanded'], true);
  const select = tree().find(x => x.type === SelectField && x.props.id.includes('industry'))!;
  select.props.onChange({ target: { value: 'FOOD_ACCOMMODATION' } });
  assert.deepEqual(calls, []);
  tree().find(x => x.type === 'form')!.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls.pop(), { filter_industry: 'FOOD_ACCOMMODATION', filter_discovery: 'FACEBOOK', filter_sales: 'ALL' });
  assert.equal(hidden, 1);
  trigger().props.onClick();
  assert.equal(tree().find(x => x.type === SelectField && x.props.id.includes('industry'))!.props.value, 'ALL');
  tree().find(x => x.type === Button && x.props.children === W.close)!.props.onClick();
  assert.deepEqual(calls, []);
  const chip = tree().find(x => x.type === Button && x.props['aria-label'] === W.removeFilter(`${W.filterLabels.discovery} · เฟซบุ๊ก`))!;
  chip.props.onClick(); assert.deepEqual(calls.pop(), { filter_discovery: 'ALL' });
  const next = changedParams(new URLSearchParams('month=2026-09&page=4&filter_discovery=FACEBOOK&pick=discovery%3DFACEBOOK%26industry%3DFOOD_ACCOMMODATION'), { filter_discovery: 'ALL' });
  assert.equal(next.get('page'), '1'); assert.equal(next.get('month'), '2026-09');
  assert.equal(new URLSearchParams(next.get('pick')!).get('industry'), 'FOOD_ACCOMMODATION'); assert.equal(new URLSearchParams(next.get('pick')!).has('discovery'), false);
  tree().find(x => x.type === Button && x.props.children === W.clear)!.props.onClick(); assert.equal(calls.pop(), 'clear');
});

test('v2 filter panel is a labelled responsive native popover in the time row, and views use tabs', () => {
  const page = source('./ExecutiveReportPage.tsx'), filters = source('./ExecutiveFilters.tsx');
  const timeRow = page.slice(page.indexOf('executive-time-row'), page.indexOf("{section === 'companies' && <>"));
  assert.match(timeRow, /<ExecutiveFilters/); assert.doesNotMatch(timeRow, /<summary/);
  assert.match(filters, /popover="auto"/); assert.match(filters, /role="dialog"/); assert.match(filters, /aria-labelledby/);
  assert.match(filters, /bottom-0/); assert.match(filters, /md:top-/); assert.match(filters, /min-h-11/); assert.match(filters, /safe-area-inset-bottom/);
  assert.match(page, /<ExecutiveTabs/); assert.doesNotMatch(page, /reportView\(section, params\) === view.value \? 'primary'/);
});

test('v2 nested select/date portals stay inside a native popover and ordinary fields still portal to body', () => {
  const popover = {}, body = {};
  const Panel = componentFunction('../../common/components/field/PopoverPanel.tsx', 'PopoverPanel', { React, document: { body }, UNPLACED: {}, useEffect: () => {}, useState: () => [null, () => {}], createPortal: (_: unknown, target: unknown) => target });
  for (const host of [popover, null]) assert.equal(Panel({ open: true, anchorRef: { current: { closest: () => host } }, panelRef: {}, height: 240, className: '', children: null }), host ?? body);
  assert.equal(Panel({ open: false, anchorRef: {}, panelRef: {}, height: 240, className: '', children: null }), null);
});


test('v2 directory filter controls and chips use effective drill filters rather than unrelated saved globals', async () => {
  const { reportQuery, GLOBAL_FILTERS, DIRECTORY_FILTERS, FILTER_URL, drillLabels, drillFilters } = await import('./executive-reports.logic');
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration;
  const declarations = page.body!.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const context = { currentMonth: '2026-10', defaultMonth: '2026-09', filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) };
  const params = new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK&pick=industry%3DFOOD_ACCOMMODATION');
  const code = ['effectiveQuery', 'filterValues', 'pickLabels'].map(name => {
    const declaration = declarations.find(node => node.name.getText(file) === name); assert.ok(declaration, name);
    return `const ${declaration.getText(file)};`;
  }).join('\n');
  const js = ts.transpileModule(code + '\nreturn { filterValues, pickLabels };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluate = () => new Function('DIRECTORY_FILTERS', 'FILTER_URL', 'reportQuery', 'GLOBAL_FILTERS', 'drillLabels', 'picked', 'section', 'params', 'context', 'search', js)(DIRECTORY_FILTERS, FILTER_URL, reportQuery, GLOBAL_FILTERS, drillLabels, drillFilters(params), 'companies', params, context, '');
  assert.deepEqual(evaluate().filterValues, { industry: 'FOOD_ACCOMMODATION', discovery: 'ALL', referringSales: 'ALL', ...Object.fromEntries(DIRECTORY_FILTERS.map(key => [key, 'ALL'])) });
  assert.deepEqual(evaluate().pickLabels, []); // Global picks already have removable chips beside the filter button.
  params.set('pick', 'industry=FOOD_ACCOMMODATION&usageGroup=NOT_STARTED');
  assert.deepEqual(evaluate().pickLabels, []);
  assert.equal(evaluate().filterValues.usageGroup, 'NOT_STARTED');
});

test('v2 shared design reaches every report/account view and export, without a new palette', () => {
  const design = source('./ExecutiveReportDesign.tsx');
  assert.match(design, /rounded-full/); assert.match(design, /text-\[26px\]/); assert.match(design, /from-gold-500/);
  for (const label of [W.applyFilters, W.close, W.followUpBand, W.removeFilter('ประเภทธุรกิจ · ไม่ระบุ')]) assert.doesNotMatch(label, /[A-Za-z_]/);
  assert.match(design, /bg-brand-600/); assert.doesNotMatch(design, /#[0-9a-f]{3,8}\b|blue-/i);
  for (const path of ['./ExecutiveReportPage.tsx', '../executive-users/ExecutiveUsersPage.tsx', '../executive-users/ExecutiveUserPage.tsx']) assert.match(source(path), /EXECUTIVE_PAGE_CLASS/);
  assert.match(source('./ExecutiveExportPanel.tsx'), /<ExecutiveSectionCard title=\{W.export.action\} actions=/);
  assert.match(source('./ExecutiveReportContent.tsx'), /ExecutiveSectionCard as Card/);
});


test('directory filters share the atomic draft and removable chips, including embedded drill choices', async () => {
  const logic = await import('./executive-reports.logic');
  const { Button } = await import('../../common/components/button');
  const { SelectField } = await import('../../common/components/field/Field');
  const { thaiLabel } = await import('./executive-reports.words');
  let stateIndex = 0; const state: any[] = [], applied: any[] = [];
  const context = { currentMonth: '2026-10', defaultMonth: '2026-09', filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) };
  const values = { ...Object.fromEntries([...logic.GLOBAL_FILTERS, ...logic.DIRECTORY_FILTERS].map(key => [key, 'ALL'])), usageGroup: 'NOT_STARTED' };
  const Filters = componentFunction('./ExecutiveFilters.tsx', 'ExecutiveFilters', { React, W, Button, SelectField, thaiLabel, ...logic, DesignIcons: { filter: () => null }, useBodyScrollLock() {}, useEffect() {}, useId: () => 'filters', useRef: () => ({ current: { hidePopover() {} } }), useState: (initial: any) => { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (next: any) => state[i] = typeof next === 'function' ? next(state[i]) : next]; } });
  const render = () => { stateIndex = 0; return elements(Filters({ context, directory: true, values, errors: {}, apply: (next: object) => applied.push(next), clear() {} })); };
  assert.equal(render().filter(n => n.type === SelectField).length, 10);
  render().find(n => n.type === SelectField && n.props.id.endsWith('usageGroup'))!.props.onChange({ target: { value: 'ACTIVE' } });
  assert.equal(applied.length, 0);
  render().find(n => n.type === 'form')!.props.onSubmit({ preventDefault() {} });
  assert.equal(applied[0].filter_usage, 'ACTIVE'); assert.equal(Object.keys(applied[0]).length, 10);
  render().find(n => n.type === Button && n.props['aria-label'] === W.removeFilter(`${W.filterLabels.usageGroup} · ${EXECUTIVE_REPORT_LABELS.usageGroup.NOT_STARTED}`))!.props.onClick();
  const params = logic.changedParams(new URLSearchParams('month=2026-09&pick=usageGroup%3DNOT_STARTED'), applied[1]);
  assert.equal(logic.reportQuery('companies', params, context as any).usageGroup, undefined);
});

test('KPI-only conditions share the time-row filter chips and can be removed individually', async () => {
  const { ExecutiveFilters } = await import('./ExecutiveFilters');
  const context = { filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) };
  const markup = render(ExecutiveFilters, { context, values: { industry: 'ALL', discovery: 'ALL', referringSales: 'ALL' }, errors: {}, apply() {}, clear() {}, extra: [{ key: 'paidInPeriod', label: 'มีเงินรับในเดือนที่เลือก', remove() {} }] });
  assert.ok(markup.includes(`aria-label="${W.removeFilter('มีเงินรับในเดือนที่เลือก')}"`));
  assert.match(markup, /tabular-nums[^>]*>1<\/span>/);
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /extra=\{pickLabels\.map/);
  assert.doesNotMatch(page, /pickLabels\.map\([^\n]*MangmeeBadge/);
  const file = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(file) === 'extra' && node.initializer && ts.isJsxExpression(node.initializer)) expression = node.initializer.expression; ts.forEachChild(node, visit); };
  visit(file); assert.ok(expression);
  const code = ts.transpileModule(`return ${expression.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let changes: Record<string, string> = {};
  const picked = { paidInPeriod: 'true', positiveNetInPeriod: 'true' };
  const chips = new Function('picked', 'pickLabels', 'update', code)(picked, [{ key: 'paidInPeriod', label: 'มีเงินรับในเดือนที่เลือก' }], (next: Record<string, string>) => changes = next);
  chips[0].remove();
  const remaining = new URLSearchParams(changes.pick);
  assert.equal(remaining.has('paidInPeriod'), false); assert.equal(remaining.get('positiveNetInPeriod'), 'true');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { executivePeriodReportWords, EXECUTIVE_REPORT_LABELS, EXECUTIVE_SHEET_WORDS as S, type ExecutiveAnalysis, type ExecutiveCompanies, type ExecutiveCompanyDetail, type ExecutiveOverview } from '@watchdog-bms/contracts';

const W = executivePeriodReportWords();
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const content = () => import('./ExecutiveReportContent');
const count = (value: number) => ({ value, coverage: 'complete', reasonCodes: [] });
const cash = (value: number) => ({ ...count(value), currency: 'THB' });
const envelope = {
  build: { id: 'build', asOf: '2026-10-04T00:00:00Z' }, period: { month: '2026-09' },
  dataThrough: { billing: '2026-10-01T00:00:00Z', lagging: ['billing'] },
  appliedFilters: { global: {}, directory: {} },
  population: { eligibleCount: count(12), unclassifiedCount: 0, excludedTestInternalNetReceiptsSatang: 0, unclassifiedNetReceiptsSatang: 0 },
  coverage: { usage: { coverage: 'complete', reasonCodes: [] }, money: { coverage: 'complete', reasonCodes: [] } },
  unmatchedMoney: { count: 0, receiptsSatang: 0, refundsSatang: 0 },
};
const nav = { params: new URLSearchParams('month=2026-09'), from: 'overview', remember: () => {}, navigate: () => {} };
const adoption = { population: 12, coverage: 'complete', reasonCodes: [], segments: [{ key: 'EVER', count: 12, share: { value: 100 }, drilldownFilters: { receiptAdoption: 'EVER' } }] };
const groups = [{ key: 'NOT_STARTED', count: 4, drilldownFilters: { usageGroup: 'NOT_STARTED' } }, { key: 'INACTIVE', count: 2, drilldownFilters: { usageGroup: 'INACTIVE' } }];
const overview = { ...envelope, metrics: { companies: { ...count(12), drilldownFilters: {} }, activeCompanies: { ...count(3), drilldownFilters: {}, breakdown: {} }, companiesWithReceipts: { ...count(6), drilldownFilters: {} }, netReceiptsSatang: { ...cash(100), drilldownFilters: {} } }, expenseReceiptAdoption: adoption, asOfFigures: { asOf: '2026-10-04', receiptBuckets: [], packages: [], receipts7: { ...count(0), drilldownFilters: {} }, receipts30: { ...count(0), drilldownFilters: {} }, receiptDays30AtLeast2: { ...count(0), drilldownFilters: {} }, followUp: { neverUsed: { ...count(4), drilldownFilters: { neverUsed: 'true' } }, churn: { ...count(2), drilldownFilters: { churned: 'true' } } } }, paidUsage: { groups }, spendConcentration: { topShare: { value: 80 }, reasonCodes: [] } } as unknown as ExecutiveOverview;
const htmlOf = (component: React.ComponentType<any>, props: object) => renderToStaticMarkup(React.createElement(component, props));

test('report shell keeps shared KPI sizes, descriptions, time row and loading skeletons', () => {
  const page = source('./ExecutiveReportPage.tsx');
  assert.doesNotMatch(page, /mangmee-stat-value\]:!text-lg|mangmee-stat-card\]:!p-3/);
  assert.match(page, /description=\{W.descriptions\[section\]\}/);
  assert.match(page, /<Button[^>]*onClick=\{[^}]*companies/);
  assert.match(page, /executive-time-row/);
  assert.match(page, /ReportSkeleton/);
});

test('overview uses equal KPI widths and places the top-payers row inside adoption with a header button', async () => {
  const { OverviewContent } = await content();
  const html = htmlOf(OverviewContent, { data: overview, nav });
  assert.match(html, /data-executive-kpi-strip[^>]*min-\[1200px\]:grid-cols-4/);
  assert.doesNotMatch(html, /\[&amp;_.mangmee-stat-card\]:h-full/); assert.match(html, /h-26/);
  assert.doesNotMatch(html, /<h2[^>]*>[^<]*เรื่องที่ควรดูต่อ/);
  assert.match(html, /<button[^>]*>ดูอันดับการใช้<\/button>/);
  assert.ok(html.replace(/<[^>]*>/g, '').includes('4 บริษัท'));
  assert.match(html, /บริษัท [\s\S]*?→/);
  for (const label of [S.invite, S.followExisting]) assert.equal(html.replace(/<[^>]*>/g, '').split(label).length - 1, 1);
});

test('drill links are focusable tiles and paid usage has large counts and company actions', async () => {
  const { AnalysisContent, ReportLink } = await content();
  const link = htmlOf(ReportLink, { href: '/system/executive/companies', children: 'บริษัท' });
  assert.match(link, /rounded-lg/); assert.match(link, /min-h-11/); assert.match(link, /focus-visible/); assert.doesNotMatch(link, / underline/);
  const paidUsage = { groups, paidEver: { count: 6, drilldownFilters: {} }, usageUnassessed: { count: 0 }, paymentUnknown: { count: 0 }, fullyRefunded: { count: 0 } };
  const html = htmlOf(AnalysisContent, { data: { ...envelope, expenseReceiptAdoption: adoption, paidUsage } as unknown as ExecutiveAnalysis, nav: { ...nav, params: new URLSearchParams('view=paid') }, seller: null });
  assert.match(html, /grid-cols-2/); assert.match(html, /font-size:26px/); assert.match(html, /executive-kpi-link/);
  assert.match(html, /usageGroup%3DNOT_STARTED/);
});

const company = {
  id: 'company', displayName: 'ร้านอาหาร ก', registeredName: 'บริษัท ก', provinceLabel: 'เชียงใหม่', industryGroup: { label: 'ร้านอาหาร' },
  joinedAt: '2026-09-01T00:00:00Z', companyStatus: 'ACTIVE', planState: 'PAID_ACTIVE', planLabel: 'ร้านเติบโต',
  discovery: { key: 'OTHER', label: 'อื่น ๆ', otherText: 'งานร้านค้า' }, signupRail: 'line-oa', referrer: { label: 'ไม่มีเซลล์ผู้แนะนำ' },
  paidEver: { value: 'YES' }, usageGroup: 'ACTIVE', receiptAdoption: 'EVER', fullyRefunded: false,
  metrics: { expenseReceiptCountLifetime: 27, expenseReceiptCountInPeriod: 7, activeDays: 3, activeUsers: 2, documents: 4, aiRequests: 5, netReceiptsSatang: 10000 }, lastActivityAt: '2026-09-30T00:00:00Z',
};
test('directory uses explicit receipt columns, labelled secondary summaries and no comparison checkbox', async () => {
  const { CompaniesContent } = await content();
  const html = htmlOf(CompaniesContent, { data: { ...envelope, summary: { netReceiptsSatang: cash(10000) }, items: [company], pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav });
  assert.match(html, /executive-company-row/); assert.match(html, /executive-usage-summary/);
  assert.ok((html.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '').includes(W.lifetimeReceipts)); assert.doesNotMatch(html.match(/<section aria-label="บริษัทลูกค้า"[\s\S]*?<\/section>/)?.[0] ?? '', /<dl/);
  assert.doesNotMatch(html, /type="checkbox"|เปรียบเทียบ/);
  assert.equal((html.match(/>เคยชำระเงิน</g) ?? []).length, 1);
  for (const label of [W.tableReceipts, W.days, W.users, W.documents, W.ai, W.lastActivity, W.shortPlan, W.tableNet]) assert.ok(html.includes(label), label);
  assert.match(html, /งานร้านค้า/); assert.match(html, /สมัครทางไลน์/);
});

test('revenue trend has a fixed height, bar labels, signed baseline, gaps and one explanation per reason', async () => {
  const { AnalysisContent } = await content();
  const partial = { ...cash(10000), value: null, knownValue: 10000, coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] };
  const trend = [{ month: '2026-07', netReceiptsSatang: partial }, { month: '2026-08', netReceiptsSatang: { ...partial, knownValue: -10000 } }, { month: '2026-09', netReceiptsSatang: { ...partial, knownValue: undefined, coverage: 'unavailable' } }];
  const html = htmlOf(AnalysisContent, { data: { ...envelope, revenue: { receiptsSatang: cash(0), refundsSatang: cash(0), netReceiptsSatang: cash(0), taxSatang: cash(0), feesSatang: cash(0), byPurchaseGroup: [], disputedInvoiceCount: 0, trend } } as unknown as ExecutiveAnalysis, nav: { ...nav, params: new URLSearchParams('view=trend') }, seller: null });
  assert.match(html, /height="200"/); assert.match(html, /preserveAspectRatio="none"/);
  assert.match(html, /executive-trend-labels/); assert.match(html, /ก.ค. 69/); assert.match(html, /-100.00/);
  const chart = html.match(/<svg[^>]*aria-label="แนวโน้ม[\s\S]*?<\/svg>/)?.[0] ?? '';
  assert.equal((chart.match(/<rect /g) ?? []).length, 4); // pattern tile, two amounts, one unavailable placeholder
  assert.match(html, /data-unavailable="true"/);
  assert.match(html, /data-executive-icon/);
  assert.match(html, /y="100"/); assert.match(html, /--color-red-600/);
  assert.equal(html.replace(/<[^>]*>/g, '').split(W.historyBeforeCollectionPartial).length - 1, 1);
  assert.equal(html.replace(/<[^>]*>/g, '').split(W.historyBeforeCollection).length - 1, 1);
});

test('money lag appears once in the status detail and not in any KPI', async () => {
  const { OverviewContent } = await content();
  const lag = htmlOf(OverviewContent, { data: overview, nav });
  assert.equal((lag.match(/data-executive-value/g) ?? []).length, 4);
  assert.match(lag, /executive-status[\s\S]*ข้อมูลเงินถึง/); assert.doesNotMatch(lag.match(/data-executive-value[\s\S]*?<\/div>/)?.[0] ?? "", /ข้อมูลเงินถึง/);
  assert.equal(lag.split('ข้อมูลเงินถึง').length - 1, 1);
  const current = htmlOf(OverviewContent, { data: { ...overview, dataThrough: { ...overview.dataThrough, lagging: [] } }, nav });
  assert.doesNotMatch(current, /ข้อมูลเงินถึง/);
  const absent = htmlOf(OverviewContent, { data: { ...overview, dataThrough: { ...overview.dataThrough, billing: null } }, nav });
  assert.doesNotMatch(absent, /ข้อมูลเงินถึง/);
  assert.doesNotMatch(source('./ExecutiveReportPage.tsx'), /dataThrough.lagging.map/);
});

test('ranking rows use the shared table, aligned values and sort state in its header', async () => {
  const { AnalysisContent } = await content();
  const usageRanking = { metric: 'expenseReceiptCount', total: 12, coverage: 'complete', reasonCodes: [], drilldownFilters: {}, items: [{ ...company, rank: 1, value: 7 }] };
  const html = htmlOf(AnalysisContent, { data: { ...envelope, usageRanking } as unknown as ExecutiveAnalysis, nav, seller: null, rankingControl: React.createElement('select', { 'aria-label': W.ranking }) });
  assert.match(html, /<header[^>]*>.*<select/s);
  assert.match(html, /<table/); assert.match(html, /aria-sort="descending"/); assert.match(html, /after:absolute after:inset-0/);
  assert.match(html, /border-gray-100/);
  assert.match(html, /<button[^>]*>ดูอันดับทั้งหมด<\/button>/);
});

test('report buttons remember the origin and navigate to the same month and exact drill filters', async () => {
  const { OverviewContent, AnalysisContent } = await content();
  const { Button } = await import('../../common/components/button');
  const events: string[] = [];
  const navigation = { ...nav, from: 'usage', remember: () => events.push('remember'), navigate: (href: string) => events.push(href) };
  function click(tree: React.ReactNode, label: string) {
    for (const node of React.Children.toArray(tree)) {
      if (!React.isValidElement(node)) continue;
      const props = node.props as { children?: React.ReactNode; actions?: React.ReactNode; onClick?: () => void };
      if (node.type === Button && props.children === label) { props.onClick!(); return true; }
      if (click(props.children, label) || click(props.actions, label)) return true;
    }
    return false;
  }
  assert.ok(click(OverviewContent({ data: overview, nav: navigation }), W.seeRanking));
  assert.deepEqual(events, ['remember', '/system/executive/usage?month=2026-09&view=ranking']);
  events.length = 0;
  const usageRanking = { metric: 'activeDays', total: 12, coverage: 'complete', reasonCodes: [], items: [], drilldownFilters: { sortBy: 'activeDays', sortDir: 'desc', industry: 'FOOD' } };
  assert.ok(click(AnalysisContent({ data: { ...envelope, usageRanking } as unknown as ExecutiveAnalysis, nav: navigation, seller: null }), W.allRanks));
  assert.equal(events[0], 'remember');
  const url = new URL(events[1]!, 'https://test.invalid');
  assert.equal(url.pathname, '/system/executive/companies'); assert.equal(url.searchParams.get('month'), '2026-09');
  const picked = new URLSearchParams(url.searchParams.get('pick')!);
  assert.equal(picked.get('sortBy'), 'activeDays'); assert.equal(picked.get('sortDir'), 'desc');
  assert.equal(picked.get('industry'), 'FOOD'); assert.equal(url.searchParams.get('origin'), 'usage');
});

test('customer rows have a full-row drill link, bar track and screen-reader-only caption', async () => {
  const { AnalysisContent } = await content();
  const row = { key: 'OTHER', label: 'อื่น ๆ', companies: { count: 12, share: { value: 100 } }, companiesWithReceipts: count(6), paidEverCompanies: 8, activeCompanies: count(3), netReceiptsSatang: cash(10000), drilldownFilters: { discovery: 'OTHER' } };
  const html = htmlOf(AnalysisContent, { data: { ...envelope, view: 'discovery', groups: [row] } as unknown as ExecutiveAnalysis, nav, seller: null });
  assert.match(html, /<caption class="sr-only"/);
  assert.match(html, /after:absolute after:inset-0/); assert.match(html, /bg-gray-100/); assert.match(html, /tabular-nums/);
});

test('top payers show the exact cohorts and shares in compact shared tables with tie links', async () => {
  const { AnalysisContent } = await content();
  const ratio = (value: number) => ({ value });
  const spendConcentration = { population: 12, positiveCompanyCount: 6, nonPositiveCount: 6, positiveNetTotalSatang: 10000, signedNetTotalSatang: 9000, negativeNetSatang: -1000, receiptsWithoutPositiveNet: 0, topTargetCount: 3, topCount: 3, topShare: ratio(70), restCount: 9, restShare: ratio(30), prefix80Count: 4, prefix80Share: ratio(80), topCompanyShare: ratio(25), restCompanyShare: ratio(75), prefix80CompanyShare: ratio(33.3), coverage: 'complete', reasonCodes: [], boundaryTie: { count: 1, netSatang: 100 }, drilldownFilters: { TOP20: {}, REST: {}, TO80: {}, BOUNDARY_TIE: {} } };
  const html = htmlOf(AnalysisContent, { data: { ...envelope, spendConcentration } as unknown as ExecutiveAnalysis, nav, seller: null });
  assert.match(html, /<table/); assert.match(html, /70.0%/); assert.match(html, /80.0%/);
  assert.match(html, /<a[^>]*>[\s\S]*บริษัทที่รวมยอดรับถึง 80%/);
  assert.match(html, /text-xs[^>]*>มีอีก/);
});

test('company information and origin sit beside each other without stray header lines', async () => {
  const { CompanyContent } = await content();
  const data = { ...envelope, company: { ...company, ownerContact: { status: 'NOT_PERMITTED' }, creditedSeller: {}, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail;
  const html = htmlOf(CompanyContent, { data, tab: 'company', history: null, admin: false, nav, contactReadAt: '' });
  assert.match(html, /lg:grid-cols-2/);
  assert.doesNotMatch(html, /^<p>บริษัท ก ·/);
  assert.match(html, /ที่มาของบริษัท/); assert.match(html, /ข้อมูลบริษัท/);
});

test('export wraps in a card, folds columns and displays sheet tiles', async () => {
  const { ExecutiveExportPanel } = await import('./ExecutiveExportPanel');
  const filters = Object.fromEntries(Object.keys(EXECUTIVE_REPORT_LABELS).map(key => [key, [{ value: 'ALL', label: 'ทั้งหมด' }]]));
  const html = htmlOf(ExecutiveExportPanel, { section: 'overview', params: nav.params, context: { filters, currentMonth: '2026-10', defaultMonth: '2026-10', capabilities: { readReport: { allowed: true }, export: { allowed: true } } }, data: overview, search: '', close: () => {}, reload: () => {}, deny: () => {} });
  assert.match(html, /mangmee-card/); assert.match(html, /<details><summary[^>]*>หัวคอลัมน์รายบริษัท/); assert.match(html, /executive-export-sheets/);
  assert.match(html, /executive-status[\s\S]*ข้อมูลเงินถึงวันที่/);
});

test('admin table lives in the shared section card with its filter form', () => {
  const file = ts.createSourceFile('users.tsx', source('../executive-users/ExecutiveUsersPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let inside = false;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'ExecutiveSectionCard' && node.getText(file).includes('<form') && node.getText(file).includes('<ExecutiveTable')) inside = true;
    ts.forEachChild(node, visit);
  }
  visit(file); assert.ok(inside, 'filter form and table share the same card');
  const links: ts.JsxOpeningElement[] = [];
  function visitLinks(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'Link') links.push(node);
    ts.forEachChild(node, visitLinks);
  }
  visitLinks(file);
  for (const link of links) {
    const classes = link.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'className')?.getText(file) ?? '';
    assert.match(classes, /hover:/); assert.match(classes, /focus-visible:/);
  }
});

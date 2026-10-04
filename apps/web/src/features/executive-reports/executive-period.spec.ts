import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXECUTIVE_PERIOD_PRESETS, EXECUTIVE_PERIOD_WORDS as P, EXECUTIVE_REPORT_LABELS, executiveSourceReasonText, type ExecutiveContext, type ExecutivePeriodComparison } from '@watchdog-bms/contracts';
import { periodParams, selectedPeriod, validPeriod, reportQuery, changedParams, clearedParams, menuHref, drilldownHref, sourceCount } from './executive-reports.logic';
import { exportBody } from './executive-export.logic';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const context = {
  currentMonth: '2026-10', defaultMonth: '2026-09', defaultPeriod: { from: '2026-09', to: '2026-09', appliedPreset: 'LAST_MONTH' },
  months: { first: '2025-12', last: '2026-10' }, builtMonths: ['2025-12', '2026-08', '2026-09', '2026-10'],
  filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, options]) => [key, Object.entries(options).map(([value, label]) => ({ value, label }))])),
  capabilities: { readReport: { allowed: true }, export: { allowed: true }, seeContacts: { allowed: false } },
  presets: EXECUTIVE_PERIOD_PRESETS.map(key => ({ key, from: key === 'LAST_MONTH' ? '2026-09' : '2026-08', to: key === 'LAST_MONTH' ? '2026-09' : '2026-10', available: key !== 'THIS_YEAR', unbuiltBoundaryMonths: key === 'THIS_YEAR' ? ['2026-01'] : [] })),
} as unknown as ExecutiveContext;
const render = (component: React.ComponentType<any>, props: object) => renderToStaticMarkup(React.createElement(component, props));

test('the server default is used and marked; URL migration keeps old origins and is idempotent', () => {
  assert.deepEqual(selectedPeriod(new URLSearchParams(), context), { from: '2026-09', to: '2026-09', appliedPreset: 'LAST_MONTH' });
  const migrated = periodParams(new URLSearchParams('month=2026-08&from=revenue&view=top&page=2&pick=paidEver%3DYES'), context);
  assert.equal(migrated.get('origin'), 'revenue'); assert.equal(migrated.get('from'), '2026-08'); assert.equal(migrated.get('to'), '2026-08'); assert.equal(migrated.has('month'), false);
  assert.equal(periodParams(migrated, context).toString(), migrated.toString());
  assert.deepEqual(selectedPeriod(new URLSearchParams('month=2026-08&from=2026-09&to=2026-10'), context), { from: '2026-09', to: '2026-10', appliedPreset: null });
  assert.equal(selectedPeriod(new URLSearchParams('from=secret&month=2026-08'), context), null);
});
test('ranges validate actual month syntax, order, boundaries and built custom endpoints, retaining interior gaps', () => {
  for (const query of ['from=2026-09', 'to=2026-09', 'from=2026-13&to=2026-13', 'from=2026-10&to=2026-08', 'from=2026-09&to=2026-11', 'from=2025-11&to=2026-09', 'month=2027-01']) assert.equal(selectedPeriod(new URLSearchParams(query), context), null, query);
  assert.equal(validPeriod('2025-12', '2026-10', context, true), true); // Missing interior months remain in the range.
  assert.equal(validPeriod('2026-01', '2026-10', context, true), false);
  assert.equal(validPeriod('2026-01', '2026-10', context), true); // A link may ask for an unbuilt endpoint and receive the server's unavailable reason.
});
test('menu, drills, filter reset, sort, pagination and export carry one period without leaking preset/origin', () => {
  const params = new URLSearchParams('from=2026-08&to=2026-10&periodPreset=ALL&view=top&page=3&origin=overview&filter_discovery=OTHER');
  const query = reportQuery('revenue', params, context);
  assert.equal(query.from, '2026-08'); assert.equal(query.to, '2026-10'); assert.equal(query.month, undefined); assert.equal(query.periodPreset, undefined); assert.equal(query.origin, undefined);
  assert.equal(new URL(menuHref('usage', params), 'https://test.invalid').searchParams.get('to'), '2026-10');
  const drilled = new URL(drilldownHref(params, 'revenue', { from: '2026-09', to: '2026-09', paidInPeriod: 'true' }), 'https://test.invalid').searchParams;
  assert.equal(drilled.get('from'), '2026-09'); assert.equal(drilled.get('origin'), 'revenue'); assert.equal(drilled.has('periodPreset'), false);
  assert.equal(reportQuery('companies', drilled, context).paidInPeriod, 'true');
  assert.equal(changedParams(params, { sortBy: 'netReceipts' }).get('page'), '1'); assert.equal(clearedParams(params).get('to'), '2026-10');
  const body = exportBody('revenue', params, context, 'shown');
  assert.equal(body.from, '2026-08'); assert.equal(body.to, '2026-10'); assert.equal(body.month, undefined);
  assert.deepEqual(body.filters, { industry: 'ALL', discovery: 'OTHER', referringSales: 'ALL' });
  assert.deepEqual(sourceCount(null, { coverage: 'unavailable', reasonCodes: [] }), { value: null, coverage: 'unavailable', reasonCodes: [] });
});
test('preset order, truthful disabled reasons, scrolling phone row and custom sheet use shared words', async () => {
  const { ExecutivePeriodControl } = await import('./ExecutivePeriodControl');
  const markup = render(ExecutivePeriodControl, { context, params: new URLSearchParams(), apply() {} });
  let index = -1;
  for (const key of EXECUTIVE_PERIOD_PRESETS) { const next = markup.indexOf(`>${P.presets[key]}</button>`); assert.ok(next > index); index = next; }
  assert.match(markup, /aria-pressed="true"[^>]*>เดือนที่แล้ว/);
  assert.match(markup, /disabled="" title="ยังไม่มีรายงานของเดือน/); assert.match(markup, /overflow-x-auto/); assert.doesNotMatch(markup, /flex-wrap/);
  assert.match(markup, /fixed left-0 right-0 bottom-0 top-auto m-0 w-full[^"]*mangmee-safe-bottom/); assert.match(markup, /md:w-96/);
  assert.match(markup, /executive-period-from/); assert.match(markup, /executive-period-to/); assert.match(markup, new RegExp(P.apply));
});
const complete = { coverage: 'complete', reasonCodes: [], dataThrough: '2026-10-04' };
const envelope = { period: { from: '2026-08', to: '2026-10', includesOpenMonth: true }, sourceStatus: {
  money: { coverage: 'partial', reasonCodes: ['RANGE_MONTH_NOT_BUILT', 'MONTH_SUMMARY_INCOMPLETE', 'BILLING_SCAN_NOT_COMPLETE', 'PAYMENT_HISTORY_INCOMPLETE'], affectedMonths: [{ month: '2026-08', reasonCodes: ['RANGE_MONTH_NOT_BUILT'] }, { month: '2026-09', reasonCodes: ['MONTH_SUMMARY_INCOMPLETE', 'BILLING_SCAN_NOT_COMPLETE', 'PAYMENT_HISTORY_INCOMPLETE'] }], dataThrough: null },
  usage: complete, aiCost: { ...complete, coverage: 'unavailable', reasonCodes: ['SHEET_FACTS_NOT_BUILT'] },
}, revenue: { trend: [{ reasonCodes: ['UNMATCHED_MONEY'] }] } };
test('source banner names affected months once, ignores unrelated nested reasons and limits sources to the view', async () => {
  const { ReportStatus, sourceStatusNotes } = await import('./ExecutiveReportDesign');
  const notes = sourceStatusNotes(envelope as never, ['money']);
  assert.equal(notes.length, 3); assert.ok(notes.some(note => note.text.includes('ส.ค.'))); assert.ok(notes.some(note => note.text.includes('ก.ย.')));
  const markup = render(ReportStatus, { data: envelope, sources: ['money'] });
  assert.match(markup, new RegExp(P.openMonth)); assert.doesNotMatch(markup, /มีเงินที่ยังไม่ผูกบริษัท|ข้อมูลสรุปส่วนนี้/);
  for (const { text } of notes) assert.equal(markup.split(text).length - 1, 1);
  const closed = render(ReportStatus, { data: { ...envelope, period: { ...envelope.period, includesOpenMonth: false } }, sources: ['money'] });
  assert.doesNotMatch(closed, new RegExp(P.openMonth)); assert.match(closed, /bg-gray-50/);
  assert.equal(render(ReportStatus, { data: { period: { includesOpenMonth: false }, sourceStatus: { money: complete, usage: complete, aiCost: complete } }, sources: ['money'] }), '');
});
const comparison = (status: ExecutivePeriodComparison['status'], percentChange: number | null = null) => ({ status, percentChange, absoluteChange: 6, period: { from: '2026-07', to: '2026-09' }, current: { value: 6, coverage: 'complete' }, previous: { value: 0, coverage: 'complete' }, affectedMonths: [], includesOpenMonth: false } as unknown as ExecutivePeriodComparison);
test('KPI comparisons obey all server states, keep percent rules and give incomplete data priority', async () => {
  const { comparisonLine, ExecutiveKpi } = await import('./ExecutiveReportDesign');
  assert.equal(comparisonLine(comparison('COMPLETE', 12.5)), P.change('+12.5%'));
  assert.equal(comparisonLine(comparison('UNCHANGED')), P.unchanged);
  assert.equal(comparisonLine(comparison('ZERO_BASE')), P.zeroBase); assert.equal(comparisonLine(comparison('NEGATIVE_BASE')), P.negativeBase);
  assert.match(comparisonLine(comparison('NO_PREVIOUS')), /ยังไม่มีตัวเลขของช่วงก่อนหน้า/);
  for (const state of ['NO_PREVIOUS', 'ZERO_BASE', 'NEGATIVE_BASE', 'PARTIAL'] as const) assert.doesNotMatch(comparisonLine(comparison(state, 100)), /%/);
  const markup = render(ExecutiveKpi, { label: P.net, figure: { value: null, knownValue: 9900, coverage: 'partial', reasonCodes: ['MONTH_SUMMARY_INCOMPLETE'] }, moneyValue: true, unit: 'บาท', comparison: comparison('COMPLETE', 100) });
  assert.match(markup, /เฉพาะที่ยืนยันแล้ว/); assert.doesNotMatch(markup, /เปลี่ยนจากช่วงก่อน/);
});

const count = { value: 6, coverage: 'complete', reasonCodes: [] };
const cash = { ...count, value: 9900, currency: 'THB' };
const summary = {
  paidEver: { value: 'UNKNOWN' }, fullyRefunded: null, paidInPeriod: null, positiveNetInPeriod: null, usageGroup: null,
  coverage: { money: complete, usage: complete, aiCost: complete },
  money: Object.fromEntries(['netReceiptsSatang', 'receiptsSatang', 'refundsSatang', 'taxSatang', 'feesSatang', 'aiCostSatang'].map(key => [key, cash])),
  usage: { ...Object.fromEntries(['activeDays', 'activeDaysLine', 'activeDaysWeb', 'expenseReceiptCountInPeriod', 'expenseReceiptsLine', 'expenseReceiptsWeb', 'documents', 'aiRequests'].map(key => [key, 6])), activeUsers: null, activeUsersLine: null, activeUsersWeb: null, activeUsersCoverage: { coverage: 'unavailable', reasonCodes: ['DISTINCT_USERS_NOT_AVAILABLE'] } },
};
const company = { id: 'customer', receiptAdoption: 'EVER', expenseReceiptCountLifetime: 6 };
const detail = { ...envelope, periodSummary: summary, company, coverage: { money: complete, usage: complete, aiCost: complete }, sourceStatus: { money: complete, usage: complete, aiCost: complete } };
test('nullable period payment flags stay unknown even when other report money is complete', async () => {
  const { CompanyContent } = await import('./ExecutiveReportContent');
  const markup = render(CompanyContent, { data: detail, tab: 'usage', history: null, admin: false, contactReadAt: '', nav: { params: new URLSearchParams('from=2026-08&to=2026-10'), from: 'detail', remember() {}, navigate() {} } });
  assert.match(markup, new RegExp(`${P.paid}: ยังประเมินไม่ได้ · ${P.positive}: ยังประเมินไม่ได้`));
  assert.doesNotMatch(markup, new RegExp(P.noReceipts));
  assert.match(markup, new RegExp(P.distinctUsersUnavailable));
  assert.doesNotMatch(markup.match(/<td\b[^]*?<\/td>/g)?.filter(cell => cell.includes('ผู้ใช้')).join('') ?? '', />0</);
});
test('range-only banner excludes lifetime issues outside the shown months; detail not-applicable reasons remain', async () => {
  const { ReportStatus } = await import('./ExecutiveReportDesign');
  const data = { ...detail, period: { from: '2026-10', to: '2026-10', includesOpenMonth: false }, sourceStatus: { ...detail.sourceStatus, money: { ...complete, coverage: 'partial', reasonCodes: ['UNMATCHED_MONEY'], affectedMonths: [{ month: '2026-09', reasonCodes: ['UNMATCHED_MONEY'] }] } } };
  assert.equal(render(ReportStatus, { data, sources: ['money'], periodOnly: true }), '');
  const beforeJoin = render(ReportStatus, { data: { ...data, periodSummary: null, periodReasonCodes: ['NOT_YET_REGISTERED'], sourceStatus: detail.sourceStatus }, sources: ['money', 'usage'] });
  assert.match(beforeJoin, new RegExp(P.periodNotRegistered));
});
test('the trend reads every chosen monthly-series point, preserves unavailable gaps and scrolls long ranges', async () => {
  const { AnalysisContent } = await import('./ExecutiveReportContent');
  const points = Array.from({ length: 13 }, (_, i) => ({ month: `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, metricValue: i === 4 ? { value: null, coverage: 'unavailable', reasonCodes: ['RANGE_MONTH_NOT_BUILT'] } : { ...cash, value: 1234500 } }));
  const data = { ...detail, period: { from: '2025-01', to: '2026-01', includesOpenMonth: false }, unmatchedMoney: { count: 0, receiptsSatang: 0, refundsSatang: 0 }, population: { eligibleCount: count, unclassifiedCount: 0, excludedTestInternalNetReceiptsSatang: 0, unclassifiedNetReceiptsSatang: 0 }, periodSummary: undefined, company: undefined, revenue: { receiptsSatang: cash, refundsSatang: cash, netReceiptsSatang: cash, taxSatang: cash, feesSatang: cash, disputedInvoiceCount: null, byPurchaseGroup: [], trend: [] }, monthlySeries: [{ metric: 'netReceiptsSatang', points }] };
  const markup = render(AnalysisContent, { data, seller: null, nav: { params: new URLSearchParams('from=2025-01&to=2026-01&view=trend'), from: 'revenue', remember() {}, navigate() {} } });
  assert.equal((markup.match(/<g><title>/g) ?? []).length, 12); assert.equal((markup.match(/data-unavailable="true"/g) ?? []).length, 1);
  // Thirteen months, each as wide as its value needs (the short value on a phone): wider than a card, so the chart scrolls sideways.
  assert.match(markup, /overflow-x-auto/); assert.match(markup, /--chart-phone:calc\(13 \* \(4\.95ch \+ [\d.]+rem\)\);--chart-desktop:calc\(13 \* \(7\.2ch \+ [\d.]+rem\)\)/); assert.match(markup, /ม.ค. 69/);
});
test('history requests pin the applied range and build, without sending the old month or origin', async t => {
  const { getExecutiveHistory } = await import('./executive-reports.api');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://test.invalid');
    assert.equal(url.pathname, '/api/v1/system/executive/companies/customer/history');
    assert.deepEqual(Object.fromEntries(url.searchParams), { from: '2026-08', to: '2026-10', buildId: 'shown', page: '2', pageSize: '20' });
    return new Response(JSON.stringify({ items: [], pagination: { page: 2 } }));
  });
  await getExecutiveHistory('customer', 2, new AbortController().signal, { from: '2026-08', to: '2026-10', buildId: 'shown' });
});

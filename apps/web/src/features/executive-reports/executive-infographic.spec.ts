import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXECUTIVE_SHEET_WORDS as S, EXECUTIVE_REPORT_LABELS, type ExecutiveOverview, type ExecutiveContext } from '@watchdog-bms/contracts';
import { drilldownHref, drillFilters, reportQuery, changedParams, FILTER_URL, drillLabels, INFOGRAPHIC_FILTERS } from './executive-reports.logic';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const context = { currentMonth: '2026-10', defaultMonth: '2026-10', months: { first: '2026-09' }, filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) } as unknown as ExecutiveContext;
const nav = { params: new URLSearchParams('from=2026-09&to=2026-10'), from: 'overview', remember() {}, navigate() {} };
const figure = (value: number | null, filters = {}, share: number | null = 25) => ({ value, coverage: value === null ? 'unavailable' : 'complete', reasonCodes: value === null ? ['SHEET_FACTS_NOT_BUILT'] : [], share: share === null ? null : { value: share }, drilldownFilters: filters });
const overview = (never = 0 as number | null, churn = 0 as number | null) => {
  const empty = figure(0);
  return { period: { from: '2026-09', to: '2026-10', isPartialMonth: false }, dataThrough: { lagging: [] }, coverage: { money: empty, usage: empty }, metrics: { companies: { ...figure(4), unclassifiedCount: 0 }, activeCompanies: { ...figure(2), breakdown: {} }, companiesWithReceipts: figure(1), netReceiptsSatang: figure(9900) }, churn: { ...figure(1, { churned: 'true' }, 50), referenceDate: '2026-10-04' }, expenseReceiptAdoption: { population: 0, segments: [] }, paidUsage: { groups: [{ key: 'NOT_STARTED', count: 99 }] }, spendConcentration: { topShare: null }, asOfFigures: { asOf: '2026-10-04', receiptBuckets: ['ZERO', 'ONE_TO_FIVE', 'SIX_PLUS'].map((key, i) => ({ ...figure(i, { receiptBucket: key, atDataDate: 'true' }, 26.1), key, label: S.receiptBucket[key as 'ZERO'] })), receipts7: figure(1, { receiptAdded7: 'true', atDataDate: 'true' }), receipts30: figure(2, { receiptAdded30: 'true', atDataDate: 'true' }), receiptDays30AtLeast2: figure(null, { receiptDays30AtLeast2: 'true', atDataDate: 'true' }, null), packages: [{ ...figure(4, { packageLabel: 'ร้านเติบโต', atDataDate: 'true' }), label: 'ร้านเติบโต' }], followUp: { neverUsed: figure(never, { neverUsed: 'true', atDataDate: 'true' }), churn: figure(churn, { churned: 'true', atDataDate: 'true' }) } } } as unknown as ExecutiveOverview;
};
const render = async (data: ExecutiveOverview) => { const { OverviewContent } = await import('./ExecutiveReportContent'); return renderToStaticMarkup(React.createElement(OverviewContent, { data, nav })); };

test('infographic drill hrefs preserve source filters and data-date population, then remove the same applied chip', () => {
  for (const filters of [...INFOGRAPHIC_FILTERS.map(({ key, value }) => ({ [key]: value, atDataDate: 'true' })), { packageLabel: 'ร้านเติบโต', atDataDate: 'true' }, { receiptDays30AtLeast2: 'true', atDataDate: 'true' }]) {
    const href = drilldownHref(nav.params, 'overview', filters);
    assert.equal(href.split('?').length, 2);
    const params = new URL(href, 'https://local.invalid').searchParams;
    assert.deepEqual(drillFilters(params), filters);
    const query = reportQuery('companies', params, context);
    for (const [key, value] of Object.entries(filters)) assert.equal(query[key], value);
    const key = Object.keys(filters)[0] as keyof typeof FILTER_URL;
    assert.equal(drillFilters(changedParams(params, { [FILTER_URL[key]]: 'ALL' }))?.[key], undefined);
  }
  assert.deepEqual(drillLabels({ packageLabel: 'ร้านเติบโต', atDataDate: 'true' }, context), ['ร้านเติบโต']);
});

test('follow-up visibility uses only known positive as-of cohorts, never the replaced paid-usage groups', async () => {
  for (const [never, churn] of [[0, 0], [null, null], [null, 0]] as const) assert.doesNotMatch(await render(overview(never, churn)), /executive-follow-up-band/);
  const markup = await render(overview(2, 0));
  const band = markup.match(/<aside[^>]*executive-follow-up-band[\s\S]*?<\/aside>/)![0];
  assert.match(band, new RegExp(S.invite)); assert.match(band, /neverUsed%3Dtrue/);
  assert.doesNotMatch(band, /usageGroup|99|churned%3Dtrue/);
  assert.match((await render(overview(0, 3))).match(/<aside[^>]*executive-follow-up-band[\s\S]*?<\/aside>/)![0], /churned%3Dtrue/);
});

test('full churn label, shared share words and as-of help remain outside clean values; five tiles share one wide row', async () => {
  const markup = await render(overview());
  assert.equal((markup.match(/data-executive-kpi="true"/g) ?? []).length, 5);
  assert.match(markup, /min-\[1200px\]:grid-cols-5/);
  const labels = markup.match(/data-executive-label[^>]*>[\s\S]*?<\/div>/g)!;
  assert.ok(labels.some(label => label.includes(S.churn) && !label.includes('truncate')));
  assert.ok(markup.includes(S.churnShare('50.0%')));
  assert.equal(markup.split(S.asOfHelp).length - 1, 1);
  assert.match(markup, /26\.1%/); assert.match(markup, /receiptDays30AtLeast2%3Dtrue/); assert.match(markup, /packageLabel%3D/);
  const values = markup.match(/data-executive-value[^>]*>[\s\S]*?<\/div>/g)!;
  values.forEach(value => assert.doesNotMatch(value, /อย่างน้อย|เฉพาะ|ข้อมูลสรุป/));
});

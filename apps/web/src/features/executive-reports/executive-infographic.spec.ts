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

test('owner 2026-10-05: as-of figures read as the API gives them — "at least 0" is not zero, bars follow the known counts, no share where none is known', async () => {
  const atLeast = (knownValue?: number) => ({ value: null, ...(knownValue === undefined ? {} : { knownValue }), coverage: knownValue === undefined ? 'unavailable' : 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'], share: null, drilldownFilters: { atDataDate: 'true' } });
  const base = overview();
  const keys = ['ZERO', 'ONE_TO_FIVE', 'SIX_PLUS'] as const;
  const data = { ...base, churn: { ...atLeast(), referenceDate: '2026-10-04' }, asOfFigures: { ...base.asOfFigures, receiptBuckets: [0, 0, 3].map((n, i) => ({ ...atLeast(n), key: keys[i], label: S.receiptBucket[keys[i]!] })),
    receipts30: atLeast(8), receipts7: atLeast(4), receiptDays30AtLeast2: atLeast(), packages: [{ ...atLeast(6), label: 'เริ่มต้น' }, { ...atLeast(12), label: 'ทดลองใช้ฟรี' }] } } as unknown as ExecutiveOverview;
  const markup = await render(data);
  const asOf = markup.slice(markup.indexOf('data-executive-as-of'));
  const items = [...asOf.matchAll(/<li>[\s\S]*?<\/li>/g)].map(match => match[0]);
  const read = (item: string) => ({ figure: />([^<>]*)<\/span><\/strong>/.exec(item)?.[1], bar: /bg-brand-700" style="(?:height|width):([^"]*)"/.exec(item)?.[1], said: /aria-label="([^"]*)"/.exec(item)?.[1] });
  // Buckets: "at least 0" twice and "at least 3": the first two are not known, the third fills its bar.
  assert.deepEqual(items.slice(0, 3).map(read), [{ figure: '–', bar: '0%', said: 'ยังไม่มีตัวเลข — ตัวเลขนี้ครอบคลุมเฉพาะข้อมูลที่เก็บได้ ช่วงก่อนเริ่มเก็บยังประเมินไม่ได้' }, { figure: '–', bar: '0%', said: 'ยังไม่มีตัวเลข — ตัวเลขนี้ครอบคลุมเฉพาะข้อมูลที่เก็บได้ ช่วงก่อนเริ่มเก็บยังประเมินไม่ได้' }, { figure: '3', bar: '100%', said: 'อย่างน้อย 3 — ตัวเลขนี้ครอบคลุมเฉพาะข้อมูลที่เก็บได้ ช่วงก่อนเริ่มเก็บยังประเมินไม่ได้' }]);
  // Recent use: 8, 4 and a figure the API does not have. Bars are in proportion to the largest known count, not to a share.
  assert.deepEqual(items.slice(3, 6).map(item => [read(item).figure, read(item).bar]), [['8', '100%'], ['4', '50%'], ['–', '0%']]);
  assert.deepEqual(items.slice(6).map(item => [read(item).figure, read(item).bar]), [['6', '50%'], ['12', '100%']]);
  // No share is known, so none is printed: not as "–" after every figure, and not as a sentence on the churn tile.
  assert.doesNotMatch(asOf.replace(/<h2[\s\S]*?<\/h2>/g, ''), / · –|>–<\/span><\/a>/);
  assert.doesNotMatch(markup, new RegExp(S.churnShare('–')));
  // Each card still says its figures are incomplete: one dot at its title.
  assert.equal((asOf.match(/executive-dot/g) ?? []).length, 3);
});

test('owner 2026-10-05: five KPI tiles are one row from 1200 px, 3 + 2 from 768 px and two a row on a phone; the period row cannot collide on a phone', async () => {
  const strip = (await render(overview())).match(/<div data-executive-kpi-strip="true" class="([^"]*)"/)![1]!;
  assert.match(strip, /grid-cols-2 /); assert.match(strip, /max-md:\[&amp;&gt;\*:last-child\]:col-span-2/);
  // The 3 + 2 rule is scoped below 1200 px, so the one-row rule above it never depends on the order of the two in the style sheet.
  assert.match(strip, /md:max-\[1200px\]:grid-cols-6 md:max-\[1200px\]:\[&amp;&gt;\*\]:col-span-2 md:max-\[1200px\]:\[&amp;&gt;\*:nth-child\(n\+4\)\]:col-span-3 min-\[1200px\]:grid-cols-5/);
  assert.doesNotMatch(strip, /first-child|grid-cols-3/);
  const source = (file: string) => require('node:fs').readFileSync(new URL(file, import.meta.url), 'utf8') as string;
  assert.doesNotMatch(source('./ExecutiveReportDesign.tsx'), /kpi-fallback/);
  const { ExecutiveKpi, ExecutiveKpiStrip } = await import('./ExecutiveReportDesign');
  const size = (satang: number) => /data-executive-value="true" style="font-size:([^"]+)"/.exec(renderToStaticMarkup(React.createElement(ExecutiveKpiStrip, { children: React.createElement(ExecutiveKpi, { label: 'ก', figure: { value: satang, coverage: 'complete', reasonCodes: [], currency: 'THB' } as any, moneyValue: true }) })))![1];
  assert.deepEqual([99900, 1510200, 100000000, 1000000000].map(size), ['26px', '18px', '16px', '14px']);
  // Phone: the period and the filter share a line, the two dates (two-digit years) the next; the filter is never narrower than its button.
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /max-md:basis-full[^"]*"[^\n]*<span className="md:hidden">\{W\.through\(reportShortDateTime\(/);
  assert.match(page, /<MangmeeBadge><span className="md:hidden">\{W\.revised\(reportShortDateTime\(/);
  assert.match(source('./ExecutiveFilters.tsx'), /return <div className="grid min-w-min flex-1 grid-cols-\[auto_minmax\(0,1fr\)\] items-center gap-2">/);
  const { reportShortDateTime } = await import('./executive-reports.logic');
  assert.equal(reportShortDateTime('2026-10-02T17:00:00.000Z'), '3 ต.ค. 69 00:00 น.'); assert.equal(reportShortDateTime(null), '–'); // one dash for "no value" in the whole report
});


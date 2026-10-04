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
test('an opened row of the company sheet is grouped facts under their own labels, with the note in full and a link to the company', async () => {
  const { CompaniesContent } = await content();
  const { companyFacts } = await import('./executive-company.fixture');
  const facts = companyFacts({ note: { text: 'โทรคุยแล้ว\nรอใบเสนอราคา', version: 2, updatedAt: '2026-10-04T08:30:00.000Z', updatedBy: { displayName: 'สมหญิง' } } });
  const html = htmlOf(CompaniesContent, { data: { ...envelope, summary: { netReceiptsSatang: cash(10000) }, items: [{ ...company, ...facts }], pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav });
  assert.match(html, /executive-company-row/);
  // Owner 2026-10-05: an opened row is a tidy grid, grouped, every value under its own label, with a link to the company; no run-on line.
  const opened = html.match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '';
  assert.deepEqual([...opened.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(match => match[1]), ['หมายเหตุของทีมมั่งมี', 'ใบเสร็จ', 'แพ็กเกจและการชำระ', 'คนและการตั้งค่า', 'การใช้งาน', 'ช่วงเดือน ก.ย. 2569']);
  assert.equal((opened.match(/<dl class="grid grid-cols-2 [^"]*@min-\[640px\]:grid-cols-3 @min-\[936px\]:grid-cols-4"/g) ?? []).length, 6);
  assert.equal((opened.match(/<dt/g) ?? []).length, (opened.match(/<dd/g) ?? []).length);
  const read = (label: string) => new RegExp(`<dt[^>]*>${label.replace(/[()]/g, '\\$&')}</dt><dd[^>]*>([\\s\\S]*?)</dd>`).exec(opened)?.[1].replace(/<[^>]*>/g, '');
  // The owner's sheet, in his groups, with the shared column words.
  for (const [label, value] of [['บิลแรก', '3 ก.ค. 69'], ['ใบเสร็จใหม่ 7 วัน', '2'], ['ใบเสร็จใหม่ 30 วัน', '7'], ['จำนวนวันที่เพิ่มใบเสร็จใน 30 วัน', '3'], ['ห่างจากใบเสร็จล่าสุด (วัน)', '5'], ['ยืนยันแล้ว', '20'], ['รอตรวจ/ยืนยัน', '4'], ['แบบร่าง', '3'], ['ระดับใบเสร็จ', '6 รายการขึ้นไป'],
    ['สถานะการชำระ', 'เคยชำระเงิน'], ['วันเหลือ', '10'], ['รับชำระสะสม (บาท)', '999.00'], ['คืนเงินสะสม (บาท)', '0.00'], ['ชำระสุทธิสะสม (บาท)', '999.00'],
    ['สมาชิกใช้งานได้', '2'], ['สาขาเปิด', '1'], ['วันที่สมัคร', '1 ก.ย. 69'], ['ช่องทางสมัคร', 'สมัครทางไลน์'], ['รู้จักจาก', 'อื่น ๆ · งานร้านค้า'], ['ผู้แนะนำ', 'ไม่มีเซลล์ผู้แนะนำ'], ['ชื่อจดทะเบียน', 'บริษัท ก'],
    ['ใช้ระบบล่าสุดถึงวันอ้างอิง', '30 ก.ย. 69'], ['ห่างจากการใช้ระบบล่าสุด (วัน)', '0'], ['เลิกใช้ (ไม่ได้ใช้ติดต่อกันเกิน 1 เดือน)', 'ไม่ใช่'], ['คำขอผู้ช่วย 30 วัน', '5'],
    [W.receiptCount, '7'], [W.days, '3'], [W.users, '2'], [W.documents, '4'], [W.ai, '5'], ['ยอดรับสุทธิ (บาท)', '100.00'], [W.lastActivity, '30 ก.ย. 69'],
    ['หมายเหตุ', 'โทรคุยแล้ว\nรอใบเสนอราคา'], ['ผู้แก้ไขหมายเหตุ', 'สมหญิง'], ['แก้ไขหมายเหตุเมื่อ', '4 ต.ค. 2569 15:30 น.']] as const) assert.equal(read(label), value, label);
  assert.doesNotMatch(opened, /ชื่อจดทะเบียน:|ที่มา:/);
  // The note is clamped to two lines in its cell and whole in the opened row.
  assert.match(html, /<span class="line-clamp-2 whitespace-normal" title="โทรคุยแล้ว\nรอใบเสนอราคา">/); assert.match(opened, /<div class="min-w-0 col-span-full "><dt[^>]*>หมายเหตุ<\/dt><dd[^>]*><span class="whitespace-pre-wrap">/);
  assert.match(opened, /<a[^>]*href="\/system\/executive\/companies\/[^"]*"[^>]*>รายละเอียดบริษัท<span aria-hidden="true">→<\/span><\/a>/);
  // A package that has run out reads "หมดอายุแล้ว", never a negative number of days; a fact the API does not know reads "–", never 0.
  const expired = htmlOf(CompaniesContent, { data: { ...envelope, summary: { netReceiptsSatang: cash(0) }, items: [{ ...company, ...companyFacts(), sheet: { ...facts.sheet, daysLeft: -3, packageExpired: true, firstReceiptAt: null, lastReceiptAt: null, daysSinceLastReceipt: null, receiptBucket: null, businessTypeLabel: null, planEndsAt: null } }], pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav });
  const cells = [...(expired.replace(/<tr hidden=""[\s\S]*?<\/tr>/g, '').match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<span class="[^"]*md:hidden">[^<]*<\/span>/, '').replace(/<[^>]*>/g, ''));
  assert.deepEqual([cells[1], cells[4], cells[5], cells[6]], ['–', '–', '–', '–']); // business type, last receipt, package end, note
  assert.match(expired, /<dt[^>]*>วันเหลือ<\/dt><dd[^>]*>หมดอายุแล้ว<\/dd>/); assert.doesNotMatch(expired.replace(/<[^>]*>/g, ' '), /[-−]\s?3\b/);
  assert.doesNotMatch(html, /type="checkbox"|เปรียบเทียบ/);
  // An empty note has no group of its own in the opened row.
  assert.doesNotMatch(expired.match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '', /หมายเหตุของทีมมั่งมี/);
});

test('the team note: every reader reads it, the note right adds the edit action in the row and the editor on the company page, an admin is sent to the console', async () => {
  const { CompaniesContent, CompanyContent } = await content();
  const { companyFacts } = await import('./executive-company.fixture');
  const { COMPANY_TEAM_NOTE_WORDS: N } = await import('@watchdog-bms/contracts');
  const opened = (facts: object) => htmlOf(CompaniesContent, { data: { ...envelope, summary: { netReceiptsSatang: cash(0) }, items: [{ ...company, ...companyFacts(), ...facts }], pagination: { total: 1 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies, nav }).match(/data-row-details[\s\S]*?<\/td>/)?.[0] ?? '';
  const noted = { text: 'รอใบเสนอราคา', version: 2, updatedAt: '2026-10-04T08:30:00.000Z', updatedBy: { displayName: 'สมหญิง' } };
  // No note and no right: the opened row says nothing about the note. A note without the right: read only.
  assert.ok(!opened({}).includes(N.title));
  assert.ok(opened({ note: noted }).includes('รอใบเสนอราคา')); assert.ok(!opened({ note: noted }).includes(`>${N.edit}<`));
  // The note right: the action is there also where there is no note yet (said in the note's own words); the editor opens only on the action.
  const editable = opened({ canEditNote: true });
  assert.match(editable, new RegExp(`<h3[^>]*>${N.title}</h3>`)); assert.match(editable, new RegExp(`<dd[^>]*>${N.empty}</dd>`)); assert.match(editable, new RegExp(`<button[^>]*>${N.edit}</button>`));
  assert.doesNotMatch(editable, /ผู้แก้ไขหมายเหตุ|role="dialog"|<textarea/);
  // A note that was cleared still says who cleared it and when.
  const cleared = opened({ note: { ...noted, text: '' } });
  assert.match(cleared, new RegExp(`<dd[^>]*>${N.empty}</dd>`)); assert.match(cleared, /<dt[^>]*>ผู้แก้ไขหมายเหตุ<\/dt><dd[^>]*>สมหญิง<\/dd>/);

  // The company page: the same note in its own card, once.
  const page = (facts: object, admin = false) => htmlOf(CompanyContent, { data: { ...envelope, company: { ...company, ...companyFacts(), creditedSeller: {}, currentActiveMemberCount: 1, currentBranchCount: 1, ...facts }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail, tab: 'company', history: null, admin, nav, contactReadAt: '' });
  const reader = page({ note: noted });
  assert.equal(reader.split(`>${N.title}<`).length - 1, 1); assert.ok(reader.includes('รอใบเสนอราคา')); assert.ok(reader.includes('แก้ล่าสุดโดย สมหญิง เมื่อ 4 ต.ค. 2569'));
  assert.ok(reader.includes(N.readOnly)); assert.ok(!reader.includes(`>${N.edit}<`));
  const holder = page({ canEditNote: true });
  assert.match(holder, new RegExp(`<button[^>]*>${N.edit}</button>`)); assert.ok(holder.includes(N.empty)); assert.ok(!holder.includes(N.readOnly));
  // A System Admin changes the note in the console: the sentence itself is the way there.
  const console_ = page({}, true);
  assert.match(console_, new RegExp(`<a[^>]*href="/system/partners/company"[^>]*>${S.noteAdminRoute}</a>`)); assert.ok(!console_.includes(N.readOnly));
  // The history and usage tabs do not repeat it.
  assert.ok(!htmlOf(CompanyContent, { data: { ...envelope, company: { ...company, ...companyFacts(), note: noted }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail, tab: 'history', history: null, admin: false, nav, contactReadAt: '' }).includes(N.title));

  // One editor: the report's block and dialog are the console's own note over the report's routes, with no sentence of their own.
  const note = source('./ExecutiveCompanyNote.tsx');
  assert.match(note, /import \{ TeamNoteBody, useTeamNote, type TeamNote \} from '\.\.\/system-partners\/PartnerTeamNote';/);
  assert.match(note, /closeOnBackdrop=\{draft === base\}/); assert.match(note, /if \(!saving\) close\(\)/); assert.doesNotMatch(note, /[ก-๙]/);
  // A changed note replaces the one on screen without reading the report again.
  assert.match(source('./ExecutiveReportPage.tsx'), /const noteChanged = useCallback\(\(companyId: string, change: ExecutiveCompanyNoteResult\) => setData\(/);
});
test('the note routes of the report: the company is in the address, the save sends the text and the version only, the latest note comes with the company page', async () => {
  const api = await import('./executive-reports.api');
  const calls: Array<{ url: string; init?: RequestInit }> = []; const original = globalThis.fetch;
  const latest = { text: 'ล่าสุด', version: 5, updatedAt: '2026-10-04T08:30:00.000Z', updatedBy: { displayName: 'สมหญิง' } };
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(init?.method === 'PATCH' ? { note: latest, canEditNote: true } : { company: { note: latest, canEditNote: false, ownerContact: { status: 'OK', email: 'owner@example.test' } } }), { status: 200 }); }) as typeof fetch;
  try {
    assert.deepEqual(await api.patchExecutiveCompanyNote('co /1', { text: 'ทีม', expectedVersion: 4 }), { note: latest, canEditNote: true });
    assert.equal(calls[0].url, '/api/v1/system/executive/companies/co%20%2F1'); assert.equal(calls[0].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { text: 'ทีม', expectedVersion: 4 });
    // Reading again keeps only the note and the right of the answer: nothing else of the company (its contact least of all) travels on.
    assert.deepEqual(await api.getExecutiveCompanyNote('co /1', { from: '2026-07', to: '2026-09' }), { note: latest, canEditNote: false });
    assert.equal(calls[1].url, '/api/v1/system/executive/companies/co%20%2F1?from=2026-07&to=2026-09'); assert.equal(calls[1].init?.method ?? 'GET', 'GET');
  } finally { globalThis.fetch = original; }
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
  // Owner 2026-10-05: a value sits over the middle of its bar (three rows of the same equal columns, no gap) and two values never touch:
  // every month is as wide as its value needs, the short value on a phone and the full one from a tablet up; more months than fit scroll sideways.
  const labels = html.match(/<div class="executive-trend-labels grid items-end tabular-nums" style="grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)">[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.equal((labels.match(/<span class="flex min-w-0 justify-center">/g) ?? []).length, 3);
  assert.match(labels, /aria-label="100\.00 บาท[^"]*"[^>]*><span class="md:hidden">100<\/span><span class="max-md:hidden">100\.00<\/span>/);
  assert.match(labels, /<span class="md:hidden">-100<\/span><span class="max-md:hidden">-100\.00<\/span>/);
  assert.match(html, /<div class="grid text-center text-xs text-gray-600" style="grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)">/); assert.doesNotMatch(html.match(/executive-trend-labels[\s\S]*?<\/svg>[\s\S]*?<\/div>/)![0], /gap-2/);
  assert.match(html, /<div class="overflow-x-auto"><div class="min-w-\[var\(--chart-phone\)\] text-sm md:min-w-\[var\(--chart-desktop\)\]" style="--chart-phone:calc\(3 \* \(4\.4ch \+ 0\.625rem\)\);--chart-desktop:calc\(3 \* \(5\.85ch \+ 0\.625rem\)\)">/);
  assert.match(source('./ExecutiveReportContent.tsx'), /const showLatest = \(scroller: HTMLDivElement \| null\) => \{ if \(scroller\) scroller\.scrollLeft = scroller\.scrollWidth; \};/);
});
test('a tab that needs its own read loads inside its panel: the figures and the tab bar stay in place and in use', async () => {
  const { AnalysisContent, CompanyContent } = await content();
  const { companyFacts } = await import('./executive-company.fixture');
  const reading = { view: 'top', label: 'ลูกค้าที่สร้างรายรับสูง', minHeight: 367 };
  const tabs = React.createElement('div', { role: 'tablist' }, 'TABS');
  const revenue = { receiptsSatang: cash(100), refundsSatang: cash(0), netReceiptsSatang: cash(100), taxSatang: cash(0), feesSatang: cash(0), byPurchaseGroup: [{ key: 'FIRST', label: 'ซื้อครั้งแรก', receiptsSatang: cash(100), refundsSatang: cash(0), netReceiptsSatang: cash(100), taxSatang: cash(0), feesSatang: cash(0) }], disputedInvoiceCount: 0, trend: [] };
  const loading = htmlOf(AnalysisContent, { data: { ...envelope, revenue } as unknown as ExecutiveAnalysis, nav, seller: null, tabs, reading });
  // The five figures and the tab bar are there as before; the old tab's table is not; the panel says it is loading, under the new tab's name.
  assert.equal((loading.match(/data-executive-kpi(?=[ =>])/g) ?? []).length, 5); assert.ok(loading.indexOf('TABS') < loading.indexOf('id="executive-panel"')); assert.ok(!loading.includes('ซื้อครั้งแรก'));
  assert.match(loading, /<div id="executive-panel" role="tabpanel" aria-labelledby="executive-tab-top" aria-label="ลูกค้าที่สร้างรายรับสูง" aria-busy="true" style="min-height:367px"><div class="relative h-64 overflow-hidden rounded-xl">/);
  assert.ok(loading.includes(W.loading)); assert.equal(loading.split('id="executive-panel"').length - 1, 1);
  // The same for a report without figures above its tabs, and for a company's history.
  const groups = htmlOf(AnalysisContent, { data: { ...envelope, view: 'industry', groups: [] } as unknown as ExecutiveAnalysis, nav, seller: null, tabs, reading: { view: 'discovery', minHeight: 0 } });
  assert.match(groups, /TABS<\/div><div id="executive-panel" role="tabpanel" aria-labelledby="executive-tab-discovery" aria-busy="true" style="min-height:0"><div class="relative h-64 /);
  const history = htmlOf(CompanyContent, { data: { ...envelope, company: { ...company, ...companyFacts(), creditedSeller: {}, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail, tab: 'history', history: null, admin: false, nav, contactReadAt: '', tabs, reading: { view: 'history', label: 'ประวัติบริษัท', minHeight: 578 } });
  assert.match(history, /TABS<\/div><div id="executive-panel" role="tabpanel" aria-labelledby="executive-tab-history" aria-label="ประวัติบริษัท" aria-busy="true" style="min-height:578px">/);
  // The page covers the whole report only for a read that is not a tab's own, measures the panel a tab replaces, and never shows an empty history panel.
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /const covered = reading && !panelRead;/); assert.match(page, /<CoverLoader active=\{covered && !!visibleData\} label=\{W\.loading\} \/>/); assert.match(page, /inert=\{covered && !!visibleData\}/);
  assert.match(page, /panelHeight\.current = document\.getElementById\('executive-panel'\)\?\.offsetHeight \?\? 0; tabFocus\.current = keyboard \? view : null; update\(changes\);/);
  assert.match(page, /const historyPending = section === 'detail' && tab === 'history' && !loading && \(historyLoading \|\| \(!history && !historyFailure\)\);/);
  assert.equal((page.match(/reading=\{panelRead\}/g) ?? []).length, 2); assert.equal((page.match(/switchTab\(/g) ?? []).length, 2);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExecutiveCount, ExecutiveMoney, ExecutiveEnvelope, ExecutiveOverview, ExecutiveCompanies, ExecutiveAnalysis, ExecutiveCompanyDetail, ExecutiveCompanyHistory } from '@watchdog-bms/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const content = () => import('./ExecutiveReportContent');
const count = (value: number): ExecutiveCount => ({ value, coverage: 'complete', reasonCodes: [] });
const cash = (value: number): ExecutiveMoney => ({ ...count(value), currency: 'THB' });
const missing: ExecutiveMoney = { value: null, coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'], currency: 'THB' };
const nav = { params: new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK'), from: 'overview', remember: () => {} };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const envelope = {
  build: { id: 'internal-build', asOf: '2026-10-01T05:00:00Z' }, period: { month: '2026-09' },
  population: { eligibleCount: count(72), unclassifiedCount: 0, excludedTestInternalNetReceiptsSatang: 0, unclassifiedNetReceiptsSatang: 0 },
  coverage: { usage: { coverage: 'partial', reasonCodes: ['ACTIVITY_HISTORY_INCOMPLETE'] }, money: { coverage: 'complete', reasonCodes: [] } },
  unmatchedMoney: { count: 0, receiptsSatang: 0, refundsSatang: 0, otherSatang: 0 },
} as unknown as ExecutiveEnvelope;
const company = {
  id: 'internal-company', displayName: 'บริษัท' + 'ก'.repeat(120), registeredName: 'บริษัทจดทะเบียน', provinceLabel: 'เชียงใหม่', industryGroup: { key: 'UNKNOWN', label: 'ไม่ระบุ' },
  joinedAt: '2026-09-01T05:00:00Z', companyStatus: 'ACTIVE', planState: 'ADMIN_HOLD', planLabel: 'ยังไม่มีข้อมูลแพ็กเกจ',
  discovery: { key: 'FACEBOOK', label: 'Facebook', otherText: 'ก'.repeat(200) }, signupRail: 'line-oa', referrer: { kind: 'NONE', label: 'ไม่มีเซลล์ผู้แนะนำ' },
  creditedSeller: {}, paidEver: { value: 'UNKNOWN', reason: 'MANUAL_TERM_NO_RECEIPT' }, fullyRefunded: false, usageGroup: null, usageUnassessedReason: 'ACTIVITY_HISTORY_INCOMPLETE', receiptAdoption: 'UNKNOWN',
  metrics: { receiptsSatang: 0, refundsSatang: 100, netReceiptsSatang: -100, activeDays: 0, activeUsers: 0, documents: 0, aiRequests: 0, expenseReceiptCountInPeriod: 0, expenseReceiptCountLifetime: 0 }, lastActivityAt: null,
};

test('rendered partial and unavailable figures retain their reasons and negative amounts have words', async () => {
  const { Figure } = await content();
  const partial = renderToStaticMarkup(React.createElement(Figure, { value: { value: null, knownValue: 38, coverage: 'partial', reasonCodes: ['ACTIVITY_HISTORY_INCOMPLETE'] } }));
  assert.match(text(partial), /อย่างน้อย 38/); assert.match(text(partial), /ข้อมูลการใช้งานไม่ครบ/);
  const unavailable = text(renderToStaticMarkup(React.createElement(Figure, { value: missing, moneyValue: true })));
  assert.match(unavailable, /—/); assert.match(unavailable, /ก่อนที่ระบบเริ่มเก็บ/); assert.doesNotMatch(unavailable, /0\.00/);
  assert.match(text(renderToStaticMarkup(React.createElement(Figure, { value: cash(-123450), moneyValue: true, netValue: true }))), /คืนเงินมากกว่าเงินรับ/);
  assert.doesNotMatch(text(renderToStaticMarkup(React.createElement(Figure, { value: cash(-100), moneyValue: true }))), /คืนเงินมากกว่าเงินรับ/);
  assert.doesNotMatch(text(renderToStaticMarkup(React.createElement(Figure, { value: { ...cash(-100), value: null, knownValue: -100, coverage: 'partial' }, moneyValue: true, netValue: true }))), /คืนเงินมากกว่าเงินรับ/);
});
test('overview renders four server metrics, a partial count, and four receipt groups with independent drill queries', async () => {
  const { OverviewContent } = await content();
  const data = { ...envelope, metrics: {
    companies: { ...count(72), unclassifiedCount: 2, drilldownFilters: {} }, activeCompanies: { value: null, knownValue: 38, coverage: 'partial', reasonCodes: ['ACTIVITY_HISTORY_INCOMPLETE'], drilldownFilters: { activeInPeriod: 'true' }, breakdown: { notPaid: 1, paymentUnknown: 0 } },
    companiesWithReceipts: { ...count(59), drilldownFilters: { paidInPeriod: 'true' } }, netReceiptsSatang: { ...cash(24580600), drilldownFilters: {} },
  }, expenseReceiptAdoption: { population: 72, segments: ['EVER', 'NEVER', 'UNKNOWN', 'NOT_ENTITLED'].map(key => ({ key, count: 18, share: { value: 25 }, drilldownFilters: { receiptAdoption: key } })), reasonCodes: [], roundingNote: false },
  paidUsage: { groups: [{ key: 'NOT_STARTED', count: 20, drilldownFilters: { usageGroup: 'NOT_STARTED' } }, { key: 'INACTIVE', count: 3, drilldownFilters: { usageGroup: 'INACTIVE' } }] }, spendConcentration: { topShare: { value: 83.4 }, reasonCodes: [] } } as unknown as ExecutiveOverview;
  const html = renderToStaticMarkup(React.createElement(OverviewContent, { data, nav }));
  assert.equal((html.match(/mangmee-stat-card/g) ?? []).length, 4);
  for (const words of ['อย่างน้อย 38', '245,806.00 บาท', 'ยังไม่ได้จัดประเภท 2 บริษัท', 'ไม่มีในแพ็กเกจ', 'ก.ย. 2569']) assert.ok(text(html).includes(words), words);
  assert.doesNotMatch(text(html), /internal-|NOT_ENTITLED|FACEBOOK/);
  assert.match(html, /pick=activeInPeriod%3Dtrue/);
  assert.match(html, /role="group" aria-label="การเริ่มใช้ใบเสร็จ"/);
  assert.match(html, /aria-label="เคยเพิ่มใบเสร็จ · 18 บริษัท · 25\.0%"/);
});
test('directory uses the all-result summary rather than row sums and wraps unknown usage instead of inventing zero', async () => {
  const { CompaniesContent } = await content();
  const data = { ...envelope, summary: { netReceiptsSatang: cash(123450) }, items: [{ ...company, rank: 4 }], pagination: { total: 72 }, sort: { sortBy: 'netReceipts', sortDir: 'desc' } } as unknown as ExecutiveCompanies;
  const html = renderToStaticMarkup(React.createElement(CompaniesContent, { data, nav, selected: [], select: () => {} }));
  const visible = text(html);
  // The rank is the place in the chosen order (here by net receipts), not a usage rank.
  assert.match(visible, /อันดับ 4/); assert.doesNotMatch(visible, /อันดับการใช้/);
  assert.match(visible, /พบ 72 บริษัท/); assert.match(visible, /1,234\.50 บาท/); assert.match(visible, /อย่างน้อย 0/); assert.match(visible, /ข้อมูลการใช้งานไม่ครบ/);
  assert.match(visible, /ผู้ดูแลตั้งแพ็กเกจให้/); assert.match(visible, /คืนเงินมากกว่าเงินรับ/); assert.match(visible, /เฟซบุ๊ก/); assert.match(visible, /สมัครทางไลน์/);
  assert.doesNotMatch(visible, /internal-company|ADMIN_HOLD|MANUAL_TERM|Facebook|LINE/);
  assert.match(html, /table-fixed/); assert.match(html, /md:hidden/); assert.match(html, /companies\/internal-company\?/); // the id is only in the detail link
});
test('each compare toggle has its own id, so its label selects its own company', async () => {
  const { CompaniesContent } = await content();
  const data = { ...envelope, summary: { netReceiptsSatang: cash(0) }, items: [company, { ...company, id: 'second-company' }], pagination: { total: 2 }, sort: { sortBy: 'joinedAt', sortDir: 'desc' } } as unknown as ExecutiveCompanies;
  const html = renderToStaticMarkup(React.createElement(CompaniesContent, { data, nav, selected: [], select: () => {} }));
  const ids = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(([input]) => input.match(/id="([^"]+)"/)?.[1]);
  assert.equal(ids.length, 4); // two rows, each as a phone card and as a table row
  assert.equal(new Set(ids).size, 4, `duplicate ids: ${ids.join(', ')}`);
  for (const id of ids) assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
});
test('group tables and comparisons preserve null averages and the backend difference', async () => {
  const { AnalysisContent } = await content();
  const side = { key: 'UNKNOWN', label: 'ไม่ระบุ', companies: count(1), netReceiptsSatang: cash(999), netReceiptsPerCompanySatang: null, expenseReceiptCount: count(12), expenseReceiptsPerCompany: null, everAddedReceiptShare: null, activeCompanies: count(0), drilldownFilters: { industry: 'UNKNOWN' } };
  const data = { ...envelope, comparison: { sideA: side, sideB: { ...side, key: 'OTHER', label: 'อื่น ๆ' }, difference: { companies: 9, netReceiptsSatang: -123450, netReceiptsPerCompanySatang: null, expenseReceiptCount: null, expenseReceiptsPerCompany: null, everAddedReceiptShare: null, activeCompanies: 0 } } } as unknown as ExecutiveAnalysis;
  const visible = text(renderToStaticMarkup(React.createElement(AnalysisContent, { data, nav: { ...nav, from: 'compare' }, seller: null })));
  assert.match(visible, /ต่างกัน \(ฝั่งแรกลบฝั่งที่สอง\)/); assert.match(visible, /-1,234\.50 บาท/); assert.match(visible, /—/); assert.doesNotMatch(visible, /NaN|Infinity|A ลบ B/);
});
test('each table names its first column for what its rows are, and differences use the Thai number format', async () => {
  const { AnalysisContent } = await content();
  const firstHeader = (html: string) => html.match(/<thead><tr><th[^>]*>([^<]*)<\/th>/)?.[1];
  const group = { key: 'IG', label: 'IG', companies: { count: 1, share: { value: 100, numerator: 1, denominator: 1 } }, companiesWithReceipts: count(1), paidEverCompanies: 1, activeCompanies: count(1), netReceiptsSatang: cash(100), drilldownFilters: { discovery: 'IG' } };
  const groups = (view: string) => renderToStaticMarkup(React.createElement(AnalysisContent, { data: { ...envelope, view, groups: [group] } as unknown as ExecutiveAnalysis, nav, seller: null }));
  assert.equal(firstHeader(groups('industry')), 'กลุ่มธุรกิจ');
  assert.equal(firstHeader(groups('discovery')), 'ช่องทาง');
  assert.equal(firstHeader(groups('sales')), 'เซลล์ผู้แนะนำ');
  const side = { key: 'A', label: 'ก', companies: count(1234), netReceiptsSatang: cash(0), netReceiptsPerCompanySatang: null, expenseReceiptCount: count(0), expenseReceiptsPerCompany: { value: 1.5 }, everAddedReceiptShare: { value: 50 }, activeCompanies: count(0), drilldownFilters: {} };
  const compare = renderToStaticMarkup(React.createElement(AnalysisContent, { data: { ...envelope, comparison: { sideA: side, sideB: { ...side, key: 'B' }, difference: { companies: 1234, netReceiptsSatang: 0, netReceiptsPerCompanySatang: null, expenseReceiptCount: 0, expenseReceiptsPerCompany: 0, everAddedReceiptShare: -12.5, activeCompanies: 0 } } } as unknown as ExecutiveAnalysis, nav: { ...nav, from: 'compare' }, seller: null }));
  assert.equal(firstHeader(compare), 'รายการ');
  assert.match(text(compare), /1,234 /); assert.match(text(compare), /0\.0 /); assert.match(text(compare), /-12\.5 จุด/);
});
test('a company without a registered name starts its line with the province, not with a separator', async () => {
  const { AnalysisContent, CompanyContent } = await content();
  const ranking = { metric: 'expenseReceiptCount', total: 1, coverage: 'complete', reasonCodes: [], drilldownFilters: {},
    items: [{ id: 'internal-company', displayName: 'ร้าน ก', registeredName: null, provinceLabel: 'เชียงใหม่', value: 3, rank: 1 }] };
  const ranked = text(renderToStaticMarkup(React.createElement(AnalysisContent, { data: { ...envelope, usageRanking: ranking } as unknown as ExecutiveAnalysis, nav, seller: null })));
  assert.match(ranked, /เชียงใหม่/); assert.doesNotMatch(ranked, /·\s+เชียงใหม่/);
  const detail = { ...envelope, company: { ...company, registeredName: null, ownerContact: { status: 'NOT_PERMITTED' }, businessTypeLabel: null, businessTypeOtherText: null, planEndsAt: null, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail;
  const head = text(renderToStaticMarkup(React.createElement(CompanyContent, { data: detail, tab: 'history', history: null, admin: false, nav, contactReadAt: '' })));
  assert.match(head, /เชียงใหม่ · ไม่ระบุ/); assert.doesNotMatch(head, /^\s*·/);
});
test('company contact values and labels disappear without permission and never fall back to supplied forbidden values', async () => {
  const { CompanyContent } = await content();
  const make = (status: ExecutiveCompanyDetail['company']['ownerContact']['status']) => ({ ...envelope, company: { ...company, ownerContact: { status, email: 'hidden@example.test', phoneNumber: '0812345678' }, businessTypeLabel: null, businessTypeOtherText: null, planEndsAt: null, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: ['NOT_YET_REGISTERED'] }) as unknown as ExecutiveCompanyDetail;
  const render = (status: ExecutiveCompanyDetail['company']['ownerContact']['status']) => text(renderToStaticMarkup(React.createElement(CompanyContent, { data: make(status), tab: 'company', history: null, admin: false, nav, contactReadAt: '2026-10-03T05:00:00Z' })));
  assert.doesNotMatch(render('NOT_PERMITTED'), /อีเมลเจ้าของบัญชี|เบอร์โทรเจ้าของบัญชี|hidden@example|0812345678/);
  assert.match(render('NOT_PERMITTED'), /บริษัทนี้ยังไม่สมัคร/);
  // UI spec §8.1, plain-language spec: a reader without the right sees that, instead of the two fields.
  assert.match(render('NOT_PERMITTED'), /ไม่มีสิทธิ์ดูข้อมูลติดต่อ/); assert.doesNotMatch(render('OK'), /ไม่มีสิทธิ์ดูข้อมูลติดต่อ/);
  assert.match(render('MULTIPLE_OWNERS'), /มีเจ้าของหลายบัญชี/); assert.doesNotMatch(render('MULTIPLE_OWNERS'), /hidden@example|0812345678/);
  assert.match(render('OK'), /hidden@example\.test/); assert.match(render('OK'), /ข้อมูลบัญชี ณ 3 ต\.ค\. 2569/);
});
test('the "other" detail of the signup channel shows only for a company that chose "อื่น ๆ"', async () => {
  const { CompanyContent } = await content();
  const make = (discovery: object) => ({ ...envelope, company: { ...company, discovery, ownerContact: { status: 'NOT_PERMITTED' }, businessTypeLabel: null, businessTypeOtherText: null, planEndsAt: null, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: [] }) as unknown as ExecutiveCompanyDetail;
  const render = (discovery: object) => text(renderToStaticMarkup(React.createElement(CompanyContent, { data: make(discovery), tab: 'company', history: null, admin: false, nav, contactReadAt: '' })));
  assert.doesNotMatch(render({ key: 'SALES', label: 'เซลล์ของมั่งมี' }), /อื่น ๆ/);
  assert.match(render({ key: 'OTHER', label: 'อื่น ๆ', otherText: 'งานอีเวนต์' }), /อื่น ๆ\s+งานอีเวนต์/);
  assert.match(render({ key: 'OTHER', label: 'อื่น ๆ' }), /อื่น ๆ\s+ไม่ระบุ/);
});
test('detail and compare content do not repeat the "no report filters" sentence the page already shows', async () => {
  const { CompanyContent, AnalysisContent } = await content();
  const detail = { ...envelope, company: { ...company, ownerContact: { status: 'NOT_PERMITTED' }, businessTypeLabel: null, businessTypeOtherText: null, planEndsAt: null, currentActiveMemberCount: 1, currentBranchCount: 1 }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail;
  const detailText = text(renderToStaticMarkup(React.createElement(CompanyContent, { data: detail, tab: 'company', history: null, admin: false, nav, contactReadAt: '' })));
  assert.doesNotMatch(detailText, /หน้านี้ไม่ใช้ตัวกรองของรายงาน/); assert.match(detailText, /ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่ม/);
  const side = { key: 'A', label: 'ก', companies: count(1), netReceiptsSatang: cash(0), netReceiptsPerCompanySatang: null, expenseReceiptCount: count(0), expenseReceiptsPerCompany: null, everAddedReceiptShare: null, activeCompanies: count(0), drilldownFilters: {} };
  const compareText = text(renderToStaticMarkup(React.createElement(AnalysisContent, { data: { ...envelope, comparison: { sideA: side, sideB: { ...side, key: 'B' }, difference: { companies: 0, netReceiptsSatang: 0, netReceiptsPerCompanySatang: null, expenseReceiptCount: 0, expenseReceiptsPerCompany: null, everAddedReceiptShare: null, activeCompanies: 0 } } } as unknown as ExecutiveAnalysis, nav: { ...nav, from: 'compare' }, seller: null })));
  assert.doesNotMatch(compareText, /หน้านี้ไม่ใช้ตัวกรองของรายงาน/); assert.match(compareText, /ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่ม/);
});
test('history shows only the event/date/plan allowlist and Buddhist dates', async () => {
  const { CompanyContent } = await content();
  const data = { ...envelope, company: { ...company, ownerContact: { status: 'NOT_PERMITTED' } }, month: null, monthReasonCodes: [] } as unknown as ExecutiveCompanyDetail;
  const history = { items: [{ kind: 'PACKAGE_RENEWED', at: '2026-09-30T05:00:00Z', planLabel: 'ร้านเติบโต', actorName: 'hidden-actor', reason: 'hidden-reason' }] } as unknown as ExecutiveCompanyHistory;
  const visible = text(renderToStaticMarkup(React.createElement(CompanyContent, { data, tab: 'history', history, admin: false, nav, contactReadAt: '' })));
  assert.match(visible, /ต่ออายุแพ็กเกจ ร้านเติบโต/); assert.match(visible, /30 ก\.ย\. 2569 12:00 น\./); assert.doesNotMatch(visible, /hidden-|PACKAGE_RENEWED|internal-company/);
});
test('small or incomplete spend groups show the reason instead of a fabricated group, while returned ties stay exact', async () => {
  const { AnalysisContent } = await content();
  const spend = { population: 9, positiveCompanyCount: 1, nonPositiveCount: 8, positiveNetTotalSatang: 100, signedNetTotalSatang: 100, negativeNetSatang: 0, receiptsWithoutPositiveNet: 0, topCount: null,
    restCount: null, restShare: null, topCompanyShare: null, prefix80CompanyShare: null, restCompanyShare: null, roundingNote: false, coverage: 'unavailable', reasonCodes: ['TOO_FEW_COMPANIES'], drilldownFilters: {} };
  const data = { ...envelope, spendConcentration: spend } as unknown as ExecutiveAnalysis;
  const small = text(renderToStaticMarkup(React.createElement(AnalysisContent, { data, nav, seller: null })));
  assert.match(small, /บริษัทน้อยเกินไปสำหรับการแบ่งกลุ่ม/); assert.doesNotMatch(small, /20% แรก|0\.00 บาท|จาก 9 บริษัท \(|หรือติดลบ/);
  const tied = { ...data, spendConcentration: { ...spend, topCount: 1, prefix80Count: 1, topShare: { value: 100 }, prefix80Share: { value: 100 }, restCount: 8, restShare: { value: 0 },
    topCompanyShare: { value: 11.1 }, prefix80CompanyShare: { value: 11.1 }, restCompanyShare: { value: 88.9 }, boundaryTie: { count: 7, netSatang: 299000 }, prefix80BoundaryTie: { count: 9, netSatang: 299000 }, coverage: 'complete', reasonCodes: [], drilldownFilters: { TOP20: {}, REST: {}, TO80: {}, BOUNDARY_TIE: {}, TO80_BOUNDARY_TIE: {} } } } as unknown as ExecutiveAnalysis;
  const visible = text(renderToStaticMarkup(React.createElement(AnalysisContent, { data: tied, nav, seller: null })));
  assert.match(visible, /มีอีก 7 บริษัท/); assert.match(visible, /มีอีก 9 บริษัท/); assert.match(visible, /2,990\.00 บาท/);
  assert.match(renderToStaticMarkup(React.createElement(AnalysisContent, { data: tied, nav, seller: null })), /role="group"/);
});

test('unavailable money never becomes zero in reconciliation; trend has a signed zero baseline and gaps', async () => {
  const { AnalysisContent } = await content();
  const moneyRow = { receiptsSatang: missing, refundsSatang: missing, netReceiptsSatang: missing, feesSatang: missing, taxSatang: missing };
  const data = { ...envelope, coverage: { ...envelope.coverage, money: { coverage: 'unavailable', reasonCodes: ['HISTORY_BEFORE_COLLECTION'] } }, revenue: { ...moneyRow, byPurchaseGroup: [{ key: 'FIRST_PURCHASE', label: 'ซื้อครั้งแรก', ...moneyRow }], disputedInvoiceCount: 0, trend: [{ month: '2026-09', isPartialMonth: false, ...moneyRow }] } } as unknown as ExecutiveAnalysis;
  const html = renderToStaticMarkup(React.createElement(AnalysisContent, { data, nav, seller: null }));
  assert.doesNotMatch(text(html), /0\.00 บาท/); assert.match(html, /y1="100" y2="100"/); assert.doesNotMatch(html, /<rect /);
});

test('a confirmed month without receipts says no money received rather than unknown payment', async () => {
  const { CompanyContent } = await content();
  const data = { ...envelope, coverage: { usage: { coverage: 'complete', reasonCodes: [] }, money: { coverage: 'complete', reasonCodes: [] } }, company: { ...company, ownerContact: { status: 'NOT_PERMITTED' }, expenseReceiptCountLifetime: 0 }, monthReasonCodes: [], month: { paidEver: { value: 'NO' }, usageGroup: 'NOT_PAID', paidInMonth: false, positiveNetInMonth: false, fullyRefunded: false, usage: { activeDays: 0, activeDaysLine: 0, activeDaysWeb: 0, activeUsers: 0, activeUsersLine: 0, activeUsersWeb: 0, documents: 0, aiRequests: 0, expenseReceiptCountInPeriod: 0, expenseReceiptsLine: 0, expenseReceiptsWeb: 0 }, money: { receiptsSatang: cash(0), refundsSatang: cash(0), netReceiptsSatang: cash(0), feesSatang: cash(0), taxSatang: cash(0), aiCostSatang: cash(0) } } } as unknown as ExecutiveCompanyDetail;
  const visible = text(renderToStaticMarkup(React.createElement(CompanyContent, { data, tab: 'usage', history: null, admin: false, nav, contactReadAt: '' })));
  assert.match(visible, /ไม่มีเงินรับในเดือน/); assert.match(visible, /ยอดรับไม่มากกว่ายอดคืนในเดือน/);
  assert.doesNotMatch(visible, /ยอดเฉพาะรายการที่ยืนยันแล้ว/);
});

test('spend groups show each group as the backend counts it: companies of all, share of the weight, and the companies at 0 or below', async () => {
  const { AnalysisContent } = await content();
  const ratio = (value: number) => ({ value, numerator: 0, denominator: 0 });
  const spend = {
    population: 16, positiveCompanyCount: 8, nonPositiveCount: 8, positiveNetTotalSatang: 1872543, signedNetTotalSatang: 1822643, negativeNetSatang: -49900, receiptsWithoutPositiveNet: 1,
    topTargetCount: 4, topCount: 4, topShare: ratio(74.6), prefix80Count: 5, prefix80Share: ratio(90.6), restCount: 12, restShare: ratio(25.4),
    topCompanyShare: ratio(25), prefix80CompanyShare: ratio(31.3), restCompanyShare: ratio(75), roundingNote: false,
    boundaryTie: { count: 1, netSatang: 299000 }, prefix80BoundaryTie: { count: 0, netSatang: 299000 }, periodBasis: 'SELECTED_MONTH', coverage: 'complete', reasonCodes: [],
    drilldownFilters: { TOP20: { spendCohort: 'TOP20' }, REST: { spendCohort: 'REST' }, TO80: { spendCohort: 'TO80' }, BOUNDARY_TIE: { spendCohort: 'BOUNDARY_TIE' }, TO80_BOUNDARY_TIE: { spendCohort: 'TO80_BOUNDARY_TIE' } },
  };
  const render = (figures: Partial<typeof spend>) => text(renderToStaticMarkup(React.createElement(AnalysisContent, { data: { ...envelope, spendConcentration: { ...spend, ...figures } } as unknown as ExecutiveAnalysis, nav, seller: null })));
  const visible = render({});
  for (const words of ['ลูกค้าที่จ่ายสูงสุด 20% แรก · 4 จาก 16 บริษัท (25.0%) · 74.6% ของยอดที่ใช้คำนวณสัดส่วน', 'ลูกค้านอกกลุ่มที่จ่ายสูงสุด 20% แรก · 12 จาก 16 บริษัท (75.0%) · 25.4% ของยอดที่ใช้คำนวณสัดส่วน',
    'บริษัทที่รวมยอดรับถึง 80% · 5 จาก 16 บริษัท (31.3%) · 90.6% ของยอดที่ใช้คำนวณสัดส่วน', 'ยอดรับสุทธิในเดือนเป็น 0 หรือติดลบ 8 บริษัท']) assert.ok(visible.includes(words), words);
  assert.doesNotMatch(visible, /เพราะการปัดเศษ/);
  assert.match(render({ roundingNote: true }), /ผลรวมไม่เท่ากับ 100\.0% เพราะการปัดเศษ/);
  assert.doesNotMatch(render({ nonPositiveCount: 0 }), /หรือติดลบ/);
});

test('the measured AI cost keeps its own coverage: what was measured is not the whole month, and a month before measuring has no figure', async () => {
  const { CompanyContent } = await content();
  const month = { paidEver: { value: 'YES' }, usageGroup: 'ACTIVE', paidInMonth: true, positiveNetInMonth: true, fullyRefunded: false,
    usage: { activeDays: 1, activeDaysLine: 0, activeDaysWeb: 1, activeUsers: 1, activeUsersLine: 0, activeUsersWeb: 1, documents: 1, aiRequests: 0, expenseReceiptCountInPeriod: 1, expenseReceiptsLine: 0, expenseReceiptsWeb: 1 },
    money: { receiptsSatang: cash(500000), refundsSatang: cash(0), netReceiptsSatang: cash(500000), feesSatang: cash(1000), taxSatang: cash(0) } };
  const cost = (aiCostSatang: ExecutiveMoney) => {
    const data = { ...envelope, company: { ...company, ownerContact: { status: 'NOT_PERMITTED' } }, monthReasonCodes: [], month: { ...month, money: { ...month.money, aiCostSatang } } } as unknown as ExecutiveCompanyDetail;
    const html = renderToStaticMarkup(React.createElement(CompanyContent, { data, tab: 'usage', history: null, admin: false, nav, contactReadAt: '' }));
    return text(/<dt[^>]*>ต้นทุนผู้ช่วยและการอ่านใบเสร็จที่วัดได้<\/dt><dd[^>]*>(.*?)<\/dd>/.exec(html)?.[1] ?? '');
  };
  assert.match(cost(cash(1234)), /12\.34 บาท/);
  const partial = cost({ value: null, knownValue: 1234, coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_COLLECTION'], currency: 'THB' });
  assert.match(partial, /12\.34 บาท \(ยอดเฉพาะรายการที่ยืนยันแล้ว\)/); assert.match(partial, /ก่อนที่ระบบเริ่มเก็บ/);
  const before = cost(missing);
  assert.match(before, /—/); assert.match(before, /ก่อนที่ระบบเริ่มเก็บ/); assert.doesNotMatch(before, /บาท/);
});

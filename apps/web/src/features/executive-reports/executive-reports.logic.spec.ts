import assert from 'node:assert/strict';
import test from 'node:test';
import { EXECUTIVE_REPORT_LABELS, EXECUTIVE_SORT_OPTIONS, EXECUTIVE_REASON_CODES, EXECUTIVE_PAID_EVER_REASONS, type ExecutiveContext } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '../../common/api/api-error-message';

const logic = () => import('./executive-reports.logic');
const context = {
  defaultMonth: '2026-10', currentMonth: '2026-10', months: { first: '2026-09', last: '2026-10' },
  filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])),
  sortOptions: EXECUTIVE_SORT_OPTIONS,
} as ExecutiveContext;

test('URL defaults reject unknown values, future months, malformed pages and sort orders', async () => {
  const { reportQuery } = await logic();
  const q = reportQuery('companies', new URLSearchParams('month=2027-01&filter_industry=secret&page=2x&sortBy=bad&sortDir=bad'), context);
  assert.deepEqual(q, { month: '2026-10', industry: 'ALL', discovery: 'ALL', referringSales: 'ALL', sortBy: 'joinedAt', sortDir: 'desc', page: 1, pageSize: 20 });
});
test('URL aliases send the API filters, ranking, tabs, sort and paging without leaking a URL search', async () => {
  const { reportQuery } = await logic();
  const params = new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK&filter_usage=NOT_STARTED&filter_receipt=UNKNOWN&sortBy=activeDays&page=3&q=private');
  const q = reportQuery('companies', params, context, '  ร้าน ก  ');
  assert.equal(q.discovery, 'FACEBOOK'); assert.equal(q.usageGroup, 'NOT_STARTED'); assert.equal(q.receiptAdoption, 'UNKNOWN');
  assert.equal(q.sortDir, 'desc'); assert.equal(q.page, 3); assert.equal(q.q, 'ร้าน ก');
  assert.deepEqual(reportQuery('usage', new URLSearchParams('view=ranking&rank=aiRequests'), context), { month: '2026-10', industry: 'ALL', discovery: 'ALL', referringSales: 'ALL', section: 'usage', view: 'ranking', metric: 'aiRequests' });
});
test('menus carry only the report context; compare and detail retain but do not send global filters', async () => {
  const { menuHref, reportQuery } = await logic();
  const p = new URLSearchParams('month=2026-09&filter_industry=UNKNOWN&filter_discovery=FACEBOOK&filter_sales=NONE&view=top&page=3&pick=bad&buildId=secret');
  assert.equal(menuHref('usage', p), '/system/executive/usage?month=2026-09&filter_industry=UNKNOWN&filter_discovery=FACEBOOK&filter_sales=NONE');
  assert.deepEqual(reportQuery('detail', p, context), { month: '2026-09' });
  p.set('by', 'discovery'); p.set('a', 'FACEBOOK'); p.set('b', 'OTHER');
  assert.deepEqual(reportQuery('compare', p, context), { month: '2026-09', section: 'compare', dimension: 'discovery', sideA: 'FACEBOOK', sideB: 'OTHER' });
});
test('a drill-down uses the COMPLETE API query without merging the origin globals', async () => {
  const { drilldownHref, reportQuery } = await logic();
  const origin = new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK&view=top&page=9');
  const href = drilldownHref(origin, 'compare', { discovery: 'OTHER', sortBy: 'netReceipts', sortDir: 'desc' });
  const p = new URL(href, 'https://test.invalid').searchParams;
  assert.equal(p.get('filter_discovery'), 'FACEBOOK'); assert.equal(p.get('from'), 'compare'); assert.equal(p.has('buildId'), false);
  assert.deepEqual(reportQuery('companies', p, context), { month: '2026-09', discovery: 'OTHER', sortBy: 'netReceipts', sortDir: 'desc', page: 1, pageSize: 20 });
  const blank = new URL(drilldownHref(origin, 'overview', {}), 'https://test.invalid').searchParams;
  assert.deepEqual(reportQuery('companies', blank, context), { month: '2026-09', sortBy: 'joinedAt', sortDir: 'desc', page: 1, pageSize: 20 });
});
test('changing filters or sort resets paging; clearing keeps the month and removes drilled conditions', async () => {
  const { changedParams, clearedParams } = await logic();
  const p = new URLSearchParams('month=2026-09&page=7&filter_industry=UNKNOWN&pick=paidInPeriod%3Dtrue&sortBy=netReceipts&sortDir=desc');
  assert.equal(changedParams(p, { filter_industry: 'ALL' }).get('page'), '1');
  assert.equal(changedParams(p, { sortBy: 'companyName' }).get('page'), '1');
  assert.equal(changedParams(p, { page: '2' }).get('page'), '2');
  const drilled = new URLSearchParams('month=2026-09&pick=discovery%3DOTHER%26spendCohort%3DTOP20');
  const changed = changedParams(drilled, { filter_discovery: 'FACEBOOK' });
  assert.equal(reportQueryForChanged(await logic(), changed).discovery, 'FACEBOOK');
  assert.equal(reportQueryForChanged(await logic(), changed).spendCohort, 'TOP20');
  assert.equal(clearedParams(p).toString(), 'month=2026-09&filter_industry=ALL&filter_discovery=ALL&filter_sales=ALL');
});
const reportQueryForChanged = (module: Awaited<ReturnType<typeof logic>>, params: URLSearchParams) => module.reportQuery('companies', params, context);
test('invalid compare sides never request an invented pair; side swapping changes only the sides', async () => {
  const { comparisonProblem, swappedParams } = await logic();
  assert.equal(comparisonProblem(new URLSearchParams(), context), 'choose');
  assert.equal(comparisonProblem(new URLSearchParams('by=industry&a=UNKNOWN&b=UNKNOWN'), context), 'same');
  assert.equal(comparisonProblem(new URLSearchParams('by=discovery&a=secret&b=OTHER'), context), 'choose');
  assert.equal(comparisonProblem(new URLSearchParams('by=company&a=one&b=two'), context), null);
  const p = swappedParams(new URLSearchParams('by=company&a=one&b=two&month=2026-09&filter_discovery=OTHER'));
  assert.equal(p.get('a'), 'two'); assert.equal(p.get('b'), 'one'); assert.equal(p.get('filter_discovery'), 'OTHER');
});
test('counts preserve partial/unknown/true zero and money never calls partial an at-least amount', async () => {
  const { countText, moneyText } = await logic();
  assert.equal(countText({ value: null, knownValue: 38, coverage: 'partial', reasonCodes: [] }), 'อย่างน้อย 38');
  assert.equal(countText({ value: null, knownValue: 0, coverage: 'partial', reasonCodes: [] }), 'อย่างน้อย 0');
  assert.equal(countText({ value: null, coverage: 'unavailable', reasonCodes: [] }), '—');
  assert.equal(countText({ value: 0, coverage: 'complete', reasonCodes: [] }), '0');
  assert.equal(moneyText({ value: null, knownValue: 123450, coverage: 'partial', reasonCodes: [], currency: 'THB' }), '1,234.50 บาท (ยอดเฉพาะรายการที่ยืนยันแล้ว)');
  assert.equal(moneyText({ value: null, coverage: 'unavailable', reasonCodes: [], currency: 'THB' }), '—');
});
test('satang, negative amounts, rounded ratios and Buddhist dates have one Thai format', async () => {
  const { money, ratioText, reportMonth, reportDate, reportDateTime } = await logic();
  assert.equal(money(-123450), '-1,234.50 บาท'); assert.equal(money(1), '0.01 บาท'); assert.equal(money(99999999900), '999,999,999.00 บาท');
  assert.equal(ratioText({ value: 83.4, numerator: 834, denominator: 1000 }), '83.4%'); assert.equal(ratioText(null), '—');
  assert.equal(reportMonth('2026-09'), 'ก.ย. 2569'); assert.equal(reportDate('2026-09-30T05:00:00Z'), '30 ก.ย. 2569');
  assert.equal(reportDateTime('2026-09-30T05:00:00Z'), '30 ก.ย. 2569 12:00 น.');
});
test('every reason and paid-ever sub-reason has reviewed Thai words, including field-level errors', async () => {
  for (const code of new Set([...EXECUTIVE_REASON_CODES, ...EXECUTIVE_PAID_EVER_REASONS, 'EXECUTIVE_ACCESS_DENIED', 'EXECUTIVE_QUERY_INVALID', 'COMPANY_NOT_FOUND', 'SOURCE_UNAVAILABLE'])) {
    const words = apiErrorMessage({ code });
    assert.match(words, /[ก-๙]/, code); assert.doesNotMatch(words, /[A-Za-z_]/, code); assert.notEqual(words, 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง', code);
  }
  const { queryFieldErrors } = await logic();
  const e = { code: 'EXECUTIVE_QUERY_INVALID', details: { fieldErrors: { month: ['secret English'], sideB: ['INVALID'] } } };
  assert.deepEqual(queryFieldErrors(e), { month: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่', sideB: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่' });
});
test('build changes reload exactly once even if the next build changes again', async () => {
  const { readCurrentBuild } = await logic();
  const calls: Array<string | undefined> = [];
  const result = await readCurrentBuild(async (buildId) => { calls.push(buildId); return { build: { id: `build-${calls.length}` }, buildChanged: true }; }, 'old');
  assert.deepEqual(calls, ['old', 'build-1']); assert.equal(result.data.build.id, 'build-2'); assert.equal(result.changed, true);
});
test('403 clears data, no-build 503 is no data yet, and other failures stay errors', async () => {
  const { reportFailure } = await logic();
  assert.equal(reportFailure({ status: 403 }).kind, 'denied');
  assert.equal(reportFailure({ status: 404, code: 'COMPANY_NOT_FOUND' }).kind, 'notFound');
  assert.equal(reportFailure({ status: 503, code: 'SOURCE_UNAVAILABLE' }).kind, 'noData');
  assert.equal(reportFailure({ status: 503 }).kind, 'error');
});

test('context source failure is an error, while a failed history read preserves only permitted loaded company data', async () => {
  const { reportFailure, keepLoadedReport } = await logic();
  const unavailable = { status: 503, code: 'SOURCE_UNAVAILABLE' };
  assert.deepEqual(reportFailure(unavailable, false), { kind: 'error', text: 'ระบบยังอ่านข้อมูลส่วนนี้ไม่ได้ กรุณาลองใหม่ภายหลัง' });
  assert.equal(keepLoadedReport(unavailable, false), false);
  assert.equal(keepLoadedReport(unavailable, true), true);
  assert.equal(keepLoadedReport({ status: 500 }, true), true);
  assert.equal(keepLoadedReport({ status: 403 }, true), false);
  assert.equal(keepLoadedReport({ code: 'COMPANY_NOT_FOUND', status: 404 }, true), false);
});
test('row counters honour source coverage, and contact fields require an OK payload', async () => {
  const { sourceCount, sourceMoney, contactFields } = await logic();
  assert.equal(sourceCount(0, { coverage: 'partial', reasonCodes: ['ACTIVITY_HISTORY_INCOMPLETE'] }).knownValue, 0);
  assert.equal(sourceMoney(99, { coverage: 'unavailable', reasonCodes: [] }).value, null);
  assert.deepEqual(contactFields({ status: 'NOT_PERMITTED', email: 'hidden', phoneNumber: 'hidden' }), []);
  assert.deepEqual(contactFields({ status: 'OK', email: null, phoneNumber: '0812345678' }), [['email', 'ยังไม่มีข้อมูล'], ['phoneNumber', '0812345678']]);
});
test('tie sentences use returned counts only, omit zero ties, and negative money is explained', async () => {
  const { rankingTieText, spendTieText, negativeMoneyNote } = await logic();
  assert.equal(rankingTieText({ count: 3, value: 12 }, 'expenseReceiptCount'), 'มีอีก 3 บริษัทที่ค่าเท่ากับอันดับสุดท้ายที่แสดง (12 ใบ)');
  assert.equal(spendTieText({ count: 7, netSatang: 299000 }), 'มีอีก 7 บริษัทที่จ่ายเท่ากับลำดับสุดท้ายของกลุ่ม (2,990.00 บาท) แต่อยู่นอกกลุ่ม');
  assert.equal(spendTieText({ count: 0, netSatang: 1 }), null); assert.equal(rankingTieText(undefined, 'activeDays'), null);
  assert.equal(negativeMoneyNote(-1), 'คืนเงินมากกว่าเงินรับ'); assert.equal(negativeMoneyNote(0), null);
});

test('sort wording follows the actual direction including direct URLs with reverse order', async () => {
  const { sortLabel } = await logic();
  assert.equal(sortLabel('netReceipts', 'asc'), 'ยอดรับสุทธิในเดือน น้อย → มาก');
  assert.equal(sortLabel('companyName', 'desc'), 'ชื่อบริษัท ฮ → ก');
  assert.equal(sortLabel('joinedAt', 'asc'), 'สมัครเก่าสุดก่อน');
});
test('rate-limit retry time uses only a valid returned number and never a diagnostic', async () => {
  const { retryDelaySeconds } = await logic();
  assert.equal(retryDelaySeconds({ status: 429, details: { retryAfterSeconds: 31 } }), 31);
  for (const value of [0, -1, 'secret', 1.2, NaN]) assert.equal(retryDelaySeconds({ status: 429, details: { retryAfterSeconds: value } }), 0);
  assert.equal(retryDelaySeconds({ status: 500, details: { retryAfterSeconds: 31 } }), 0);
});
test('back keeps the source history entry across filter/page pushes and names the actual source screen', async () => {
  const { reportHistoryState, ownHistoryState, backSection } = await logic();
  const source = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'], executiveBack: '/system/executive/compare?by=company&a=one&b=two', executiveBackDistance: 1 };
  const next = reportHistoryState(source, 'ร้าน ก', false);
  // A state that still carries Next's own keys is taken by Next's patched pushState for its own call: the router would keep the old URL.
  assert.equal(next.__NA, undefined); assert.equal(next.__PRIVATE_NEXTJS_INTERNALS_TREE, undefined);
  assert.deepEqual(ownHistoryState({ ...source, _N: true }), { executiveBack: source.executiveBack, executiveBackDistance: 1 });
  assert.deepEqual(ownHistoryState(null), {});
  assert.equal(next.executiveBack, source.executiveBack); assert.equal(next.executiveBackDistance, 2); assert.equal(next.executiveSearch, 'ร้าน ก');
  assert.equal(reportHistoryState(next, '', true).executiveBackDistance, 2);
  assert.equal(reportHistoryState(next, '', true).executiveSearch, '');
  assert.equal(backSection(source.executiveBack), 'compare');
  assert.equal(backSection('/system/executive/usage?view=ranking'), 'usage');
  assert.equal(backSection('/system/executive/companies/internal'), 'detail');
});

test('screen labels translate product words and omit returned seller codes and environment tokens', async () => {
  const { thaiLabel } = await import('./executive-reports.words');
  assert.equal(thaiLabel('สมัครทาง LINE'), 'สมัครทางไลน์');
  assert.equal(thaiLabel('Facebook / IG / TikTok / Website'), 'เฟซบุ๊ก / อินสตาแกรม / ติ๊กต็อก / เว็บไซต์');
  assert.equal(thaiLabel('คุณฟ้า · S003', 'S003'), 'คุณฟ้า');
  assert.equal(thaiLabel('S003', 'S003'), 'ไม่ระบุ');
  assert.equal(thaiLabel('ระบบทดสอบ UAT'), 'ระบบทดสอบ');
  assert.equal(thaiLabel('ตั้งค่า LINE'), 'ตั้งค่า ไลน์');
  assert.equal(thaiLabel('เพดานความปลอดภัยค่า AI'), 'เพดานความปลอดภัยค่าปัญญาประดิษฐ์');
});

test('drilled condition chips use the same Thai words without showing a seller code or sort token', async () => {
  const { drillLabels } = await logic();
  const named = { ...context, filters: { ...context.filters, referringSales: [{ value: 'S003', label: 'คุณฟ้า · S003' }] } };
  assert.deepEqual(drillLabels({ referringSales: 'S003', discovery: 'FACEBOOK', paidInPeriod: 'true', sortBy: 'netReceipts', sortDir: 'desc' }, named), ['คุณฟ้า', 'เฟซบุ๊ก', 'ชำระในเดือน']);
});

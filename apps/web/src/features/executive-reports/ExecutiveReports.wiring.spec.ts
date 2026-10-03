import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const source = (path: string) => { const p = fileURLToPath(new URL(path, import.meta.url)); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };

test('all seven report routes render the real report page and detail uses targetCompanyId', () => {
  for (const route of ['', '/companies', '/usage', '/revenue', '/customers', '/compare', '/companies/[targetCompanyId]']) {
    assert.match(source(`../../../app/system/executive${route}/page.tsx`), /ExecutiveReportPage/, route);
  }
  assert.match(source('../../../app/system/executive/companies/[targetCompanyId]/page.tsx'), /await params/);
});
test('the system shell and report gate use the exact permission, and the header has report links only for readers', () => {
  assert.match(source('../../../app/system/layout.tsx'), /canOpenSystemExecutive/);
  assert.match(source('../../../app/system/executive/layout.tsx'), /system\.executive\.read/);
  const header = source('../../common/components/app-shell/SystemHeader.tsx');
  assert.match(header, /executiveAllowed/); assert.match(header, /EXECUTIVE_MENU/); assert.match(header, /menuHref/);
  assert.match(header, /useOpenSupportCount\(pathname, !billingOnly && !executiveOnly\)/);
  assert.match(header, /EXECUTIVE_ACCESS_DENIED_EVENT/);
  assert.match(header, /thaiLabel\(environment\)/);
  assert.match(header, /thaiLabel\(section.label\)/);
  // Report routes only: '/system/executive-users' (an admin page) keeps the admin console's own menu words.
  assert.doesNotMatch(header, /pathname\.startsWith\('\/system\/executive'\)/);
});
test('reads use authenticated fetch, no tenant target header, and reload/abort protect the entire answer', () => {
  const api = source('./executive-reports.api.ts'), page = source('./ExecutiveReportPage.tsx');
  assert.match(api, /authedApiFetch/); assert.match(api, /cache: 'no-store'/); assert.doesNotMatch(api, /X-Company-Id|fixture/i);
  assert.match(page, /AbortController/); assert.match(page, /signal\.aborted/); assert.match(page, /readCurrentBuild/);
  assert.match(page, /SOURCE_STALE/); assert.match(page, /setData\(null\)/); assert.match(page, /CoverLoader/);
  assert.match(page, /keepLoadedReport/);
  assert.match(page, /retry: retryWait > 0 \? undefined/);
  assert.ok(page.indexOf('setData(result.data)') < page.indexOf('await getExecutiveHistory'));
});
test('a build change refreshes provider context without turning its new object into another report reload', () => {
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /shared\.refresh\(controller.signal\)/);
  assert.match(page, /setContext\(result\)/);
  assert.match(page, /const queryKey =/);
  assert.doesNotMatch(page, /\}, \[context, section/);
});
test('context refresh failures use context error handling rather than claiming the month has no data', () => {
  const page = source('./ExecutiveReportPage.tsx');
  const refresh = page.slice(page.indexOf('async function refresh('), page.indexOf('useEffect(() => {', page.indexOf('async function refresh(')));
  assert.match(refresh, /reportFailure\(error, false\)/);
  assert.match(refresh, /setFailure\(failed\)/);
  assert.match(refresh, /signal.aborted/);
});
test('system and sales denial gates select report wording for executive-only sessions', () => {
  for (const route of ['system', 'sales']) {
    assert.match(source(`../../../app/${route}/layout.tsx`), /<SystemAccessDenied executive=\{result.status === 'signed_in' && isExecutiveOnlySession\(result.session\)\}/);
  }
});
test('directory chips hide empty drill rows and each filter toggle names its own scope', async () => {
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /reportFilterChips/);
  assert.match(page, /pickLabels.length > 0 &&/);
  assert.match(page, /\{W.reportFilters\} · \{filterCount\}/);
  assert.match(page, /\{W.companyFilters\} · \{DIRECTORY_FILTERS/);
  const { W } = await import('./executive-reports.words');
  assert.equal(W.reportFilters, 'ตัวกรองรายงาน'); assert.equal(W.companyFilters, 'ตัวกรองรายชื่อบริษัท');
});
test('Thai shared fields, all detail tabs, history paging and responsive tables are wired without exports', () => {
  const all = source('./ExecutiveReportPage.tsx') + source('./ExecutiveReportContent.tsx') + source('./executive-reports.words.ts');
  for (const component of ['MangmeePage', 'MangmeeCard', 'MangmeeStatCard', 'MangmeeBadge', 'TextField', 'SelectField', 'ThemedDate', 'Pagination', 'ForbiddenState']) assert.match(all, new RegExp(component));
  assert.match(all, /allowClear=\{false\}/); assert.match(all, /selectable=\{context\.builtMonths\}/); assert.match(all, /table-fixed/); assert.match(all, /md:hidden/); assert.match(all, /hidden[^"\n]*md:table/);
  assert.match(all, /ExecutiveCompanyHistory/); assert.match(all, /EXECUTIVE_HISTORY_EVENT_LABELS/);
  assert.doesNotMatch(all, /mangmee-table-scroll|<select\b|<textarea\b|export=1|ส่งออก|data-rights|localStorage/);
});
test('search stays in the history entry with a 300ms debounce, back has a direct-link fallback', () => {
  const page = source('./ExecutiveReportPage.tsx');
  assert.match(page, /executiveSearch/); assert.match(page, /300/); assert.match(page, /popstate/);
  assert.match(page, /history\.back\(\)/); assert.match(page, /router\.push\(fallback\)/);
  assert.match(page, /navigateParams\(clearedParams\(params\), false, ''\)/);
  // A change the reader makes keeps only our own history keys, so Next's router (useSearchParams) follows it.
  assert.match(page, /const state = reportHistoryState\(window\.history\.state, searchValue, replace\)/);
  assert.match(page, /replaceState\(\{ \.\.\.ownHistoryState\(window\.history\.state\), executiveSearch: term \}, '', `/);
});

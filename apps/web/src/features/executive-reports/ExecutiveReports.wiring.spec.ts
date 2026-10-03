import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { EXECUTIVE_WORDS as sharedWords, executiveThaiLabel } from '@watchdog-bms/contracts';
import { W, thaiLabel } from './executive-reports.words';
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
test('Thai shared fields, detail tabs, history paging and responsive tables retain the permission-gated export panel', () => {
  const all = source('./ExecutiveReportPage.tsx') + source('./ExecutiveReportContent.tsx') + source('./executive-reports.words.ts');
  for (const component of ['MangmeePage', 'MangmeeCard', 'MangmeeStatCard', 'MangmeeBadge', 'TextField', 'SelectField', 'ThemedDate', 'Pagination', 'ForbiddenState']) assert.match(all, new RegExp(component));
  assert.match(all, /allowClear=\{false\}/); assert.match(all, /selectable=\{context\.builtMonths\}/); assert.match(all, /table-fixed/); assert.match(all, /md:hidden/); assert.match(all, /hidden[^"\n]*md:table/);
  assert.match(all, /ExecutiveCompanyHistory/); assert.match(all, /EXECUTIVE_HISTORY_EVENT_LABELS/);
  assert.doesNotMatch(all, /mangmee-table-scroll|<select\b|<textarea\b|data-rights|localStorage/);
  assert.match(all, /canExport\(context\) && !exportOpen/);
  assert.match(all, /exportOpen && context && visibleData && <ExecutiveExportPanel/);
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

// Execute the page's actual setup, normalization and close handler with a history stub;
// compare its actual effect dependencies without needing a browser or a React renderer.
async function pageTransitions(section: string, params: URLSearchParams, context: unknown, window: unknown) {
  const file = ts.createSourceFile('page.tsx', source('./ExecutiveReportPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration;
  const statements = page.body!.statements;
  const setup = statements.slice(0, statements.findIndex(ts.isFunctionDeclaration)).map(node => node.getText(file)).join('\n');
  const effects = statements.filter(ts.isExpressionStatement).map(node => node.expression).filter(ts.isCallExpression).filter(node => node.expression.getText(file) === 'useEffect');
  const normalize = effects.find(node => node.arguments[0]!.getText(file).includes("next.delete('q')"))!;
  const read = effects.find(node => node.arguments[0]!.getText(file).includes('readCurrentBuild'))!;
  const close = statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(file) === 'closeExport')!;
  const logic = await import('./executive-reports.logic');
  const { DETAIL_TABS } = await import('./executive-reports.words');
  const { canExport } = await import('./executive-export.logic');
  const deps = { ...logic, DETAIL_TABS, canExport, section, targetCompanyId: undefined, window, Context: {},
    useContext: () => ({ context }), usePathname: () => '/system/executive', useRouter: () => ({}), useSearchParams: () => params,
    useState: (value: unknown) => [value, () => {}], useRetryWait: () => [0, () => {}], useCallback: (fn: unknown) => fn };
  const js = ts.transpileModule(`${setup}\nreturn { requestKey, exportOpen, normalize: ${normalize.arguments[0]!.getText(file)}, dependencies: ${read.arguments[1]!.getText(file)}, close: ${close.initializer!.getText(file)} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}`)(deps);
}

const exportContext = async (allowed = true) => {
  const { EXECUTIVE_REPORT_LABELS } = await import('@watchdog-bms/contracts');
  return { currentMonth: '2026-10', defaultMonth: '2026-10', builtMonths: ['2026-09'],
    capabilities: { readReport: { allowed: true }, export: { allowed } }, filters: Object.fromEntries(Object.entries(EXECUTIVE_REPORT_LABELS).map(([key, labels]) => [key, Object.entries(labels).map(([value, label]) => ({ value, label }))])) };
};

test('normalization keeps only an allowed export flag and stays URL-only for a single report read', async () => {
  for (const [flag, allowed, kept] of [['1', true, '1'], ['1', false, null], ['2', true, null], ['', true, null]] as const) {
    const params = new URLSearchParams({ month: '2026-09', export: flag, q: 'private', buildId: 'old' });
    const state = { __NA: true };
    let replaced = '';
    const window = { history: { state, replaceState: (nextState: unknown, _: string, href: string) => { assert.equal(nextState, state); replaced = href; } } };
    const page = await pageTransitions('overview', params, await exportContext(allowed), window);
    page.normalize();
    const next = new URL(replaced, 'https://test.invalid').searchParams;
    assert.equal(next.get('export'), kept); assert.equal(next.has('q'), false); assert.equal(next.has('buildId'), false);
    assert.equal(next.get('month'), '2026-09'); assert.equal(next.get('filter_industry'), 'ALL');
  }
});

test('opening/closing export and refreshing built months preserve report identity and read dependencies on every screen', async () => {
  const context = await exportContext();
  for (const section of ['overview', 'companies', 'usage', 'revenue', 'customers', 'compare', 'detail']) {
    const params = new URLSearchParams('month=2026-09&filter_discovery=FACEBOOK&page=3&by=industry&a=ALL&b=UNKNOWN&tab=history');
    const closed = await pageTransitions(section, params, context, {});
    params.set('export', '1');
    let normalized = params;
    const open = await pageTransitions(section, params, context, { history: { state: { __NA: true }, replaceState: (_: unknown, __: string, href: string) => { normalized = new URL(href, 'https://test.invalid').searchParams; } } });
    assert.equal(open.exportOpen, true); assert.equal(closed.exportOpen, false);
    assert.equal(open.requestKey, closed.requestKey, section); assert.deepEqual(open.dependencies, closed.dependencies, section);
    const refreshed = await pageTransitions(section, params, { ...context, builtMonths: ['2026-09', '2026-10'] }, {});
    assert.deepEqual(refreshed.dependencies, open.dependencies, section);
    open.normalize(); // Closing reads the browser URL, which already contains normalized defaults.
    normalized.delete('export');
    const afterClose = await pageTransitions(section, normalized, context, {});
    assert.equal(afterClose.requestKey, closed.requestKey, section);
    assert.deepEqual(afterClose.dependencies, closed.dependencies, section);
    params.delete('export');
    assert.deepEqual((await pageTransitions(section, params, context, {})).dependencies, closed.dependencies, section);
    if (section === 'companies' || section === 'detail') {
      params.set('page', '4');
      assert.notDeepEqual((await pageTransitions(section, params, context, {})).dependencies, closed.dependencies, section);
      params.set('page', '3');
    }
    params.set('month', '2026-10');
    assert.notDeepEqual((await pageTransitions(section, params, context, {})).dependencies, closed.dependencies, section);
  }
});

test('closing export updates Next router state while preserving the report URL, search and back entry', async () => {
  const params = new URLSearchParams('month=2026-09&page=3&pick=discovery%3DOTHER&export=1');
  const state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'], executiveSearch: 'ร้าน', executiveBack: '/system/executive', executiveBackDistance: 2 };
  let routerUrl = `/system/executive/companies?${params}`;
  const window = { location: { pathname: '/system/executive/companies', search: `?${params}` }, history: { state, replaceState: (next: Record<string, unknown>, _: string, href: string) => {
    // Next ignores its own __NA/_N state; only a user action updates useSearchParams.
    if (!next.__NA && !next._N) routerUrl = href;
    assert.deepEqual(next, { executiveSearch: state.executiveSearch, executiveBack: state.executiveBack, executiveBackDistance: state.executiveBackDistance });
  } } };
  const page = await pageTransitions('companies', params, await exportContext(), window);
  page.close();
  params.delete('export');
  assert.equal(routerUrl, `/system/executive/companies?${params}`);
});

test('web re-exports one shared words source including later report polish and state-aware reasons', async () => {
  assert.equal(W, sharedWords); assert.equal(thaiLabel, executiveThaiLabel);
  assert.deepEqual([W.reportFilters, W.companyFilters, W.unavailableFigure, W.rank, W.item, W.yes, W.partialMeasuredMoney, W.contactNotPermitted],
    ['ตัวกรองรายงาน', 'ตัวกรองรายชื่อบริษัท', 'ยังไม่มีตัวเลข', 'อันดับ', 'รายการ', 'ใช่', 'ยอดเฉพาะช่วงที่วัดได้', 'ไม่มีสิทธิ์ดูข้อมูลติดต่อ']);
  assert.equal(W.reasonReference(2), 'ดูเหตุผลข้อ 2');
  assert.equal(W.yes, W.export.yes); assert.equal(W.rank, W.export.rank);
  assert.equal(thaiLabel('IG', 'IG'), 'อินสตาแกรม');
  const { executiveReasonMessage } = await import('../../common/api/api-error-message');
  assert.equal(executiveReasonMessage('HISTORY_BEFORE_COLLECTION', 'partial'), W.historyBeforeCollectionPartial);
  assert.equal(executiveReasonMessage('HISTORY_BEFORE_COLLECTION', 'unavailable'), W.historyBeforeCollection);
  assert.equal(executiveReasonMessage('HISTORY_BEFORE_FIRST_BUILD', 'partial'), W.historyBeforeFirstBuild);
  assert.equal(executiveReasonMessage('HISTORY_BEFORE_FIRST_BUILD', 'unavailable'), W.historyBeforeFirstBuildUnavailable);
  assert.equal(executiveReasonMessage('SOURCE_ROWS_PURGED', 'partial'), W.sourceRowsPurged);
  assert.equal(executiveReasonMessage('SOURCE_ROWS_PURGED', 'unavailable'), W.sourceRowsPurgedUnavailable);
});

test('an export refused for the export or contacts right re-reads the rights; only a lost read right denies the report (plain-language spec, E5 denial)', async () => {
  const page = source('./ExecutiveReportPage.tsx');
  // The report-wide denial would say the report itself is closed and empty the report menu while the reader can still read it.
  assert.match(page, /<ExecutiveExportPanel [^>]*deny=\{denyExport\}/);
  assert.match(page, /exportDenied && context && !canExport\(context\) && <p role="status">\{W\.export\.denied\}<\/p>/);
  const file = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = (file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExecutiveReportPage') as ts.FunctionDeclaration).body!.statements;
  const declaration = body.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(file) === 'denyExport');
  assert.ok(declaration?.initializer, 'denyExport handler');
  const calls: string[] = [];
  const shared = { refresh: async () => { calls.push('refresh'); }, deny: () => { calls.push('deny'); } };
  const js = ts.transpileModule(`return ${declaration!.initializer!.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const denyExport = new Function('shared', 'setExportDenied', 'useCallback', js)(shared, (value: boolean) => calls.push(`exportDenied=${value}`), (fn: unknown) => fn);
  denyExport();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['exportDenied=true', 'refresh']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutiveContext } from '@watchdog-bms/contracts';
// The panel's design components import the SVG icon barrel; the node test runner has no SVG loader.
require.extensions['.svg'] = module => { module.exports = () => null; };
const moduleOf = () => import('./executive-export.logic');
const context = { capabilities: { readReport: { allowed: true }, export: { allowed: true }, seeContacts: { allowed: false } }, currentMonth: '2026-10', defaultMonth: '2026-10', months: { first: '2026-08', last: '2026-10' },
  filters: Object.fromEntries(['industry', 'discovery', 'referringSales', 'companyStatus', 'planState', 'usageGroup', 'paidEver', 'receiptAdoption', 'spendCohort', 'signupRail'].map(k => [k, [{ value: 'ALL', label: 'ทั้งหมด' }, { value: 'OTHER', label: 'อื่น ๆ' }]])) } as unknown as ExecutiveContext;
test('export body uses the shown build and full canonical query, removes paging and dormant context', async () => {
  const { exportBody } = await moduleOf();
  const params = new URLSearchParams('month=2026-09&page=3&filter_discovery=OTHER&pick=paidEver%3DYES%26sortBy%3DnetReceipts%26sortDir%3Ddesc');
  const body = exportBody('companies', params, context, 'shown-build', 'ร้าน', undefined, false);
  assert.deepEqual(body, { buildId: 'shown-build', reportKey: 'companies', from: '2026-09', to: '2026-09', filters: { paidEver: 'YES', q: 'ร้าน' }, sortBy: 'netReceipts', sortDir: 'desc', format: 'xlsx', includeContacts: false });
  const detail = exportBody('detail', params, context, 'shown', '', 'target', true);
  assert.deepEqual(detail.filters, {}); assert.equal(detail.targetCompanyId, 'target'); assert.equal(detail.includeContacts, false);
  // No screen asks for a comparison file any more (owner 2026-10-05): the sides of an old address are never sent.
  assert.equal('comparison' in exportBody('companies', new URLSearchParams('month=2026-09&by=company&a=a&b=b'), context, 'shown'), false);
  const ranking = exportBody('usage', new URLSearchParams('month=2026-09&view=ranking&rank=activeDays'), context, 'shown');
  assert.equal(ranking.subview, 'ranking'); assert.equal(ranking.sortBy, 'activeDays');
});
test('action prepares, hands off a file and reports done; duplicate clicks and abandoned responses do not download', async () => {
  const { createExportAction } = await moduleOf();
  let complete!: (value: Blob) => void;
  const states: string[] = [], downloads: Blob[] = [];
  const action = createExportAction({ request: () => new Promise<Blob>(resolve => { complete = resolve; }), download: blob => { downloads.push(blob); }, reload: () => assert.fail('unexpected reload'), state: s => states.push(s.kind) });
  const controller = new AbortController();
  const pending = action.run({} as never, 'ไฟล์.xlsx', controller.signal);
  await action.run({} as never, 'ไฟล์.xlsx', controller.signal);
  complete(new Blob(['file'])); await pending;
  assert.deepEqual(states, ['preparing', 'done']); assert.equal(downloads.length, 1);
  const abandoned = action.run({} as never, 'ไฟล์.xlsx', controller.signal); controller.abort(); complete(new Blob(['late'])); await abandoned;
  assert.equal(downloads.length, 1);
});
test('snapshot expiry reloads once and returns to the report without automatically exporting; safe errors and rate wait persist', async () => {
  const { createExportAction } = await moduleOf();
  const { EXECUTIVE_WORDS: W } = await import('@watchdog-bms/contracts');
  let reloads = 0, requests = 0; const states: any[] = [];
  const action = createExportAction({ request: async () => { requests++; throw { code: 'EXECUTIVE_SNAPSHOT_EXPIRED', status: 409 }; }, download: () => assert.fail('unexpected download'), reload: () => { reloads++; }, state: s => states.push(s) });
  await action.run({} as never, 'ไฟล์.xlsx', new AbortController().signal);
  assert.equal(reloads, 1); assert.equal(requests, 1); assert.equal(states.at(-1).kind, 'expired');
  assert.equal(states.at(-1).text, W.export.expired);
  const failed = createExportAction({ request: async () => { throw { code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 4 }; }, download: () => undefined, reload: () => undefined, state: s => states.push(s) });
  await failed.run({} as never, 'ไฟล์.xlsx', new AbortController().signal); assert.equal(states.at(-1).retryAfterSeconds, 4); assert.equal(states.at(-1).text, W.export.failed);
  const downloadFailed = createExportAction({ request: async () => new Blob(['file']), download: () => { throw Error('diagnostic secret'); }, reload: () => undefined, state: s => states.push(s) });
  await downloadFailed.run({} as never, 'ไฟล์.xlsx', new AbortController().signal);
  assert.equal(states.at(-1).text, W.export.downloadFailed); assert.doesNotMatch(states.at(-1).text, /secret/);
});
test('filename is Thai and contains no company name, internal key or search, and permission gates use capabilities', async () => {
  const { exportFileName, canExport, canExportContacts } = await moduleOf();
  assert.equal(exportFileName('detail', '2026-09', new Date('2026-10-03T02:30:00Z')), 'รายงานผู้บริหารมั่งมี-รายละเอียดบริษัท-ช่วงเดือนก.ย.2569-ส่งออก-3ต.ค.2569-0930.xlsx');
  assert.equal(canExport(context), true); assert.equal(canExportContacts('companies', context), false);
  const contact = { ...context, capabilities: { ...context.capabilities, seeContacts: { allowed: true } } };
  assert.equal(canExportContacts('companies', contact), true); assert.equal(canExportContacts('overview', contact), false);
  assert.equal(canExport({ ...context, capabilities: { ...context.capabilities, export: { allowed: false } } }), false);
});

test('binary API uses authenticated POST/no-store, rejects incomplete files, and preserves JSON errors and rate waits', async t => {
  const { getExecutiveExport } = await import('./executive-reports.api');
  const fetch = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/v1/system/executive/exports'); assert.equal(init?.method, 'POST'); assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'include'); assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    return new Response(new Uint8Array([0x50, 0x4b, 1]), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  });
  const signal = new AbortController().signal;
  assert.equal((await getExecutiveExport({} as never, signal)).size, 3);
  fetch.mock.mockImplementation(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(() => getExecutiveExport({} as never, signal), /invalid export artifact/);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ code: 'EXECUTIVE_SNAPSHOT_EXPIRED' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(() => getExecutiveExport({} as never, signal), (error: any) => error.status === 409 && error.code === 'EXECUTIVE_SNAPSHOT_EXPIRED');
  fetch.mock.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }));
  await assert.rejects(() => getExecutiveExport({} as never, signal), (error: any) => error.status === 429 && error.retryAfterSeconds === 5);
});

test('preparation panel puts the action before column details, contacts default off, and empty/unavailable scopes explain a disabled action', async () => {
  const React = await import('react');
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ExecutiveExportPanel } = await import('./ExecutiveExportPanel');
  const { EXECUTIVE_WORDS: W } = await import('@watchdog-bms/contracts');
  const data: any = { build: { id: 'shown' }, period: { month: '2026-09' }, dataThrough: { oldest: '2026-10-03T02:30:00Z', lagging: [] }, coverage: { usage: { coverage: 'complete', reasonCodes: [] }, money: { coverage: 'complete', reasonCodes: [] } }, appliedFilters: { global: {}, directory: {} }, population: { eligibleCount: { value: 2, coverage: 'complete', reasonCodes: [] } }, pagination: { total: 2 } };
  const props: any = { section: 'companies', params: new URLSearchParams('month=2026-09'), context, data, search: '', close: () => {}, reload: () => {}, deny: () => {} };
  const html = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, props));
  assert.doesNotMatch(html, /ตัวเลขบางส่วนยังไม่ครบ/);
  const partial = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, { ...props, data: { ...data, coverage: { ...data.coverage, usage: { coverage: 'partial', reasonCodes: ['HISTORY_BEFORE_FIRST_BUILD'] } } } }));
  assert.match(partial, /executive-status/); assert.match(partial, new RegExp(W.historyBeforeFirstBuild));
  assert.ok(html.indexOf(W.export.create) < html.indexOf(W.export.columns)); assert.doesNotMatch(html, /type="checkbox"/);
  const withRight = { ...context, capabilities: { ...context.capabilities, seeContacts: { allowed: true } } };
  const contact = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, { ...props, context: withRight }));
  assert.match(contact, /type="checkbox"/); assert.doesNotMatch(contact, /checked=""/); assert.match(contact, new RegExp(W.export.contactHint)); assert.match(contact, /เมื่อเลือก[^<]*คอลัมน์อีเมลและเบอร์โทร/);
  const empty = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, { ...props, data: { ...data, pagination: { total: 0 } } }));
  assert.match(empty, /disabled=""/); assert.match(empty, new RegExp(W.export.empty));
  const filtered = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, { ...props, data: { ...data, pagination: { total: 1 }, population: { eligibleCount: { value: 15, coverage: 'complete' } } } }));
  assert.match(filtered, /พบ 1 บริษัท/); assert.doesNotMatch(filtered, /<p>15 ·/);
  const unavailable = renderToStaticMarkup(React.createElement(ExecutiveExportPanel, { ...props, section: 'detail', targetCompanyId: 'target', data: { ...data, company: {}, month: null } }));
  assert.match(unavailable, /disabled=""/); assert.match(unavailable, new RegExp(W.noData));
});

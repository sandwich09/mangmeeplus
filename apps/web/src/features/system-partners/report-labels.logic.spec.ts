import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORT_CLASSIFICATIONS, REPORT_INDUSTRY_GROUPS } from '@watchdog-bms/contracts';
const logic = () => import('./report-labels.logic');

test('partner report filters round trip in URL, reset page, and clear without losing other context', async () => {
  const { partnerReportFilters, partnerListUrl } = await logic();
  const current = new URLSearchParams('q=ร้าน&status=ARCHIVED&page=4&view=companies');
  const url = partnerListUrl(current, { reportClassification: 'UNCLASSIFIED', reportIndustryGroup: 'UNSET' });
  const params = new URLSearchParams(url.split('?')[1]);
  assert.deepEqual(partnerReportFilters(params), { reportClassification: 'UNCLASSIFIED', reportIndustryGroup: 'UNSET' });
  assert.equal(params.get('page'), null); assert.equal(params.get('q'), 'ร้าน'); assert.equal(params.get('status'), 'ARCHIVED');
  const cleared = new URLSearchParams(partnerListUrl(params, { q: '', status: '', reportClassification: 'ALL', reportIndustryGroup: 'ALL' }).split('?')[1]);
  assert.equal(cleared.toString(), 'view=companies');
  assert.deepEqual(partnerReportFilters(new URLSearchParams('reportClassification=bad&reportIndustryGroup=bad')), { reportClassification: 'ALL', reportIndustryGroup: 'ALL' });
});

test('report field choices use contract keys and industry words; platform offers only internal', async () => {
  const { classificationOptions, industryOptions } = await logic();
  // DEMO is set only by the system when a sales demo link opens; an admin cannot choose it.
  assert.deepEqual(classificationOptions(false).map(x => x.value), ['', ...REPORT_CLASSIFICATIONS.filter(value => value !== 'DEMO')]);
  assert.deepEqual(classificationOptions(true), [{ value: 'INTERNAL', label: 'บริษัทของมั่งมี' }]);
  assert.deepEqual(industryOptions.slice(1), REPORT_INDUSTRY_GROUPS.map(x => ({ value: x.key, label: x.label })));
});

test('every lifecycle saves only labels; null clears; platform cannot save another classification', async () => {
  const { partnerReportLabelBody } = await logic();
  for (const status of ['ACTIVE', 'SUSPENDED', 'DISABLED', 'ARCHIVED']) {
    const company = { status, name: 'ร้าน', timezone: 'Asia/Bangkok', reportClassification: 'TEST', reportIndustryGroup: 'FINANCE' };
    assert.deepEqual(partnerReportLabelBody(company.reportClassification, company.reportIndustryGroup, false), { reportClassification: 'TEST', reportIndustryGroup: 'FINANCE' });
  }
  assert.deepEqual(partnerReportLabelBody('', '', false), { reportClassification: null, reportIndustryGroup: null });
  assert.deepEqual(partnerReportLabelBody('', '', true), { reportClassification: 'INTERNAL', reportIndustryGroup: null });
  assert.equal(partnerReportLabelBody('bad', '', false), null);
});

test('label provenance uses display names and timestamps, never actor ids or invented edits', async () => {
  const { reportLabelEditedBy } = await logic();
  assert.equal(reportLabelEditedBy(undefined, '2026-10-03T00:00:00Z'), null);
  assert.equal(reportLabelEditedBy({ userId: 'private-id', displayName: 'ชื่อ' }, undefined), null);
  const line = reportLabelEditedBy({ userId: 'private-id', displayName: 'ชื่อ' }, '2026-10-03T00:00:00Z');
  assert.match(line!, /แก้ล่าสุดโดย ชื่อ เมื่อ/); assert.ok(!line!.includes('private-id'));
});

test('partner API carries both filters and sends the labels-only body through the existing PATCH', async () => {
  const api = await import('./system-partners.api');
  const { partnerReportLabelBody } = await logic();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    await api.listPartners({ q: 'ร้าน', status: 'ARCHIVED', page: 2, reportClassification: 'UNCLASSIFIED', reportIndustryGroup: 'UNSET' });
    const params = new URLSearchParams(calls[0].url.split('?')[1]);
    assert.equal(params.get('reportClassification'), 'UNCLASSIFIED'); assert.equal(params.get('reportIndustryGroup'), 'UNSET');
    assert.equal(params.get('status'), 'ARCHIVED'); assert.equal(params.get('page'), '2');
    await api.updatePartnerProfile('held-company', partnerReportLabelBody('', 'FINANCE', false)!);
    assert.equal(calls[1].url, '/api/v1/system/partners/held-company'); assert.equal(calls[1].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { reportClassification: null, reportIndustryGroup: 'FINANCE' });
  } finally { globalThis.fetch = original; }
});

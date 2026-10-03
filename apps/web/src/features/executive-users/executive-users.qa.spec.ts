import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutiveCommand } from './executive-users.logic';
const source = (path: string) => { const file = join(__dirname, path); return existsSync(file) ? readFileSync(file, 'utf8') : ''; };

test('account routes and header require manage permission, including direct detail links', () => {
  const layout = source('../../../app/system/executive-users/layout.tsx');
  assert.match(layout, /permissions.includes\('system.executive_user.manage'\)/);
  assert.match(layout, /ForbiddenState/);
  assert.match(layout, /apiErrorMessage\(\{ code: 'EXECUTIVE_ACCESS_DENIED' \}\)/);
  assert.doesNotMatch(layout, /SystemAccessDenied/, 'lacking account management does not mean lacking the entire admin console');
  assert.match(source('../../../app/system/layout.tsx'), /executiveUsersAllowed=\{result.session.permissions.includes\('system.executive_user.manage'\)\}/);
  assert.match(source('../../common/components/app-shell/SystemHeader.tsx'), /section.href !== '\/system\/executive-users' \|\| executiveUsersAllowed/);
  for (const path of ['page.tsx', 'new/page.tsx', '[userId]/page.tsx']) assert.match(source(`../../../app/system/executive-users/${path}`), /ExecutiveUser/);
  // `/system` hands each page the bare column: without its own container the pages sit flush against a phone's edge.
  assert.match(layout, /<main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">/);
});

test('list handles stale responses, URL filters, text-only empty results, mobile cards and shared paging', () => {
  const s = source('ExecutiveUsersPage.tsx');
  for (const token of ['executiveFilters', 'executiveListUrl', 'AbortController', 'signal.aborted', 'CoverLoader', 'ForbiddenState', 'Pagination', 'SelectField', 'TextField']) assert.ok(s.includes(token), token);
  assert.match(s, /items.length === 0/); assert.match(s, /md:hidden/); assert.match(s, /hidden.*md:table/); assert.match(s, /table-fixed/);
  assert.doesNotMatch(s, /<EmptyState|mangmee-table-scroll/);
});

test('create form uses shared fields and unticked rights; preserves typed values and attaches field errors', () => {
  const s = source('ExecutiveUserPage.tsx');
  for (const token of ['emptyExecutiveForm', 'validateExecutiveForm', 'executiveCreateBody', 'executiveFieldErrors', 'TextField', 'SwitchField', 'canExport', 'canSeeContacts']) assert.ok(s.includes(token), token);
  assert.doesNotMatch(s, /setValues\(emptyExecutiveForm/);
  assert.match(s, /setCredential\(result.credential\)/);
});

test('detail confirms identity and reason before every command and hides refused actions', () => {
  const s = source('ExecutiveUserPage.tsx');
  for (const token of ['useInputPrompt', 'required: true', 'executiveConfirmation', 'executiveCommand', 'executiveActions', 'ACCOUNT_PROTECTED', 'ACCOUNT_REVOKED', 'executiveExpiryNotice']) assert.ok(s.includes(token), token);
  assert.ok(s.indexOf('await promptInput(') < s.indexOf('await commandExecutiveUser('));
  assert.match(s, /setUser\(null\); setCredential\(null\)/);
});

test('credential handoff is memory-only, copyable, expiring and never claims automatic delivery', () => {
  const s = source('ExecutiveUserPage.tsx');
  for (const token of ['credential.temporaryPassword', 'credential.expiresAt', 'navigator.clipboard.writeText', 'setCopying(true)', 'loading={copying}']) assert.ok(s.includes(token), token);
  for (const words of ['แสดงครั้งเดียว', 'ส่งรหัสให้เจ้าตัวด้วยตนเอง']) assert.ok(source('executive-users.logic.ts').includes(words));
  assert.doesNotMatch(s, /localStorage|sessionStorage|lineNotified|ส่งรหัสทาง/);
  assert.doesNotMatch(s, /else \{ setUser\(result\); setCredential\(null\); \}/, 'access/status saves must preserve a still-visible handoff');
  assert.match(s, /setCredential\(null\)/);
});

test('a failed command requires a fresh read and a new password never leaves an old secret visible', () => {
  const s = source('ExecutiveUserPage.tsx');
  assert.match(s, /setError\(apiErrorMessage\(cause\)\); setRefreshRequired\(true\)/);
  assert.match(s, /setProtectedAccount\(false\); setRefreshRequired\(false\)/);
  assert.match(s, /disabled=\{busy \|\| refreshRequired\}/);
  assert.match(s, /if \(command.path === 'credential'\) setCredential\(null\);\s*const result = await commandExecutiveUser/);
});

test('new account components use themed controls and mobile touch targets', () => {
  for (const file of ['ExecutiveUsersPage.tsx', 'ExecutiveUserPage.tsx', '../system-partners/PartnerReportLabels.tsx']) {
    const s = source(file); assert.ok(s.length > 0);
    assert.doesNotMatch(s, /<select\b|<input\b|<textarea\b|size="sm"|#[0-9a-fA-F]{3,8}\b/);
    assert.match(s, /MangmeeCard/);
  }
});

test('partners wire URL report filters to the API and include them in clear/empty states', () => {
  const s = source('../system-partners/PartnerListPage.tsx');
  for (const token of ['partnerReportFilters', 'partnerListUrl', 'classificationFilterOptions', 'industryFilterOptions', '...reportFilters', 'hasFilters']) assert.ok(s.includes(token), token);
  const api = source('../system-partners/system-partners.api.ts');
  assert.match(api, /q.set\('reportClassification', params.reportClassification\)/);
  assert.match(api, /q.set\('reportIndustryGroup', params.reportIndustryGroup\)/);
});

test('partner label form stays independent of profile locks and gates writes by permission', () => {
  const s = source('../system-partners/PartnerReportLabels.tsx');
  for (const token of ['partnerReportLabelBody', 'updatePartnerProfile', 'reportLabelEditedBy', 'classifiedBy', 'industryGroupSetBy', 'effectiveIndustryGroup', 'canManage', 'SelectField']) assert.ok(s.includes(token), token);
  assert.doesNotMatch(s, /profileLocked|fieldsLocked/);
  assert.match(source('../system-partners/PartnerDetailPage.tsx'), /<PartnerReportLabels/);
  const route = source('../../../app/system/partners/[companyId]/page.tsx');
  assert.match(route, /permissions.includes\('system.partner_company.update'\)/);
  assert.match(route, /session\?\.companyId === companyId/);
});

test('account API sends the six contracted requests with no cache or target tenant header', async () => {
  const api = await import('./executive-users.api');
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  try {
    await api.listExecutiveUsers({ q: 'ชื่อ', status: 'REVOKED', page: 2, pageSize: 20 });
    await api.getExecutiveUser('a/b');
    await api.createExecutiveUser({ username: 'test', displayName: 'ชื่อ', canExport: false, canSeeContacts: false });
    const commands: ExecutiveCommand[] = [
      { path: 'status', body: { status: 'SUSPENDED', reason: 'เหตุผล' } },
      { path: 'access', body: { canExport: true, canSeeContacts: false, reason: 'เหตุผล' } },
      { path: 'credential', body: { reason: 'เหตุผล' } },
    ];
    for (const command of commands) await api.commandExecutiveUser('a/b', command);
    assert.match(calls[0].url, /status=REVOKED.*page=2/);
    assert.equal(calls[1].url, '/api/v1/system/executive-users/a%2Fb');
    assert.deepEqual(calls.slice(2).map(x => x.init?.method), ['POST', 'POST', 'POST', 'POST']);
    for (const call of calls) { assert.equal(call.init?.cache, 'no-store'); assert.ok(!JSON.stringify(call.init?.headers).includes('X-Company-Id')); }
    for (const call of calls.slice(3)) assert.equal(JSON.parse(String(call.init?.body)).reason, 'เหตุผล');
  } finally { globalThis.fetch = original; }
});

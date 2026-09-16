import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';
import { detectBillingIssue, resolveBillingIssue } from '../modules/billing/application/billing-issues';

export async function checkBillingSupportSla(input: Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const { request, approveRequest, browser, companyId, stripeAccountId } = input, db = input.prisma.client, base = '/v1/system/billing', run = randomUUID();
  const cases: string[] = [], issueIds: string[] = [], viewport = browser?.page.viewportSize();
  let slowSession: import('@playwright/test').CDPSession | undefined;
  const settings = async () => (await request(`${base}/settings`)).body, initial = await settings();
  const firstMinutes = { NORMAL: 60, HIGH: 30, CRITICAL: 5 }, nextMinutes = { NORMAL: 30, HIGH: 20, CRITICAL: 10 };
  const identity = (reference: string, kind = 'SLA_FOLLOWUP') => ({ stripeAccountId, companyId, livemode: false, kind, referenceId: `${run}-${reference}` });
  const detect = async (reference: string, kind?: string) => { const row = await db.$transaction(tx => detectBillingIssue(tx, identity(reference, kind))); issueIds.push(row.id); return row; };
  const detail = async (id: string) => { const result = await request(`${base}/issues/${id}`); assert.equal(result.status, 200, JSON.stringify(result)); return result.body; };
  const patch = (id: string, version: number, change: object, actor = request) => actor(`${base}/issues/${id}`, 'PATCH', {
    expectedVersion: version, state: 'OPEN', assigneeUserId: null, note: 'ตรวจเวลาติดตามและสิทธิ์เจ้าหน้าที่', ...change });
  const proof = async (actor = request) => { if (!(await actor(`${base}/settings`)).body.reauthenticatedUntil) assert.equal((await actor(`${base}/reauthenticate`, 'POST', { password: input.password })).status, 200); };
  const preview = async (minutes: unknown) => { const s = await settings(); return request(`${base}/configuration-changes/preview`, 'POST', {
    type: 'PUBLISH_POLICY', expectedVersion: s.version, policy: { ...s.policy, supportSlaMinutes: minutes }, gates: s.gates, reason: 'ตั้งเวลาติดตามสำหรับเคสใหม่และเคสที่เปิดรอบใหม่' }); };
  const submit = async (op: any) => { await proof(); const r = await request(`${base}/configuration-changes/${op.id}/submit`, 'POST', {
    expectedVersion: op.version, previewHash: op.previewHash }, { 'idempotency-key': `sla-submit-${op.id}` }); assert.equal(r.status, 200, JSON.stringify(r)); return r.body; };
  const approve = async (op: any) => { await proof(approveRequest); return approveRequest(`${base}/configuration-changes/${op.id}/approve`, 'POST', { expectedVersion: op.version, previewHash: op.previewHash }); };
  const publish = async (minutes: typeof firstMinutes | null) => { const p = await preview(minutes); assert.equal(p.status, 200, JSON.stringify(p));
    assert.deepEqual(p.body.impact.supportSla.after, minutes); const r = await approve(await submit(p.body)); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.state, 'SUCCEEDED'); return settings(); };
  const financial = async () => { const accounts = await db.billingAccount.findMany({ where: { stripeAccountId }, orderBy: { id: 'asc' } }); return { accounts,
    invoices: await db.billingInvoice.findMany({ where: { billingAccountId: { in: accounts.map(a=>a.id) } }, orderBy: { id: 'asc' } }),
    term: await db.companyPlanTerm.findUnique({ where: { companyId } }), grants: await db.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }) }; };
  const beforeFinancial = await financial(); let providerWrites = 0;
  input.transport(async (_url, init) => { if (init?.method && init.method !== 'GET') providerWrites++; return undefined; });
  try {
    assert.equal(initial.policy.supportSlaMinutes == null, true);
    const legacy = await detect('legacy'); assert.equal(legacy.slaDueAt, null); assert.equal(legacy.slaStartedAt, null);
    for (const invalid of [false, [], {}, { NORMAL: 1, HIGH: 2 }, { ...firstMinutes, CRITICAL: 0 }, { ...firstMinutes, NORMAL: 525601 }, { ...firstMinutes, HIGH: 1.5 }, { ...firstMinutes, extra: 1 }]) {
      assert.equal((await preview(invalid)).status, 400);
    }
    cases.push('sla-legacy-off-and-strict-three-priority-integer-bounds');
    if (browser) {
      const page = browser.page; await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${browser.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('ใช้กำหนดเวลาติดตามเคสส่วนกลาง', { exact: true }).check();
      for (const [label, value] of [['ปกติ', '60'], ['สูง', '30'], ['วิกฤต', '5']]) await page.getByLabel(`ติดตามระดับ${label}ภายใน (นาที)`, { exact: true }).fill(value!);
      await page.getByLabel('เหตุผลการเปลี่ยนค่า', { exact: true }).fill('ตั้งเวลาติดตามเคสใหม่โดยผู้ดูแล');
      await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ฉบับร่างที่บันทึกไว้' }).waitFor();
      const draft = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(draft);
      await page.goto(`${browser.origin}${draft}`, { waitUntil: 'domcontentloaded' });
      assert.equal(await page.getByLabel('ติดตามระดับสูงภายใน (นาที)', { exact: true }).inputValue(), '30');
      await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ตรวจผลกระทบก่อนส่ง' }).waitFor();
      await page.getByRole('region', { name: 'ผลต่อกำหนดเวลาติดตามเคส', exact: true }).getByText('เดิม: ปิดเกณฑ์อัตโนมัติ', { exact: true }).waitFor();
      await proof(); await page.getByRole('button', { name: 'บันทึกคำขอก่อนยืนยัน', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'รอยืนยันรายการ' }).waitFor();
      const href = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(href);
      const waiting = (await request(`${base}/configuration-changes/${href.split('/').at(-1)}`)).body;
      assert.ok(waiting.allowedActions.includes('approve'));
      await proof(approveRequest); const second = input.secondBrowser!.pages()[0]!;
      await second.goto(`${browser.origin}${href}`, { waitUntil: 'domcontentloaded' });
      await second.getByRole('button', { name: 'อนุมัติและใช้ค่าชุดนี้', exact: true }).click();
      await second.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      await second.reload({ waitUntil: 'domcontentloaded' }); await second.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await second.screenshot({ path: `${browser.evidenceDir}/admin-support-sla-policy-mobile.png`, fullPage: true });
      cases.push('browser-sla-draft-reload-impact-independent-approval-result-return-mobile');
    } else await publish(firstMinutes);
    const firstPolicy = await settings(); assert.deepEqual(firstPolicy.policy.supportSlaMinutes, firstMinutes);
    assert.equal((await detail(legacy.id)).slaDueAt, null, 'publication never invents a legacy clock');
    const normal = await detect('normal'), high = await detect('high', 'PAID_HELD');
    assert.equal(normal.slaDueAt!.getTime() - normal.slaStartedAt!.getTime(), 60 * 60000);
    assert.equal(high.slaDueAt!.getTime() - high.slaStartedAt!.getTime(), 30 * 60000);
    assert.equal(normal.slaPolicyRevisionId, firstPolicy.policyRevisionId);
    const assigned = await patch(normal.id, normal.version, { state: 'ASSIGNED', assigneeUserId: input.userIds[0] }); assert.equal(assigned.status, 200);
    await detect('normal'); const duplicate = await detail(normal.id);
    for (const key of ['version', 'episode', 'assigneeUserId', 'slaStartedAt', 'slaDueAt', 'slaPolicyRevisionId']) assert.deepEqual(duplicate[key], assigned.body[key]);
    const secondPolicy = await publish(nextMinutes); assert.notEqual(secondPolicy.policyRevisionId, firstPolicy.policyRevisionId);
    const changed = await patch(normal.id, duplicate.version, { priority: 'CRITICAL' }); assert.equal(changed.status, 200, JSON.stringify(changed));
    assert.equal(Date.parse(changed.body.slaDueAt) - Date.parse(changed.body.slaStartedAt), 5 * 60000, 'priority uses the original policy and start');
    assert.equal((await detail(high.id)).slaDueAt, high.slaDueAt!.toISOString());
    cases.push('sla-episode-priority-original-policy-and-duplicate-clock-assignment-preservation');

    const manual = new Date(Date.now() + 86400000).toISOString();
    const override = await patch(normal.id, changed.body.version, { followUpAt: manual }); assert.equal(override.status, 200);
    assert.equal(override.body.effectiveFollowUpAt, manual); assert.equal(override.body.slaDueAt, changed.body.slaDueAt);
    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/system/billing/issues/${normal.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(/ใช้เวลาที่ผู้ดูแลกำหนดทับอยู่/).waitFor();
      await page.getByLabel('เวลาติดตามภายใน', { exact: true }).fill(''); await page.getByLabel('บันทึกการดำเนินการ', { exact: true }).fill('กลับมาใช้เกณฑ์ส่วนกลางเดิม');
      await page.getByRole('button', { name: 'บันทึกสถานะ', exact: true }).click();
      await page.getByText(`รอรับงาน · เวอร์ชัน ${override.body.version + 1}`, { exact: true }).waitFor({state:'attached'});
      await page.getByText('ข้อมูลอ้างอิงเคส',{exact:true}).click();
      await page.getByText(`รอรับงาน · เวอร์ชัน ${override.body.version + 1}`, { exact: true }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('region', { name: 'รายละเอียดเคส', exact: true }).waitFor();
      assert.equal(await page.getByLabel('เวลาติดตามภายใน', { exact: true }).inputValue(), '');
    } else assert.equal((await patch(normal.id, override.body.version, { followUpAt: null })).status, 200);
    const cleared = await detail(normal.id); assert.equal(cleared.followUpAt, null); assert.equal(cleared.effectiveFollowUpAt, changed.body.slaDueAt);
    const race = await Promise.all([patch(normal.id, cleared.version, { priority: 'HIGH' }), patch(normal.id, cleared.version, { priority: 'NORMAL' }, approveRequest)]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    cases.push('sla-manual-override-clear-original-deadline-and-concurrent-priority-cas');

    const original = await db.billingPolicyRevision.findUniqueOrThrow({ where: { id: firstPolicy.policyRevisionId } });
    await db.billingPolicyRevision.update({ where: { id: original.id }, data: { state: 'MISSING_PROVENANCE' } });
    try {
      const current = await detail(normal.id);
      assert.equal((await patch(normal.id, current.version, { priority: 'CRITICAL' })).body.code, 'CONTROL_SLA_REVIEW');
      const recovered = await patch(normal.id, current.version, { priority: 'CRITICAL', followUpAt: manual }); assert.equal(recovered.status, 200, JSON.stringify(recovered));
      assert.equal(recovered.body.slaDueAt, current.slaDueAt); assert.equal(recovered.body.effectiveFollowUpAt, manual);
    } finally { await db.billingPolicyRevision.update({ where: { id: original.id }, data: { state: original.state } }); }
    const active = await db.billingPolicyRevision.findUniqueOrThrow({ where: { id: secondPolicy.policyRevisionId } });
    await db.billingPolicyRevision.update({ where: { id: active.id }, data: { policyJson: { ...(active.policyJson as any), supportSlaMinutes: { NORMAL: 1 } } } });
    try { assert.equal((await detect('corrupt-policy')).slaDueAt, null, 'invalid SLA must not lose a case'); }
    finally { await db.billingPolicyRevision.update({ where: { id: active.id }, data: { policyJson: active.policyJson! } }); }
    const authorized = await settings();
    await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: input.adminRoleId } } });
    try { assert.equal((await request(`${base}/configuration-changes/preview`, 'POST', { type:'PUBLISH_POLICY', expectedVersion:authorized.version,
      policy:{...authorized.policy,supportSlaMinutes:firstMinutes},gates:authorized.gates,reason:'ตรวจสิทธิ์ที่ถูกถอน' })).status, 403);
      assert.equal((await patch(high.id, high.version, { priority: 'CRITICAL' })).status, 404); }
    finally { await db.membershipRole.create({ data: { membershipId: input.membershipId, roleId: input.adminRoleId } }); }
    cases.push('sla-missing-original-policy-manual-recovery-corrupt-config-case-survival-and-revoked-authority');

    await db.$transaction(tx => resolveBillingIssue(tx, identity('high', 'PAID_HELD'), 'SYNTHETIC_PROVIDER_RECOVERED'));
    const reopened = await detect('high', 'PAID_HELD'); assert.equal(reopened.episode, 2); assert.equal(reopened.slaPolicyRevisionId, secondPolicy.policyRevisionId);
    assert.equal(reopened.slaDueAt!.getTime() - reopened.slaStartedAt!.getTime(), nextMinutes.HIGH * 60000);
    await publish(null); const afterOff = await detect('after-off'); assert.equal(afterOff.slaDueAt, null);
    assert.equal((await detail(reopened.id)).slaDueAt, reopened.slaDueAt!.toISOString(), 'turning off keeps existing clock');
    await db.$transaction(tx => resolveBillingIssue(tx, identity('high', 'PAID_HELD'), 'SYNTHETIC_PROVIDER_RECOVERED'));
    const reopenedOff = await detect('high', 'PAID_HELD'); assert.equal(reopenedOff.episode, 3); assert.equal(reopenedOff.slaDueAt, null);
    cases.push('sla-reopen-current-policy-and-turn-off-new-episodes-without-erasing-existing-deadlines');

    await publish(firstMinutes);
    const overdueIds: string[] = [];
    for (let i = 0; i < 27; i++) overdueIds.push((await detect(`overdue-${i}`, `SLA_OVERDUE_${i}`)).id);
    const past = new Date(Date.now() - 7200000);
    await db.billingIssue.updateMany({ where: { id: { in: overdueIds } }, data: { slaStartedAt: past, slaDueAt: new Date(past.getTime() + 3600000) } });
    const queue = (cursor?: string) => request(`${base}/issues?${new URLSearchParams({ companyId, queue: 'OVERDUE', ...cursor ? { cursor } : {} })}`);
    const page1 = (await queue()).body; assert.equal(page1.items.length, 25); assert.ok(page1.items.every((i: any) => i.overdue)); assert.ok(page1.nextCursor);
    const page2 = (await queue(page1.nextCursor)).body; assert.equal(page2.items.length, 2); assert.equal(page2.nextCursor, null);
    assert.deepEqual([...page1.items, ...page2.items].map(i => i.id).sort(), overdueIds.sort());
    const first = await detail(overdueIds[0]!); const postponed = await patch(first.id, first.version, { followUpAt: manual }); assert.equal(postponed.status, 200);
    assert.equal(postponed.body.overdue, false); assert.equal((await queue(first.id)).status, 404, 'cursor outside effective overdue scope is refused');
    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/system/billing/issues`, { waitUntil: 'domcontentloaded' });
      if (process.env.BILLING_SLA_SLOW_BROWSER === '1') {
        slowSession = await page.context().newCDPSession(page);
        await slowSession.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      }
      const filtered = page.waitForResponse(r => {
        const url = new URL(r.url()); return url.pathname === '/api/v1/system/billing/issues' && url.searchParams.get('queue') === 'OVERDUE' && !url.searchParams.has('cursor') && r.request().method() === 'GET';
      });
      await page.getByLabel('กรองคิว', { exact: true }).selectOption('OVERDUE');
      const filteredResponse = await filtered; assert.equal(filteredResponse.status(), 200);
      assert.equal(new URL(filteredResponse.url()).pathname, '/api/v1/system/billing/issues', JSON.stringify({ url: filteredResponse.url(), type: filteredResponse.headers()['content-type'] }));
      const filteredPage = await filteredResponse.json(); assert.ok(filteredPage.nextCursor);
      const renderedRows = (rows: { id: string }[]) => page.waitForFunction(ids => {
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('section[aria-label="รายการเคส"] a'));
        return links.length === ids.length && links.every((link, index) => new URL(link.href).pathname === `/system/billing/issues/${ids[index]}`);
      }, rows.map(row => row.id));
      await page.waitForURL(`${browser.origin}/system/billing/issues?queue=OVERDUE`);
      await renderedRows(filteredPage.items);
      const [nextResponse] = await Promise.all([
        page.waitForResponse(r => {
          const url = new URL(r.url()); return url.pathname === '/api/v1/system/billing/issues' && url.searchParams.get('queue') === 'OVERDUE' && url.searchParams.get('cursor') === filteredPage.nextCursor && r.request().method() === 'GET';
        }),
        page.waitForURL(`${browser.origin}/system/billing/issues?queue=OVERDUE&cursor=${filteredPage.nextCursor}`),
        page.getByRole('button', { name: 'หน้าถัดไป', exact: true }).click(),
      ]);
      assert.equal(nextResponse.status(), 200);
      await renderedRows((await nextResponse.json()).items);
      await page.getByRole('button', { name: 'หน้าแรก', exact: true }).waitFor();
      const link = page.getByRole('region', { name: 'รายการเคส', exact: true }).locator(`a[href^="/system/billing/issues/${overdueIds.at(-1)}?"]`);
      await link.waitFor(); const href = await link.getAttribute('href'); assert.ok(href); await link.click();
      await page.waitForURL(`${browser.origin}${href}`); await page.getByRole('region', { name: 'รายละเอียดเคส', exact: true }).getByText(/เลยเวลาติดตาม/).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('region', { name: 'รายละเอียดเคส', exact: true }).getByText(/กำหนดจากเกณฑ์ส่วนกลาง/).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${browser.evidenceDir}/admin-support-sla-case-mobile.png`, fullPage: true });
      const returnQuery=new URL(`${browser.origin}${href}`).search;
      await page.getByRole('link', { name: 'คิวตรวจสอบ', exact: true }).click(); await page.waitForURL(`${browser.origin}/system/billing/issues${returnQuery}`);
      await page.getByRole('button',{name:'หน้าแรก',exact:true}).waitFor();assert.equal(await page.getByLabel('กรองคิว',{exact:true}).inputValue(),'OVERDUE');
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'หน้าแรก',exact:true}).waitFor();
      assert.equal(await page.getByLabel('กรองคิว',{exact:true}).inputValue(),'OVERDUE');
      cases.push('browser-sla-manual-clear-reload-overdue-pagination-case-return-mobile');
      if (slowSession) cases.push('browser-sla-slow-rendering-api-response-bound-paging');
    }
    await db.$transaction(tx => resolveBillingIssue(tx, identity('overdue-0', 'SLA_OVERDUE_0'), 'SYNTHETIC_PROVIDER_RECOVERED'));
    const audits = await db.auditLog.findMany({ where: { targetId: normal.id, action: 'billing.issue.updated' } });
    assert.ok(audits.some(a => (a.metadataJson as any)?.sla?.policyRevisionId === firstPolicy.policyRevisionId));
    assert.equal(providerWrites, 0); assert.deepEqual(await financial(), beforeFinancial);
    cases.push('sla-read-time-overdue-worker-off-scope-pagination-audit-and-no-financial-provider-mutation');
    return cases;
  } catch (error) {
    if (browser) {
      console.error(JSON.stringify({ stage:'support-sla',path:new URL(browser.page.url()).pathname,completed:cases,
        query:new URL(browser.page.url()).search,
        controls:await browser.page.locator('main button').allTextContents(),
        alerts:await browser.page.locator('main [role="alert"]').allTextContents() }));
      await browser.page.screenshot({ path:`${browser.evidenceDir}/support-sla-failure.png`,fullPage:true });
    }
    throw error;
  } finally {
    input.transport();
    if (slowSession) { await slowSession.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}); await slowSession.detach().catch(() => {}); }
    await db.billingIssue.deleteMany({ where: { id: { in: issueIds } } });
    if (browser && viewport) await browser.page.setViewportSize(viewport);
  }
}

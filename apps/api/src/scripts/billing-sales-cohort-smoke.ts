import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';

export async function checkBillingSalesCohort(input: Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const { request, approveRequest, browser } = input, db = input.prisma.client, base = '/v1/system/billing', run = randomUUID();
  const companies = Array.from({ length: 27 }, (_, n) => ({ id: `cohort-${run}-${String(n).padStart(2, '0')}`, name: `Synthetic cohort ${run} ${n}` }));
  const pilot = companies[0]!, excluded = companies[1]!, ids = companies.map(c => c.id), memberships: string[] = [];
  const settings = async () => (await request(`${base}/settings`)).body, initial = await settings();
  const originalTerm = await db.companyPlanTerm.findUnique({ where: { companyId: input.companyId } });
  const originalGrants = await db.billingReceiptGrant.findMany({ where: { companyId: input.companyId }, orderBy: { id: 'asc' } });
  const proof = async (actor = request) => { if (!(await actor(`${base}/settings`)).body.reauthenticatedUntil) assert.equal((await actor(`${base}/reauthenticate`, 'POST', { password: input.password })).status, 200); };
  const preview = async (selected: unknown) => { const s = await settings(); return request(`${base}/configuration-changes/preview`, 'POST', {
    type: 'PUBLISH_POLICY', expectedVersion: s.version, policy: { ...s.policy, salesCompanyIds: selected }, gates: s.gates, reason: 'ตรวจการเปิดขายเฉพาะบริษัทที่เลือก' }); };
  const submit = async (op: any) => { await proof(); const result = await request(`${base}/configuration-changes/${op.id}/submit`, 'POST', {
    expectedVersion: op.version, previewHash: op.previewHash }, { 'idempotency-key': `cohort-submit-${op.id}` }); assert.equal(result.status, 200, JSON.stringify(result)); return result.body; };
  const approve = async (op: any) => { await proof(approveRequest); return approveRequest(`${base}/configuration-changes/${op.id}/approve`, 'POST', { expectedVersion: op.version, previewHash: op.previewHash }); };
  const publish = async (selected: string[] | null) => { const p = await preview(selected); assert.equal(p.status, 200, JSON.stringify(p)); const waiting = await submit(p.body);
    const result = await approve(waiting); assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.state, 'SUCCEEDED'); return result.body; };
  const quote = (companyId: string) => request(`/v1/companies/${companyId}/billing/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'billing@example.test' });
  const status = (companyId: string) => request(`/v1/companies/${companyId}/billing`);
  const viewport = browser?.page.viewportSize(), cases: string[] = [];
  try {
    await db.company.createMany({ data: companies });
    const owner = await db.role.findFirstOrThrow({ where: { companyId: input.companyId, key: 'OWNER' } });
    for (const company of [pilot, excluded]) {
      const member = await db.companyMembership.create({ data: { companyId: company.id, userId: input.userIds[0]!, roles: { create: { roleId: owner.id } } } }); memberships.push(member.id);
      await db.companyPlanTerm.create({ data: { companyId: company.id, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15,
        termStartAt: new Date(Date.now() - 31 * 86400000), termEndsAt: new Date(Date.now() - 60000) } });
    }
    assert.equal((await status(pilot.id)).body.purchaseEligibility, 'ELIGIBLE', 'omitted historical policy allows companies');
    for (const invalid of [false, 'all', {}, [pilot.id, pilot.id], [''], ['a'.repeat(101)], Array.from({ length: 101 }, (_, n) => `company-${n}`)]) assert.equal((await preview(invalid)).status, 400);
    assert.equal((await preview(['missing-cohort-company'])).body.code, 'CONTROL_SALES_COMPANY_INVALID');
    const authorizedSettings = await settings();
    await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: input.adminRoleId } } });
    try { assert.equal((await request(`${base}/configuration-changes/preview`, 'POST', { type: 'PUBLISH_POLICY', expectedVersion: authorizedSettings.version,
      policy: { ...authorizedSettings.policy, salesCompanyIds: [pilot.id] }, gates: authorizedSettings.gates, reason: 'ตรวจสิทธิ์ที่ถูกถอน' })).status, 403); } finally { await db.membershipRole.create({ data: { membershipId: input.membershipId, roleId: input.adminRoleId } }); }
    const dir = await request(`${base}/overview?search=${encodeURIComponent(`cohort-${run}`)}`); assert.equal(dir.body.companies.length, 25);
    const more = await request(`${base}/overview?search=${encodeURIComponent(`cohort-${run}`)}&cursor=${dir.body.nextCursor}`); assert.equal(more.body.companies.length, 2);
    cases.push('cohort-historical-default-strict-bounds-existing-company-validation-platform-scope-and-directory-pagination');

    const stale = await submit((await preview([pilot.id])).body), oldVersion = (await settings()).version;
    await db.company.update({ where: { id: pilot.id }, data: { name: 'Changed after preview' } });
    assert.equal((await approve(stale)).body.code, 'CONTROL_PREVIEW_STALE'); assert.equal((await settings()).version, oldVersion);
    await db.company.update({ where: { id: pilot.id }, data: { name: pilot.name } });
    assert.equal((await request(`${base}/configuration-changes/${stale.id}/cancel`, 'POST', { expectedVersion: stale.version })).body.state, 'CANCELLED');
    cases.push('cohort-material-company-change-refuses-approval-and-keeps-active-revision');

    if (browser) {
      const page = browser.page; await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${browser.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('เปิดรับรายการซื้อใหม่สำหรับ', { exact: true }).selectOption('selected');
      await page.getByLabel('ค้นหาบริษัทสำหรับเปิดขาย', { exact: true }).fill(pilot.id);
      await page.getByRole('button', { name: 'ค้นหาบริษัทสำหรับกลุ่ม', exact: true }).click();
      await page.getByRole('button', { name: `เพิ่ม ${pilot.name} เข้ากลุ่ม`, exact: true }).click();
      await page.getByLabel('ค้นหาบริษัทสำหรับเปิดขาย', { exact: true }).fill('no matching company');
      await page.getByRole('button', { name: 'ค้นหาบริษัทสำหรับกลุ่ม', exact: true }).click();
      await page.getByText('ไม่พบบริษัท ลองเปลี่ยนคำค้น', { exact: true }).waitFor();
      await page.getByRole('button', { name: `นำ ${pilot.name} ออกจากกลุ่ม`, exact: true }).waitFor();
      await page.getByLabel('เหตุผลการเปลี่ยนค่า', { exact: true }).fill('เปิดขายให้บริษัทที่เลือกจากหน้าเว็บ');
      let lostDraft = false, savedId = '';
      await page.route('**/system/billing/configuration-drafts', async route => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        const result = await route.fetch(); assert.equal(result.status(), 200); const body = await result.json();
        assert.deepEqual(body.proposed.policy.salesCompanyIds, [pilot.id]);
        if (!lostDraft) { savedId = body.id; lostDraft = true; await route.abort('failed'); }
        else { assert.equal(body.id, savedId); await route.fulfill({ response: result }); }
      });
      await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
      await page.locator('main').getByRole('alert').filter({ hasText: 'ยังยืนยันผลไม่ได้' }).waitFor();
      await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ฉบับร่างที่บันทึกไว้' }).waitFor();
      await page.unroute('**/system/billing/configuration-drafts');
      const href = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(href); assert.ok(href.endsWith(savedId));
      await page.goto(`${browser.origin}${href}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: `นำ ${pilot.name} ออกจากกลุ่ม`, exact: true }).waitFor();
      await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ตรวจผลกระทบก่อนส่ง' }).waitFor();
      await proof(); await page.getByRole('button', { name: 'ส่งคำขอให้ผู้อนุมัติ', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'รอผู้อนุมัติอีกคน' }).waitFor();
      const target = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(target);
      await proof(approveRequest); const second = input.secondBrowser!.pages()[0]!;
      await second.goto(`${browser.origin}${target}`, { waitUntil: 'domcontentloaded' });
      await second.getByRole('button', { name: 'อนุมัติและใช้ค่าชุดนี้', exact: true }).click();
      await second.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      await second.reload({ waitUntil: 'domcontentloaded' });
      await second.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await second.screenshot({ path: `${browser.evidenceDir}/admin-sales-cohort-mobile.png`, fullPage: true });
      cases.push('browser-cohort-company-selection-lost-draft-response-same-command-reload-independent-approval-permanent-result-mobile');
    } else await publish([pilot.id]);
    assert.deepEqual((await settings()).policy.salesCompanyIds, [pilot.id]);
    const q = await quote(pilot.id); assert.equal(q.status, 200, JSON.stringify(q));
    assert.equal((await quote(excluded.id)).body.code, 'BILLING_COMPANY_SALES_CLOSED');
    assert.equal((await status(excluded.id)).body.allowedActions.includes('new_sales'), false);
    const publicCatalog = (await request('/v1/billing/catalog')).body;
    assert.ok(publicCatalog.offers.some((o: any) => o.availability === 'AVAILABLE'));
    for (const value of [pilot.id, pilot.name, 'salesCompanyIds', 'salesCohort']) assert.equal(JSON.stringify(publicCatalog).includes(value), false);
    assert.equal(JSON.stringify(q.body).includes('salesCompanyIds'), false);
    await publish([]);
    for (const channel of ['web', 'line']) assert.equal((await request(`/v1/companies/${pilot.id}/billing/checkout`, 'POST', {
      quoteId: q.body.quoteId, consentRevision: q.body.consentRevision, accepted: true, channel }, { 'idempotency-key': `cohort-stale-${channel}-${run}` })).status, 409);
    assert.equal(await db.billingAttempt.count({ where: { quoteId: q.body.quoteId } }), 0);
    assert.ok((await request('/v1/billing/catalog')).body.offers.every((o: any) => o.availability !== 'AVAILABLE'));
    assert.equal((await quote(pilot.id)).body.code, 'BILLING_COMPANY_SALES_CLOSED');
    cases.push('cohort-selected-excluded-company-public-redaction-empty-close-stale-web-line-checkout-no-attempt');

    const existingAccount = await db.billingAccount.findFirstOrThrow({ where: { companyId: input.companyId, stripeAccountId: input.stripeAccountId } });
    const paid = await db.billingInvoice.findFirst({ where: { billingAccountId: existingAccount.id, applyStatus: 'APPLIED' } });
    if (paid) {
      const invoice = await request(`${base}/companies/${input.companyId}/apply-invoices/${paid.id}`); assert.equal(invoice.status, 200);
      assert.equal(invoice.body.canRetry, false, 'already-applied original remains final');
      assert.equal((await request(`/v1/companies/${input.companyId}/billing/history`)).status, 200);
      const cancel = await request(`/v1/companies/${input.companyId}/billing/collection/preview`, 'POST', { action: 'CANCEL_RENEWAL' }); assert.equal(cancel.status, 200, JSON.stringify(cancel));
      assert.equal((await request(`/v1/companies/${input.companyId}/billing/collection/${cancel.body.id}/withdraw`, 'POST', { expectedVersion: cancel.body.version })).body.state, 'CANCELLED');
      assert.equal((await request(`/v1/companies/${input.companyId}/billing/collection/preview`, 'POST', { action: 'SCHEDULE_DOWNGRADE', offerKey: 'STARTER_249', interval: 'year', capacity: {} })).body.code, 'BILLING_COMPANY_SALES_CLOSED');
      cases.push('cohort-removal-preserves-paid-history-and-cancellation-while-new-downgrade-is-closed');
    }
    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/companies/${input.companyId}/billing?channel=line`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('status').filter({ hasText: 'ยังไม่เปิดรับรายการซื้อใหม่สำหรับบริษัทนี้' }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'เลือกแพ็กเกจ', exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: 'ตรวจสอบสถานะ', exact: true }).waitFor();
      await page.goto(`${browser.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('เปิดรับรายการซื้อใหม่สำหรับ', { exact: true }).selectOption('all');
      await page.getByLabel('เหตุผลการเปลี่ยนค่า', { exact: true }).fill('เปิดรับทุกบริษัทอีกครั้ง');
      await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ตรวจผลกระทบก่อนส่ง' }).waitFor();
      const href = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(href);
      const op = (await request(`${base}/configuration-changes/${href.split('/').at(-1)}`)).body;
      assert.equal((await approve(await submit(op))).body.state, 'SUCCEEDED');
      cases.push('browser-cohort-excluded-line-entry-readable-history-refresh-and-return-to-admin-reopen');
    } else await publish(null);
    assert.equal((await status(pilot.id)).body.purchaseEligibility, 'ELIGIBLE');
    assert.equal((await quote(excluded.id)).status, 200);
    assert.deepEqual(await db.companyPlanTerm.findUnique({ where: { companyId: input.companyId } }), originalTerm);
    assert.deepEqual(await db.billingReceiptGrant.findMany({ where: { companyId: input.companyId }, orderBy: { id: 'asc' } }), originalGrants);
    cases.push('cohort-approved-reopen-without-restart-and-unchanged-paid-term-receipt-grants');
    const barrierQuote = await quote(pilot.id); assert.equal(barrierQuote.status, 200, JSON.stringify(barrierQuote));
    let closedAtCustomer = false, checkoutWrites = 0;
    input.transport(async (url, init) => {
      if (url.origin !== 'https://api.stripe.com') return undefined;
      if (url.pathname === '/v1/checkout/sessions' && init?.method === 'POST') checkoutWrites++;
      if (url.pathname === '/v1/customers' && init?.method === 'POST' && !closedAtCustomer) {
        closedAtCustomer = true; await publish([]);
        const form = new URLSearchParams(String(init.body ?? ''));
        return new Response(JSON.stringify({ object: 'customer', id: `cus_cohort${run.replaceAll('-', '')}`, livemode: false,
          metadata: { billingAccountId: form.get('metadata[billingAccountId]') } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return undefined;
    });
    const stopped = await request(`/v1/companies/${pilot.id}/billing/checkout`, 'POST', { quoteId: barrierQuote.body.quoteId,
      consentRevision: barrierQuote.body.consentRevision, accepted: true, channel: 'line' }, { 'idempotency-key': `cohort-barrier-${run}` });
    input.transport(); assert.equal(closedAtCustomer, true); assert.equal(stopped.status, 409, JSON.stringify(stopped)); assert.equal(checkoutWrites, 0);
    const stoppedAttempt = await db.billingAttempt.findUniqueOrThrow({ where: { quoteId: barrierQuote.body.quoteId } }); assert.equal(stoppedAttempt.status, 'FAILED');
    assert.equal((await db.billingAccount.findUniqueOrThrow({ where: { id: stoppedAttempt.billingAccountId } })).activeAttemptId, null);
    cases.push('cohort-approved-close-during-customer-request-blocks-checkout-at-final-barrier-and-releases-unpaid-reservation');
    return cases;
  } catch (error) {
    if (browser) console.error('Cohort browser diagnostic', JSON.stringify({ url: browser.page.url(),
      headings: await browser.page.locator('h1,h2').allTextContents(), alerts: await browser.page.getByRole('alert').allTextContents(),
      labels: await browser.page.locator('label').allTextContents(), selects: await browser.page.locator('select').count() }));
    throw error;
  } finally {
    input.transport();
    // Restore fixture state, never an application rollback path.
    await db.billingSettings.update({ where: { id: `${input.stripeAccountId}:test` }, data: { policyRevisionId: initial.policyRevisionId, gatesJson: initial.gates } });
    const accounts = await db.billingAccount.findMany({ where: { companyId: { in: ids } }, select: { id: true } });
    await db.billingAttempt.deleteMany({ where: { billingAccountId: { in: accounts.map(a => a.id) } } });
    await db.billingAccount.deleteMany({ where: { id: { in: accounts.map(a => a.id) } } });
    await db.billingQuote.deleteMany({ where: { companyId: { in: ids } } });
    await db.companyPlanTerm.deleteMany({ where: { companyId: { in: ids } } });
    await db.membershipRole.deleteMany({ where: { membershipId: { in: memberships } } });
    await db.companyMembership.deleteMany({ where: { id: { in: memberships } } });
    await db.company.deleteMany({ where: { id: { in: ids } } });
    if (browser && viewport) await browser.page.setViewportSize(viewport);
  }
}

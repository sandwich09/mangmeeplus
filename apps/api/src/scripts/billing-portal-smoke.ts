import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingReadiness } from './billing-readiness-smoke';

export async function checkBillingPortal(input: Parameters<typeof checkBillingReadiness>[0]) {
  const { request, companyId, stripeAccountId, browser } = input, db = input.prisma.client, cases: string[] = [];
  const base = `/v1/companies/${companyId}/billing`, admin = '/v1/system/billing';
  const settings = await db.billingSettings.findUniqueOrThrow({ where: { id: `${stripeAccountId}:test` } });
  const account = await db.billingAccount.findFirstOrThrow({ where: { companyId, stripeAccountId } });
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
  const owner = await db.membershipRole.findFirstOrThrow({ where: { membershipId: input.membershipId, role: { key: 'OWNER' } } });
  const financial = async () => ({ term: await db.companyPlanTerm.findUnique({ where: { companyId } }),
    invoices: await db.billingInvoice.findMany({ where: { billingAccountId: account.id }, orderBy: { id: 'asc' } }),
    grants: await db.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }) });
  const before = await financial(), customer = `cus_Portal${randomUUID().replaceAll('-', '')}`;
  const config = { id: 'bpc_Synthetic', object: 'billing_portal.configuration', livemode: false, active: true,
    features: { payment_method_update: { enabled: true }, subscription_update: { enabled: false }, subscription_cancel: { enabled: false } } };
  let posts = 0, otherWrites = 0, responseOverride: Record<string, unknown> = {}, configOverride: Record<string, unknown> | null = null;
  let during: ((path: string, method: string) => Promise<void>) | undefined, unavailable = false, returnPath = '';
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  input.transport(async (url, init) => {
    const path = url.pathname, method = init?.method ?? 'GET'; await during?.(path, method);
    if (method !== 'GET' && path !== '/v1/billing_portal/sessions') otherWrites++;
    if (path.startsWith('/v1/billing_portal/configurations/')) return json(configOverride ?? config);
    if (path === '/v1/billing_portal/sessions') {
      posts++; const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('customer'), customer); assert.equal(form.get('configuration'), config.id);
      assert.equal(form.get('flow_data[type]'), 'payment_method_update');
      returnPath = new URL(form.get('return_url')!).pathname; assert.equal(returnPath, `/companies/${companyId}/billing`);
      if (unavailable) return json({ error: { code: 'api_error' } }, 503);
      return json({ id: 'bps_Synthetic', object: 'billing_portal.session', livemode: false, customer, configuration: config.id,
        return_url: form.get('return_url'), url: 'https://billing.stripe.com/p/session/testSynthetic', ...responseOverride });
    }
    return undefined;
  });
  const open = () => request(`${base}/portal`, 'POST', { action: 'portal_payment_method' });
  const restoreAccount = () => db.billingAccount.update({ where: { id: account.id }, data: { customerId: customer, version: account.version, updatedAt: account.updatedAt } });
  const restoreSettings = () => db.billingSettings.update({ where: { id: settings.id }, data: { gatesJson: settings.gatesJson!, version: settings.version, updatedAt: settings.updatedAt } });
  const restoreCompany = () => db.company.update({ where: { id: companyId }, data: { status: company.status, updatedAt: company.updatedAt } });
  const restoreTerm = () => db.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: term.termEndsAt, termDisabledAt: term.termDisabledAt, updatedAt: term.updatedAt } });
  try {
    await restoreAccount(); const initial = (await request(`${admin}/settings`)).body;
    for (const bad of [{ ...config, id: 'bpc_other' }, { ...config, object: undefined }, { ...config, livemode: undefined },
      { ...config, features: { payment_method_update: { enabled: true } } },
      { ...config, features: { ...config.features, customer_update: { enabled: true, allowed_updates: ['email'] } } }]) {
      configOverride = bad;
      assert.equal((await open()).body.code, 'BILLING_PORTAL_CONFIG_MISMATCH');
      const preview = await request(`${admin}/configuration-changes/preview`, 'POST', { type: 'PUBLISH_POLICY', expectedVersion: initial.version,
        reason: 'ตรวจค่าเดียวกับหน้าแก้บัตร', policy: initial.policy, gates: initial.gates });
      assert.equal(preview.body.code, 'BILLING_PORTAL_CONFIG_MISMATCH', JSON.stringify(preview));
    }
    assert.equal(posts, 0); configOverride = null;
    cases.push('portal-publication-and-customer-use-share-strict-identity-mode-object-and-explicit-flags');
    for (const override of [{ customer: 'cus_other' }, { configuration: 'bpc_other' }, { livemode: true },
      { object: undefined }, { id: 'cs_wrong' }, { return_url: 'https://example.test/wrong' }, { url: 'https://example.test/unsafe' }]) {
      responseOverride = override; const result = await open(); assert.ok(result.status >= 400, JSON.stringify(result)); assert.equal(result.body.url, undefined);
    }
    responseOverride = {};
    cases.push('portal-session-wrong-customer-configuration-mode-object-return-and-url-refused');
    for (const phase of ['GET', 'POST']) {
      let changed = false; const count: number = posts;
      during = async (path, method) => { if (!changed && method === phase && path.includes('billing_portal')) {
        changed = true; await db.billingAccount.update({ where: { id: account.id }, data: { customerId: `${customer}Changed`, version: { increment: 1 } } });
      } };
      const changedResponse = await open(); assert.equal(changedResponse.body.code, 'BILLING_PORTAL_UNAVAILABLE', JSON.stringify({phase,...changedResponse})); assert.equal(posts, count + (phase === 'POST' ? 1 : 0));
      during = undefined; await restoreAccount();
    }
    // A portal URL is a capability: do not disclose it after the account email proof changes.
    const emailOwner = await db.user.findUniqueOrThrow({where:{id:input.userIds[0]!}});
    let emailChanged = false;
    during = async (path, method) => { if (!emailChanged && path.includes('billing_portal') && method === 'POST') {
      emailChanged = true; await db.user.update({where:{id:emailOwner.id},data:{emailRevision:{increment:1}}});
    } };
    try { const stale = await open(); assert.equal(stale.body.code,'BILLING_EMAIL_CHANGED',JSON.stringify(stale)); assert.equal(stale.body.url,undefined); }
    finally { during = undefined; await db.user.update({where:{id:emailOwner.id},data:{emailRevision:emailOwner.emailRevision}}); }
    cases.push('portal-email-proof-change-after-provider-response-withholds-capability');
    let closed = false;
    during = async path => { if (!closed && path.includes('billing_portal')) { closed = true;
      await db.billingSettings.update({ where: { id: settings.id }, data: { gatesJson: { ...initial.gates, portal_payment_method: false }, version: { increment: 1 } } });
    } };
    assert.equal((await open()).body.code, 'BILLING_PORTAL_UNAVAILABLE'); during = undefined; await restoreSettings();
    cases.push('portal-current-customer-and-emergency-gate-rechecked-before-create-and-after-provider-response');
    let revoked = false;
    during = async path => { if (!revoked && path.includes('billing_portal')) { revoked = true;
      await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: owner.membershipId, roleId: owner.roleId } } });
    } };
    try { assert.equal((await open()).status, 403); } finally { during = undefined;
      await db.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: owner.membershipId, roleId: owner.roleId } }, create: owner, update: {} }); }
    let held = false;
    during = async (path, method) => { if (!held && path.includes('billing_portal') && method === 'POST') { held = true;
      await db.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });
    } };
    assert.equal((await open()).body.code, 'BILLING_COMPANY_HELD'); during = undefined; await restoreCompany();
    await db.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: new Date(Date.now() - 60000), termDisabledAt: new Date() } });
    await db.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });
    assert.equal((await open()).status, 200, 'expiry-only disabled OWNER keeps payment recovery'); await restoreCompany(); await restoreTerm();
    cases.push('portal-current-owner-and-administrative-hold-refused-with-expiry-only-recovery-preserved');
    const fn = `portal_audit_${randomUUID().replaceAll('-', '')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.portal.opened' AND NEW."companyId"='${companyId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    try { await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      const failed = await open(); assert.ok(failed.status >= 400); assert.equal(failed.body.url, undefined);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`); await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`); }
    assert.equal((await open()).status, 200);
    const audits = await db.auditLog.findMany({ where: { companyId, action: 'billing.portal.opened' } });
    assert.ok(audits.length); assert.ok(!JSON.stringify(audits).includes('testSynthetic'));
    cases.push('portal-audit-failure-withholds-capability-retry-and-no-secret-url-in-audit');
    if (browser) {
      const page = browser.page, billingUrl = `${browser.origin}/companies/${companyId}/billing`;
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(billingUrl, { waitUntil: 'domcontentloaded' });
      const button = page.getByRole('button', { name: 'จัดการบัตรชำระเงิน', exact: true }); await button.waitFor();
      const resetAt = Date.parse((await request(base)).body.usage.resetsAt), region = page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
      assert.ok(Number.isFinite(resetAt));
      await db.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: new Date(resetAt - 1) } });
      await page.reload({ waitUntil: 'domcontentloaded' }); await button.waitFor();
      assert.ok(!(await region.innerText()).includes('รอบใหม่'), 'no future quota promise after the service expires');
      await db.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: new Date(resetAt + 86400000) } });
      await page.reload({ waitUntil: 'domcontentloaded' }); await button.waitFor();
      assert.ok((await region.innerText()).includes('รอบใหม่'), 'show the next monthly quota only within current service rights');
      await restoreTerm(); await page.reload({ waitUntil: 'domcontentloaded' }); await button.waitFor();
      unavailable = true; await button.click(); await page.getByRole('alert').filter({ hasText: 'ยังยืนยันผลรายการไม่ได้' }).waitFor();
      assert.equal(page.url(), billingUrl); unavailable = false;
      await page.route('https://billing.stripe.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><main><h1>Stripe จำลอง</h1><a href="${browser.origin}${returnPath}">กลับมั่งมี</a></main>` }));
      await button.click(); await page.getByRole('heading', { name: 'Stripe จำลอง' }).waitFor();
      await page.getByRole('link', { name: 'กลับมั่งมี', exact: true }).click(); await page.waitForURL(billingUrl); await button.waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' }); await button.waitFor();
      assert.ok(await button.evaluate(node => node.getBoundingClientRect().height >= 44));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true }).screenshot({ path: `${browser.evidenceDir}/billing-portal-return-mobile.png` });
      let release!: () => void, accepted!: () => void, finished!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { accepted = resolve; }), delivered = new Promise<void>(resolve => { finished = resolve; });
      const pattern = `**/api/v1/companies/${companyId}/billing/portal`;
      await page.route(pattern, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); accepted(); await pending; await route.fulfill({ response }); finished(); });
      await button.click(); await started; await page.getByRole('link', { name: 'เลือกบริษัทอื่น', exact: true }).click();
      await page.waitForURL('**/billing/companies'); await page.getByRole('heading', { name: 'เลือกบริษัทที่จะจัดการแพ็กเกจ', exact: true }).waitFor();
      release(); await delivered; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(page.url().endsWith('/billing/companies'), 'late response cannot redirect a departed billing page');
      await page.unroute(pattern); await page.unroute('https://billing.stripe.com/**');
      cases.push('browser-portal-failure-retry-stripe-return-reload-mobile-and-late-response-after-company-picker');
    }
    assert.deepEqual(await financial(), before); assert.equal(otherWrites, 0);
    cases.push('portal-access-never-mutates-money-quota-or-paid-rights'); return cases;
  } finally {
    input.transport(); await restoreCompany(); await restoreTerm(); await restoreSettings();
    await db.billingAccount.update({ where: { id: account.id }, data: { customerId: account.customerId, version: account.version, updatedAt: account.updatedAt } });
  }
}

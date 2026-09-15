import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AppConfigService } from '../common/config/app-config.service';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Real HTTP/PG/Next. External /server and /message-streams responses are explicitly simulated. */
export async function checkEmailMonitoring(input: { app: INestApplication; prisma: PrismaService; userId: string; membershipId: string;
  request: (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
  transport: (hook?: (url: URL, init?: RequestInit) => Promise<Response | undefined> | Response | undefined) => void;
}) {
  const { app, prisma, userId, membershipId, request, browser } = input, db = prisma.client, tag = randomUUID(), roleId = randomUUID();
  const config = app.get(AppConfigService), base = '/v1/system/email-delivery', scopeId = 90_000_000 + Math.floor(Math.random() * 1_000_000);
  const member = await db.companyMembership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } } } });
  const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: member.companyId } });
  const priorSystemLinks = member.roles.filter(link => link.role.isSystem && link.role.scopeKey === 'system');
  const configKeys = ['postmarkServerId', 'postmarkMessageStream', 'emailProvider'] as const;
  const descriptors = configKeys.map(key => Object.getOwnPropertyDescriptor(config, key));
  const override = (key: typeof configKeys[number], value: unknown) => Object.defineProperty(config, key, { configurable: true, value });
  let adminId: string | undefined, createdAdmin = false, nativeReads = 0, nativeMode = 'sandbox', providerHook: (() => Promise<void>) | undefined;
  const attempts: string[] = [], signupIds: string[] = [], eventIds: string[] = [], cases: string[] = [];
  const invoiceIds: string[] = [], createdAccountIds: string[] = [];
  const at = new Date(), yesterday = new Date(at.getTime() - 86400000), old = new Date(at.getTime() - 8 * 86400000);
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const list = (query = '') => request(`${base}${query ? `?${query}` : ''}`), connect = () => request(`${base}/connection`);
  const createAttempt = async (data: Record<string, unknown> = {}) => {
    const row = await db.emailSendAttempt.create({ data: { intentKey: `monitor:${tag}:${attempts.length}`, generation: 1, purpose: 'password_reset',
      provider: 'postmark', providerServerId: scopeId, stream: 'outbound', recipient: 'PRIVATE_RECIPIENT@example.test', createdAt: yesterday,
      status: 'ACCEPTED', submittedAt: yesterday, errorCode: 'PRIVATE_DIAGNOSTIC', ...data } }); attempts.push(row.id); return row;
  };
  const snapshots = () => Promise.all([
    db.emailSendAttempt.findMany({ where: { id: { in: attempts } }, orderBy: { id: 'asc' } }),
    db.companySignupRequest.findMany({ where: { id: { in: signupIds } } }),
    db.accountClaimToken.count({ where: { signupRequestId: { in: signupIds } } }),
    db.emailSuppression.count({ where: { providerServerId: scopeId } }),
    db.outboxEvent.findMany({ where: { id: { in: eventIds } }, orderBy: { id: 'asc' } }),
    db.companyPlanTerm.findUnique({ where: { companyId: member.companyId } }),
    db.billingReceiptGrant.findMany({ where: { companyId: member.companyId }, orderBy: { id: 'asc' } }),
  ]).then(JSON.stringify);
  try {
    for (const link of priorSystemLinks) await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId, roleId: link.roleId } } });
    await db.companyPlanTerm.update({ where: { companyId: member.companyId }, data: { termEndsAt: new Date(Date.now() + 86400000) } });
    override('postmarkServerId', scopeId); override('postmarkMessageStream', 'outbound');
    assert.equal((await list()).status, 403);
    const permission = await db.permission.upsert({ where: { key: 'system.email_delivery.read' }, update: {}, create: { key: 'system.email_delivery.read', description: 'Synthetic monitoring reader' } });
    await db.role.create({ data: { id: roleId, key: `MONITOR_${tag}`, name: 'Synthetic monitor', isSystem: true, scopeKey: 'system', permissions: { create: { permissionId: permission.id } } } });
    await db.membershipRole.create({ data: { membershipId, roleId } }); assert.equal((await list()).status, 403, 'global permission alone is insufficient');
    const existing = await db.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
    const admin = existing ?? await db.role.create({ data: { key: 'SYSTEM_ADMIN', name: 'Synthetic platform role', isSystem: true, scopeKey: 'system' } });
    adminId = admin.id; createdAdmin = !existing; await db.membershipRole.create({ data: { membershipId, roleId: admin.id } });
    const empty = await list(); assert.equal(empty.status, 200, JSON.stringify(empty)); assert.equal(empty.body.items.length, 0); assert.equal(empty.body.totals.attempts, 0);
    for (const query of ['cursor[]=abc', 'cursor=%7B%7D', 'purpose=other', 'purpose[]=password_reset', 'review=false', 'recipient=private', 'limit=10000']) assert.equal((await list(query)).status, 400);
    assert.equal((await request(`${base}/connection?serverId=123`)).status, 400);
    cases.push('email-monitor-current-global-role-dedicated-permission-and-strict-query');

    const signup = await db.companySignupRequest.create({ data: { externalSignupId: `monitor-${tag}`, payloadHash: tag, companyName: 'Synthetic mail monitoring',
      ownerDisplayName: 'Synthetic owner', contactEmail: 'PRIVATE_SIGNUP@example.test', consentVersion: 'synthetic', state: 'EMAIL_FAILED' } }); signupIds.push(signup.id);
    for (let index = 0; index < 27; index++) await createAttempt({ intentKey: `monitor:${tag}:common`, generation: index + 1,
      status: index === 0 ? 'UNKNOWN' : 'ACCEPTED', submittedAt: index === 0 ? null : yesterday, possibleDuplicate: index === 0,
      deliveredAt: index === 1 ? at : null, suppressedAt: index === 2 ? at : null, nextRecoveryAt: index === 0 ? yesterday : null,
      ...(index === 3 ? { purpose: 'account_claim', signupRequestId: signup.id } : {}) });
    await createAttempt({ status: 'CONFIG', submittedAt: null, createdAt: old });
    await createAttempt({ status: 'PRIVATE_NEW_STATE', purpose: 'PRIVATE_NEW_PURPOSE', submittedAt: null });
    const foreign = await createAttempt({ providerServerId: scopeId + 1 }), otherStream = await createAttempt({ stream: 'foreign' });
    await createAttempt({ provider: 'ses' });
    const first = await list(); assert.equal(first.status, 200); assert.equal(first.body.items.length, 25); assert.ok(first.body.nextCursor);
    assert.equal(first.body.totals.attempts, 28); assert.equal(first.body.totals.intents, 2); assert.equal(first.body.totals.accepted, 26);
    assert.equal(first.body.totals.delivered, 1); assert.equal(first.body.totals.suppressed, 1); assert.equal(first.body.totals.possibleDuplicates, 1);
    assert.equal(first.body.pending.attempts, 1); assert.equal(first.body.pending.needsReview, 4); assert.equal(first.body.pending.overdueRecovery, 1);
    const second = await list(`cursor=${first.body.nextCursor}`); assert.equal(second.status, 200); assert.equal(second.body.items.length, 4); assert.equal(second.body.nextCursor, null);
    const rows = [...first.body.items, ...second.body.items]; assert.equal(new Set(rows.map(row => row.id)).size, 29);
    assert.ok(rows.every(row => ![foreign.id, otherStream.id].includes(row.id)));
    assert.ok(rows.some(row => row.state === 'UNRECOGNIZED' && row.purpose === 'other'));
    assert.doesNotMatch(JSON.stringify([first.body, second.body]), /PRIVATE|example\.test|recipient|intentKey|providerServerId|MessageId|ApiTokens|HtmlBody|token=/);
    const nativeAdminOnboarding = await db.rolePermission.findFirst({ where: { roleId: admin.id, permission: { key: 'system.company_onboarding.read' } } });
    assert.equal(rows.find(row => row.purpose === 'account_claim').signupHistoryPath, nativeAdminOnboarding ? `/system/signup-requests/${signup.id}/mail` : null);
    assert.equal((await list(`purpose=password_reset&cursor=${first.body.nextCursor}`)).status, 400);
    assert.equal((await list(`review=1&cursor=${first.body.nextCursor}`)).status, 400);
    const cursor = JSON.parse(Buffer.from(first.body.nextCursor, 'base64url').toString()); cursor.id = foreign.id;
    assert.equal((await list(`cursor=${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`)).status, 404);
    assert.equal((await list('review=1')).body.items.length, 4); assert.equal((await list('purpose=account_claim')).body.items.length, 1);
    const onboarding = await db.permission.upsert({ where: { key: 'system.company_onboarding.read' }, update: {}, create: { key: 'system.company_onboarding.read', description: 'Synthetic onboarding read' } });
    await db.rolePermission.create({ data: { roleId, permissionId: onboarding.id } });
    assert.equal((await list('purpose=account_claim')).body.items[0].signupHistoryPath, `/system/signup-requests/${signup.id}/mail`);
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: onboarding.id } } });
    cases.push('email-monitor-seven-day-facts-all-history-cursors-purpose-server-stream-and-safe-projection');

    const callbackBody = { RecordType: 'Delivery', ServerID: scopeId, MessageStream: 'outbound', MessageID: randomUUID(),
      Recipient: 'PRIVATE_RECIPIENT@example.test', DeliveredAt: old.toISOString(), Content: 'PRIVATE_CONTENT', Metadata: { sendAttemptId: randomUUID() } };
    const callback = () => request('/v1/public/postmark-events', 'POST', callbackBody, { authorization: `Basic ${Buffer.from(`${config.postmarkWebhookUsername}:${config.postmarkWebhookPassword}`).toString('base64')}` });
    assert.equal((await callback()).status, 200); assert.equal((await callback()).status, 200);
    const events = await db.outboxEvent.findMany({ where: { eventType: 'email.postmark.event.received', payloadJson: { path: ['serverId'], equals: scopeId } } });
    eventIds.push(...events.map(row => row.id)); assert.equal(events.length, 1); assert.doesNotMatch(JSON.stringify(events), /PRIVATE_CONTENT/);
    assert.equal((await list()).body.callbacks.received, 1); assert.equal((await list()).body.callbacks.pending, 1);
    await db.outboxEvent.update({ where: { id: eventIds[0]! }, data: { status: 'DEAD', lastError: 'PRIVATE_CALLBACK_ERROR' } });
    assert.equal((await list()).body.callbacks.failed, 1);
    const currentAccount = await db.billingAccount.findFirst({ where: { companyId: member.companyId, stripeAccountId: config.stripeAccountId!, livemode: false } })
      ?? await db.billingAccount.create({ data: { companyId: member.companyId, stripeAccountId: config.stripeAccountId!, livemode: false } }).then(row => { createdAccountIds.push(row.id); return row; });
    assert.ok(currentAccount);
    const foreignAccount = await db.billingAccount.create({ data: { companyId: member.companyId, stripeAccountId: `acct_ForeignMonitor${tag}`, livemode: false } }); createdAccountIds.push(foreignAccount.id);
    let billingPath = '';
    for (const account of [currentAccount, foreignAccount]) {
      const invoice = await db.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_Monitor${randomUUID()}`, offerSnapshot: {},
        policyRevisionId: 'SYNTHETIC_MONITOR', currency: 'thb', totalSatang: 0, paidSatang: 0, periodStart: yesterday, periodEnd: at, providerStatus: 'void', evidenceHash: 'SYNTHETIC_MONITOR', applyStatus: 'HELD' } }); invoiceIds.push(invoice.id);
      const outbox = await db.outboxEvent.create({ data: { companyId: member.companyId, eventType: 'billing.status.email', aggregateType: 'BillingInvoice', aggregateId: invoice.id,
        eventKey: `monitor-billing:${tag}:${account.id}`, payloadJson: { data: { recipientUserId: userId } }, status: 'DEAD' } }); eventIds.push(outbox.id);
      const mail = await createAttempt({ intentKey: `billing-notice:${outbox.id}`, purpose: 'billing_status', status: 'CONFIG', submittedAt: null });
      if (account.id === currentAccount.id) billingPath = `/system/billing/companies/${encodeURIComponent(member.companyId)}/deliveries/${encodeURIComponent(`email:${outbox.id}`)}`;
      else assert.equal((await list('purpose=billing_status')).body.items.find((row: any) => row.id === mail.id).billingHistoryPath, null);
    }
    const billingPermission = await db.permission.upsert({ where: { key: 'system.billing.read' }, update: {}, create: { key: 'system.billing.read', description: 'Synthetic billing read' } });
    await db.rolePermission.create({ data: { roleId, permissionId: billingPermission.id } });
    const billingRows = (await list('purpose=billing_status')).body.items;
    assert.equal(billingRows.filter((row: any) => row.billingHistoryPath).length, 1); assert.equal(billingRows.find((row: any) => row.billingHistoryPath).billingHistoryPath, billingPath);
    assert.equal((await request(`/v1${billingPath}`)).status, 200, 'original billing recovery remains readable');
    cases.push('email-monitor-original-billing-link-current-permission-and-provider-account-boundary');
    const snapshot = await snapshots();
    override('emailProvider', 'disabled'); const disabled = await list(); assert.equal(disabled.status, 200); assert.equal(disabled.body.outboundSelected, false); assert.equal(disabled.body.totals.attempts, 30);
    override('postmarkServerId', undefined); const missing = await list(); assert.equal(missing.status, 200); assert.equal(missing.body.totals, null); assert.equal(missing.body.items.length, 0);
    assert.equal((await connect()).body.status, 'NOT_CONFIGURED'); override('postmarkServerId', scopeId + 2);
    assert.equal((await list(`cursor=${first.body.nextCursor}`)).status, 400); override('postmarkServerId', scopeId);
    assert.equal(await snapshots(), snapshot);
    cases.push('email-monitor-deduplicated-late-unmapped-callback-disabled-outbound-and-missing-config');

    input.transport(async (url, init) => {
      if (url.origin !== 'https://api.postmarkapp.com') return;
      assert.equal(init?.method, 'GET', 'monitoring must never send or modify provider data'); nativeReads++;
      await providerHook?.();
      if (nativeMode === 'error') return response({ ErrorCode: 10, Message: 'PRIVATE_AUTH_ERROR' }, 401);
      if (url.pathname === '/server') return response({ ID: nativeMode === 'foreign' ? scopeId + 1 : scopeId,
        DeliveryType: nativeMode === 'live' ? 'Live' : 'Sandbox', ApiTokens: ['PRIVATE_API_TOKEN'], Name: 'PRIVATE_SERVER' });
      assert.equal(url.pathname, '/message-streams/outbound');
      return response({ ID: 'outbound', ServerID: scopeId, MessageStreamType: 'Transactional', ...(nativeMode === 'unknown' ? {} : { ArchivedAt: null }), ExpectedPurgeDate: '2099-01-01' });
    });
    const good = await connect(); assert.equal(good.status, 200); assert.equal(good.body.status, 'MATCHED'); assert.equal(good.body.facts.mode, 'SANDBOX');
    assert.doesNotMatch(JSON.stringify(good.body), /PRIVATE|ApiTokens|2099|ServerID/);
    nativeMode = 'foreign'; const beforeForeign = nativeReads; const mismatch = await connect(); assert.equal(mismatch.body.status, 'NEEDS_REVIEW'); assert.equal(mismatch.body.facts.mode, 'UNKNOWN'); assert.equal(nativeReads - beforeForeign, 1);
    nativeMode = 'unknown'; assert.equal((await connect()).body.status, 'NEEDS_REVIEW');
    nativeMode = 'error'; const failed = await connect(); assert.equal(failed.status, 200); assert.equal(failed.body.status, 'UNAVAILABLE'); assert.equal(failed.body.facts, null);
    nativeMode = 'sandbox'; providerHook = async () => { providerHook = undefined; await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId, roleId: admin.id } } }); };
    assert.equal((await connect()).status, 403, 'withdrawal during provider read must prevent returning observation');
    await db.membershipRole.create({ data: { membershipId, roleId: admin.id } });
    nativeMode = 'live'; assert.equal((await connect()).body.facts.mode, 'LIVE');
    // Local Redis startup can use its documented per-process fallback for an early read.
    // Exercise the current window instead of assuming all preceding calls used the same counter.
    let limited = await connect();
    for (let index = 0; limited.status !== 429 && index < 6; index++) limited = await connect();
    assert.equal(limited.status, 429); assert.ok(limited.body.retryAfterSeconds > 0);
    assert.equal(await snapshots(), snapshot);
    cases.push('email-monitor-native-safe-identity-unknown-failure-final-authority-and-throttle-no-send');

    if (browser) {
      const page = browser.page; await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${browser.origin}/system/partners`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'สถานะอีเมล', exact: true }).click(); await page.waitForURL('**/system/email-delivery');
      const history = page.getByRole('region', { name: 'ประวัติการส่งอีเมล', exact: true });
      await history.getByRole('button', { name: 'ประวัติหน้าถัดไป', exact: true }).click(); await history.getByRole('button', { name: 'ประวัติหน้าแรก', exact: true }).click();
      await page.getByLabel('ประเภทอีเมล', { exact: true }).selectOption('billing_status');
      await page.getByRole('link', { name: 'เปิดรายการแจ้งแพ็กเกจต้นทาง', exact: true }).click(); await page.getByRole('heading', { name: 'รายการแจ้งเตือนแพ็กเกจ', exact: true }).waitFor();
      await page.getByRole('region', { name: 'ประวัติการส่งอีเมล', exact: true }).waitFor();
      await page.getByRole('link', { name: 'สถานะอีเมล', exact: true }).click(); await page.waitForURL('**/system/email-delivery');
      await page.getByLabel('ประเภทอีเมล', { exact: true }).selectOption('account_claim'); await history.getByText('รับบัญชีใหม่ · ครั้งที่ 4', { exact: true }).waitFor();
      await page.getByLabel('เฉพาะรายการที่ต้องตรวจ', { exact: true }).check(); await history.getByText('ไม่มีรายการตรงกับตัวเลือกนี้', { exact: true }).waitFor();
      await page.getByLabel('เฉพาะรายการที่ต้องตรวจ', { exact: true }).uncheck();
      await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click(); await history.getByText('รับบัญชีใหม่ · ครั้งที่ 4', { exact: true }).waitFor();
      const check = page.getByRole('button', { name: 'ตรวจการเชื่อมต่อ Postmark', exact: true });
      // Next's first page compilation can outlast the earlier 60-second provider-read window.
      let browserLimit = await connect();
      for (let index = 0; browserLimit.status !== 429 && index < 6; index++) browserLimit = await connect();
      assert.equal(browserLimit.status, 429);
      const throttled = page.waitForResponse(r => r.url().endsWith('/email-delivery/connection')); await check.click(); assert.equal((await throttled).status(), 429);
      await page.getByRole('alert').filter({ hasText: 'ตรวจบ่อยเกินไป' }).waitFor();
      await new Promise(resolve => setTimeout(resolve, Math.min(60, browserLimit.body.retryAfterSeconds + 1) * 1000));
      await check.click(); await page.getByRole('status').filter({ hasText: 'บัญชีและช่องทางส่งตรงกับที่ตั้งไว้' }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${browser.evidenceDir}/admin-email-monitoring-mobile.png`, fullPage: true });
      await page.getByRole('region', { name: 'ตรวจบัญชี Postmark', exact: true }).screenshot({ path: `${browser.evidenceDir}/admin-email-connection-mobile.png` });
      await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId, roleId: admin.id } } });
      await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'สิทธิ์ดูประวัติอีเมล' }).waitFor();
      assert.equal(await history.locator('article').count(), 0); assert.equal(await page.getByRole('region', { name: 'ภาพรวมอีเมล' }).count(), 0);
      await db.membershipRole.create({ data: { membershipId, roleId: admin.id } });
      await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click(); await history.getByText('รับบัญชีใหม่ · ครั้งที่ 4', { exact: true }).waitFor();
      await page.getByRole('link', { name: 'กลับหน้าลูกค้า', exact: true }).click(); await page.waitForURL('**/system/partners');
      assert.equal(await snapshots(), snapshot);
      cases.push('browser-email-monitor-mobile-navigation-filter-pages-reload-provider-retry-and-permission-recovery');
    }
    return cases;
  } finally {
    input.transport();
    configKeys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(config, key, descriptor); else delete (config as unknown as Record<string, unknown>)[key]; });
    await db.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.billingInvoice.deleteMany({ where: { id: { in: invoiceIds } } }); await db.billingAccount.deleteMany({ where: { id: { in: createdAccountIds } } });
    await db.emailSendAttempt.deleteMany({ where: { id: { in: attempts } } }); await db.companySignupRequest.deleteMany({ where: { id: { in: signupIds } } });
    await db.membershipRole.deleteMany({ where: { membershipId, roleId: { in: [roleId, ...(adminId ? [adminId] : [])] } } });
    for (const link of priorSystemLinks) await db.membershipRole.upsert({ where: { membershipId_roleId: { membershipId, roleId: link.roleId } }, create: { membershipId, roleId: link.roleId }, update: {} });
    await db.role.deleteMany({ where: { id: { in: [roleId, ...(createdAdmin && adminId ? [adminId] : [])] } } });
    await db.companyPlanTerm.update({ where: { companyId: member.companyId }, data: { termEndsAt: term.termEndsAt } });
  }
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';

export async function checkBillingScheduledPolicy(input: Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const { request, approveRequest, browser, stripeAccountId, companyId } = input, db = input.prisma.client, base = '/v1/system/billing';
  const cases: string[] = [], ids: string[] = [], viewport = browser?.page.viewportSize();
  const settings = async () => { const r = await request(`${base}/settings`); assert.equal(r.status, 200, JSON.stringify(r)); return r.body; };
  const get = async (id: string) => { const r = await request(`${base}/configuration-changes/${id}`); assert.equal(r.status, 200, JSON.stringify(r)); return r.body; };
  const proof = async (actor = request) => { if (!(await actor(`${base}/settings`)).body.reauthenticatedUntil) assert.equal((await actor(`${base}/reauthenticate`, 'POST', { password: input.password })).status, 200); };
  const action = (op: any, name: string, actor = request) => actor(`${base}/configuration-changes/${op.id}/${name}`, 'POST', {
    expectedVersion: op.version, ...name === 'cancel' ? {} : { previewHash: op.previewHash } }, name === 'submit' ? { 'idempotency-key': `schedule-submit-${op.id}` } : undefined);
  const preview = async (effectiveAt: unknown, extra = {}) => { const s = await settings(); return request(`${base}/configuration-changes/preview`, 'POST', {
    type: 'PUBLISH_POLICY', expectedVersion: s.version, policy: { ...s.policy, graceDays: s.policy.graceDays === 7 ? 8 : 7 }, gates: s.gates,
    reason: 'ตรวจการตั้งเวลาโดยไม่เปลี่ยนสัญญาที่จ่ายแล้ว', effectiveAt, ...extra }); };
  const schedule = async () => { const p = await preview(new Date(Date.now() + 60000).toISOString()); assert.equal(p.status, 200, JSON.stringify(p)); ids.push(p.body.id);
    await proof(); const submitted = await action(p.body, 'submit'); assert.equal(submitted.status, 200, JSON.stringify(submitted));
    await proof(approveRequest); const approved = await action(submitted.body, 'approve', approveRequest); assert.equal(approved.status, 200, JSON.stringify(approved));
    assert.equal(approved.body.state, 'SCHEDULED'); return approved.body; };
  const due = (op: any) => mock.timers.setTime(Date.parse(op.scheduledFor) + 1);
  const state = () => db.billingSettings.findUniqueOrThrow({ where: { id: `${stripeAccountId}:test` } });
  const financial = async () => { const accounts = await db.billingAccount.findMany({ where: { stripeAccountId }, orderBy: { id: 'asc' } }); return { accounts,
    invoices: await db.billingInvoice.findMany({ where: { billingAccountId: { in: accounts.map(a => a.id) } }, orderBy: { id: 'asc' } }),
    grants: await db.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), term: await db.companyPlanTerm.findUnique({ where: { companyId } }) }; };
  const beforeFinancial = await financial(); let writes = 0;
  const transport = (hook?: Parameters<typeof input.transport>[0]) => input.transport(async (url, init) => { if (init?.method && init.method !== 'GET') writes++; return hook?.(url, init); });
  mock.timers.enable({ apis: ['Date'], now: Date.now() }); transport();
  try {
    const initial = await settings(), before = await state();
    for (const invalid of ['', false, '2026-02-30T00:00:00Z', '2026-09-15T12:00:00', new Date(Date.now() - 1).toISOString(), new Date(Date.now() + 366 * 86400000).toISOString()])
      assert.ok((await preview(invalid)).status >= 400);
    const at = new Date(Math.ceil((Date.now() + 900000) / 60000) * 60000).toISOString(); let pending: any;
    if (browser) {
      const page = browser.page; await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${browser.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('กำหนดวันเริ่มใช้ล่วงหน้า', { exact: true }).check();
      const local = await page.evaluate(iso => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }, at);
      await page.getByLabel('วันและเวลาที่ให้มีผล', { exact: true }).fill(local);
      await page.getByLabel('เหตุผลการเปลี่ยนค่า', { exact: true }).fill('กำหนดวันเริ่มใช้และกลับมาแก้ร่าง');
      await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ฉบับร่างที่บันทึกไว้' }).waitFor();
      const href = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(href);
      await page.goto(`${browser.origin}${href}`, { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).waitFor();
      assert.equal(await page.getByLabel('วันและเวลาที่ให้มีผล', { exact: true }).inputValue(), local);
      const draft = await get(href.split('/').at(-1)!); assert.equal(draft.proposed.effectiveAt, at); ids.push(draft.id);
      const mismatched = await preview(new Date(Date.parse(at) + 60000).toISOString(), { policy: draft.proposed.policy, reason: draft.reason, draftId: draft.id, draftVersion: draft.version });
      assert.equal(mismatched.body.code, 'CONTROL_PREVIEW_STALE');
      await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ตรวจผลกระทบก่อนส่ง' }).waitFor(); await proof();
      await page.getByRole('button', { name: 'ส่งคำขอให้ผู้อนุมัติ', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'รอผู้อนุมัติอีกคน' }).waitFor();
      const review = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(review);
      const submitted = await get(review.split('/').at(-1)!); assert.equal((await action(submitted, 'approve')).status, 403);
      await proof(approveRequest); const second = input.secondBrowser!.pages()[0]!;
      await second.goto(`${browser.origin}${review}`, { waitUntil: 'domcontentloaded' });
      await second.getByRole('button', { name: 'อนุมัติและรอวันที่กำหนด', exact: true }).click();
      await second.getByRole('status').filter({ hasText: 'อนุมัติแล้ว รอถึงกำหนด' }).waitFor();
      await second.reload({ waitUntil: 'domcontentloaded' }); await second.getByRole('status').filter({ hasText: 'อนุมัติแล้ว รอถึงกำหนด' }).waitFor();
      assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await second.screenshot({ path: `${browser.evidenceDir}/admin-scheduled-policy-mobile.png`, fullPage: true });
      pending = await get(submitted.id); ids.push(pending.id);
      cases.push('browser-schedule-timezone-draft-reload-hash-independent-approval-mobile');
    } else pending = await schedule();
    assert.deepEqual(await state(), before); assert.equal(pending.state, 'SCHEDULED');
    assert.equal((await action(pending, 'approve')).status, 403);
    assert.equal((await action(pending, 'apply')).body.code, 'CONTROL_SCHEDULE_NOT_DUE');
    assert.equal((await action(pending, 'approve', approveRequest)).body.id, pending.id);
    await input.drainOperations(); assert.deepEqual(await state(), before); assert.equal((await get(pending.id)).state, 'SCHEDULED');
    cases.push('schedule-strict-date-range-self-approval-idempotence-future-refusal-and-no-early-publication');
    due(pending); await proof();
    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/system/billing/configuration-changes/${pending.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'ใช้ค่าที่อนุมัติไว้ตอนนี้', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
    } else assert.equal((await action(pending, 'apply')).body.state, 'SUCCEEDED');
    const published = await get(pending.id), revision = await db.billingPolicyRevision.findUniqueOrThrow({ where: { id: published.activeRevisionId } });
    const row = await db.billingOperation.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(revision.approvedAt!.toISOString(), (row.resultJson as any).scheduledApproval.approvedAt);
    assert.equal((await state()).version, before.version + 1); await input.drainOperations(); assert.equal((await state()).version, before.version + 1);
    assert.equal((await action(published, 'apply')).body.state, 'SUCCEEDED');
    cases.push('schedule-worker-off-late-manual-apply-after-preview-expiry-result-reload-exactly-once');

    const cancelled = await schedule(), beforeCancel = await state();
    assert.equal((await action(cancelled, 'cancel', approveRequest)).body.state, 'CANCELLED'); due(cancelled); await input.drainOperations();
    assert.deepEqual(await state(), beforeCancel); assert.equal((await get(cancelled.id)).state, 'CANCELLED');
    cases.push('schedule-original-approver-cancel-preserves-policy-and-prevents-worker-publication');

    const worker = await schedule(), beforeWorker = await state(); due(worker);
    await Promise.all([input.drainOperations(), input.drainOperations()]);
    assert.equal((await get(worker.id)).state, 'SUCCEEDED'); assert.equal((await state()).version, beforeWorker.version + 1);
    assert.equal(await db.auditLog.count({ where: { targetId: worker.id, action: 'billing.configuration.published', actorType: 'SERVICE' } }), 1);
    cases.push('schedule-concurrent-workers-publish-once-with-service-audit');

    const stale = await schedule(), old = await settings(); await proof();
    const closed = await request(`${base}/settings/emergency-close`, 'POST', { expectedVersion: old.version, gates: { ...old.gates, new_sales: false, plan_changes: false },
      reason: 'หยุดขายก่อนถึงกำหนด ต้องไม่เปิดกลับอัตโนมัติ' }, { 'idempotency-key': `schedule-close-${randomUUID()}` });
    assert.equal(closed.status, 200, JSON.stringify(closed)); const closedState = await state(); due(stale); await input.drainOperations();
    assert.equal((await get(stale.id)).state, 'BLOCKED'); assert.deepEqual(await state(), closedState);
    const issue = await db.billingIssue.findFirstOrThrow({ where: { stripeAccountId, kind: 'CONFIGURATION_SCHEDULE_REVIEW', referenceId: stale.id } });
    await input.drainOperations(); assert.equal(await db.billingIssue.count({ where: { stripeAccountId, kind: issue.kind, referenceId: stale.id } }), 1);
    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/system/billing/issues/${issue.id}`, { waitUntil: 'domcontentloaded' });
      const link = page.locator(`a[href="/system/billing/configuration-changes/${stale.id}"]`); await link.waitFor(); await link.click();
      await page.getByRole('status').filter({ hasText: 'ต้องตรวจคำขอตามกำหนดใหม่' }).waitFor();
      await page.getByRole('button', { name: 'สร้างฉบับร่างจากคำขอนี้', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ฉบับร่างที่บันทึกไว้' }).waitFor();
      const copiedHref = await page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }).getAttribute('href'); assert.ok(copiedHref);
      const copy = await get(copiedHref.split('/').at(-1)!); ids.push(copy.id); assert.notEqual(copy.id, stale.id); assert.equal(copy.proposed.effectiveAt, stale.proposed.effectiveAt);
      assert.equal((await preview(copy.proposed.effectiveAt, { draftId: copy.id, draftVersion: copy.version, reason: copy.reason, policy: copy.proposed.policy, gates: copy.proposed.gates })).body.code, 'CONTROL_SCHEDULE_TIME');
    }
    await proof(); assert.equal((await action(await get(stale.id), 'cancel')).body.state, 'CANCELLED');
    assert.equal((await db.billingIssue.findUniqueOrThrow({ where: { id: issue.id } })).state, 'RESOLVED');
    cases.push('schedule-emergency-close-stale-source-deduplicated-case-copy-new-review-cancel-return');

    for (const actor of [0, 1]) {
      const denied = await schedule(), beforeDenied = await state();
      const membership = await db.companyMembership.findFirstOrThrow({ where: { companyId, userId: input.userIds[actor]! } });
      await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: membership.id, roleId: input.adminRoleId } } });
      try { due(denied); await input.drainOperations(); assert.deepEqual(await state(), beforeDenied);
        assert.equal((await db.billingOperation.findUniqueOrThrow({ where: { id: denied.id } })).state, 'BLOCKED'); }
      finally { await db.membershipRole.create({ data: { membershipId: membership.id, roleId: input.adminRoleId } }); }
    }
    const credential = await schedule(), beforeCredential = await state();
    await db.userCredential.update({ where: { userId: input.userIds[1]! }, data: { updatedAt: new Date(Date.now() + 1) } });
    due(credential); await input.drainOperations(); assert.equal((await get(credential.id)).state, 'BLOCKED'); assert.deepEqual(await state(), beforeCredential);
    cases.push('schedule-current-requester-approver-system-role-and-credential-version-revocation');

    const provider = await schedule(), beforeProvider = await state(); due(provider);
    transport(async url => url.pathname.startsWith('/v1/prices/') ? Response.json({ error: { code: 'synthetic_unavailable' } }, { status: 503 }) : undefined);
    await input.drainOperations(); transport(); assert.equal((await get(provider.id)).state, 'BLOCKED'); assert.deepEqual(await state(), beforeProvider);
    cases.push('schedule-provider-readiness-failure-blocks-without-changing-active-settings');

    const changedActor = await schedule(), beforeChangedActor = await state(); due(changedActor); let revoked = false;
    transport(async url => { if (!revoked && url.pathname.startsWith('/v1/prices/')) {
      revoked = true; await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: input.adminRoleId } } });
    } return undefined; });
    try { await input.drainOperations(); assert.equal((await db.billingOperation.findUniqueOrThrow({ where: { id: changedActor.id } })).state, 'BLOCKED'); assert.deepEqual(await state(), beforeChangedActor); }
    finally { transport(); if (revoked) await db.membershipRole.create({ data: { membershipId: input.membershipId, roleId: input.adminRoleId } }); }
    cases.push('schedule-authority-rechecked-after-provider-io-before-publication');

    const leased = await schedule(), beforeLease = await state(); due(leased);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }); let once = false;
    transport(async url => { if (!once && url.pathname.startsWith('/v1/prices/')) { once = true; entered(); await held; } return undefined; });
    const draining = input.drainOperations();
    try {
      await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Provider barrier not reached')), 10000); timer.unref(); })]);
      const running = await get(leased.id); assert.equal(running.state, 'RUNNING'); assert.ok(!running.allowedActions.includes('apply'));
      assert.equal((await action(running, 'cancel')).status, 409); await input.drainOperations(); assert.deepEqual(await state(), beforeLease);
      mock.timers.setTime(Date.now() + 121000); release(); await draining; transport();
      assert.deepEqual(await state(), beforeLease); const recover = await get(leased.id); assert.equal(recover.state, 'RUNNING'); assert.ok(recover.allowedActions.includes('apply'));
      await proof(); assert.equal((await action(recover, 'apply')).body.state, 'SUCCEEDED'); assert.equal((await state()).version, beforeLease.version + 1);
    } finally { release(); await draining; transport(); }
    cases.push('schedule-running-cancel-race-lease-expiry-old-worker-fence-and-manual-reclaim');

    const rollback = await schedule(), beforeRollback = await state(), revisionCount = await db.billingPolicyRevision.count({ where: { stripeAccountId } });
    const fn = `billing_schedule_${randomUUID().replaceAll('-', '')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.configuration.published' AND NEW."targetId"='${rollback.id}' THEN RAISE EXCEPTION 'synthetic schedule audit failure'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      due(rollback); await input.drainOperations(); assert.equal((await get(rollback.id)).state, 'BLOCKED');
      assert.deepEqual(await state(), beforeRollback); assert.equal(await db.billingPolicyRevision.count({ where: { stripeAccountId } }), revisionCount);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`); await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`); }
    cases.push('schedule-audit-failure-rolls-back-revision-settings-and-success-before-retained-case');

    const impact = await schedule(), beforeImpact = await state(), account = await db.billingAccount.findFirstOrThrow({ where: { companyId, stripeAccountId } });
    await db.billingAccount.update({ where: { id: account.id }, data: { pendingPlanChangeId: randomUUID() } });
    try { due(impact); await input.drainOperations(); assert.equal((await get(impact.id)).state, 'BLOCKED'); assert.deepEqual(await state(), beforeImpact); }
    finally { await db.billingAccount.update({ where: { id: account.id }, data: { pendingPlanChangeId: account.pendingPlanChangeId, updatedAt: account.updatedAt } }); }
    const expired = await preview(new Date(Date.now() + 60000).toISOString()); assert.equal(expired.status, 200); ids.push(expired.body.id); await proof();
    const submitted = await action(expired.body, 'submit'); assert.equal(submitted.status, 200); mock.timers.setTime(Date.now() + 61000); await proof(approveRequest);
    assert.equal((await action(submitted.body, 'approve', approveRequest)).body.code, 'CONTROL_SCHEDULE_TIME');
    const immediate = await preview(null); assert.equal(immediate.status, 200); ids.push(immediate.body.id); await proof(); const nowSubmit = await action(immediate.body, 'submit');
    await proof(approveRequest); assert.equal((await action(nowSubmit.body, 'approve', approveRequest)).body.state, 'SUCCEEDED');
    assert.equal((await settings()).policy.taxTreatment, initial.policy.taxTreatment); assert.equal(writes, 0); assert.deepEqual(await financial(), beforeFinancial);
    cases.push('schedule-material-impact-change-expired-approval-immediate-compatibility-and-no-financial-writes');
    return cases;
  } catch (error) {
    console.error(JSON.stringify({ stage: 'scheduled-policy', completed: cases }));
    if (browser) { console.error(JSON.stringify({ stage: 'scheduled-policy', completed: cases, path: new URL(browser.page.url()).pathname,
      alerts: await browser.page.locator('main [role="alert"]').allTextContents() }));
      await browser.page.screenshot({ path: `${browser.evidenceDir}/scheduled-policy-failure.png`, fullPage: true }); }
    throw error;
  } finally { mock.timers.reset(); input.transport(); if (browser && viewport) await browser.page.setViewportSize(viewport); }
}

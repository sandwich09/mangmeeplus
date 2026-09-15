import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import { maintainEmailHistory } from '../modules/auth/application/email-history-retention';
import { EmailDeliveryService } from '../modules/auth/application/email-delivery.service';
import { PostmarkEventsService } from '../modules/auth/application/postmark-events.service';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkEmailRetention(input: {
  prisma: PrismaService; serverId: number; roleId: string;
  request: (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const { prisma, serverId, roleId, request, browser } = input, db = prisma.client, scope = `postmark:${serverId}:outbound`;
  const base = '/v1/system/email-delivery/retention', tag = randomUUID(), ids: string[] = [], events: string[] = [];
  const ago = (days: number) => new Date(Date.now() - days * 86400000), old = ago(181), results: string[] = [];
  const create = async (extra: Record<string, any> = {}) => {
    const row = await db.emailSendAttempt.create({ data: { provider: 'postmark', providerServerId: serverId, stream: 'outbound',
      purpose: 'password_reset', intentKey: `retention:${tag}:${randomUUID()}`, generation: 1, recipient: `${tag}-${ids.length}@example.test`,
      status: 'ACCEPTED', providerMessageId: randomUUID(), dispatchStartedAt: old, submittedAt: old, deliveredAt: old, createdAt: old, updatedAt: old, ...extra } });
    ids.push(row.id); return row;
  };
  let manageId: string | undefined;
  try {
    const initial = await request(base); assert.equal(initial.status, 200); assert.equal(initial.body.enabled, false); assert.equal(initial.body.retentionDays, 180);
    let command = { scopeKey: initial.body.scopeKey, version: 0, retentionDays: 180, enabled: true, reason: 'ทดสอบเก็บประวัติครบกำหนด', commandId: randomUUID() };
    assert.equal((await request(base, 'PUT', command)).status, 403);
    const permission = await db.permission.upsert({ where: { key: 'system.email_delivery.manage' }, update: {}, create: { key: 'system.email_delivery.manage', description: 'Synthetic retention management' } });
    manageId = permission.id; await db.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    for (const patch of [{ retentionDays: 0 }, { retentionDays: 3651 }, { retentionDays: 1.5 }, { enabled: 'false' }, { reason: ' ' }, { commandId: 'bad' }, { unknown: true }]) {
      assert.equal((await request(base, 'PUT', { ...command, ...patch })).status, 400);
    }
    assert.equal((await request(base, 'PUT', { ...command, scopeKey: 'other' })).status, 409);
    const eligible = await create();
    const protectedRows = await Promise.all([
      create({ status: 'UNKNOWN', deliveredAt: null }), create({ status: 'ACCEPTED', deliveredAt: null }),
      create({ suppressedAt: old }), create({ possibleDuplicate: true }), create({ nextRecoveryAt: new Date() }),
      create({ deadlineAt: new Date(Date.now() + 86400000) }), create({ createdAt: ago(179), updatedAt: ago(179) }),
      create({ providerServerId: serverId + 1 }), create({ stream: 'different' }),
    ]);
    const mixed = await create(); protectedRows.push(mixed);
    protectedRows.push(await create({ intentKey: mixed.intentKey, generation: 2, status: 'RETRY' }));
    const pendingCallback = await create(); protectedRows.push(pendingCallback);
    const pending = await db.outboxEvent.create({ data: { eventKey: `retention:${tag}:pending`, eventType: 'email.postmark.event.received',
      aggregateType: 'EmailSendAttempt', aggregateId: pendingCallback.id, status: 'DEAD', payloadJson: {} } }); events.push(pending.id);
    const callback = await db.outboxEvent.create({ data: { eventKey: `retention:${tag}:delivered`, eventType: 'email.postmark.event.received',
      aggregateType: 'EmailSendAttempt', aggregateId: eligible.id, status: 'PUBLISHED', publishedAt: old, createdAt: old,
      payloadJson: { kind: 'Delivery', attemptId: eligible.id, serverId, stream: 'outbound', messageId: eligible.providerMessageId,
        recipient: eligible.recipient, occurredAt: old.toISOString() } } }); events.push(callback.id);
    assert.equal(await maintainEmailHistory(prisma, serverId, 'outbound'), 0, 'missing policy remains OFF');
    assert.equal((await request(base, 'PUT', command)).status, 200);
    const saved = await request(base, 'PUT', command); assert.equal(saved.status, 200); assert.equal(saved.body.version, 1);
    assert.equal(saved.body.history.length, 1, 'same command audits once');
    assert.equal((await request(base, 'PUT', { ...command, retentionDays: 181 })).status, 409);
    assert.equal((await request(base, 'PUT', { ...command, commandId: randomUUID() })).status, 409);
    results.push('email-retention-default-off-current-management-strict-input-scope-version-replay-audit');

    const before = await db.emailSendAttempt.findMany({ where: { id: { in: protectedRows.map(row => row.id) } }, orderBy: { id: 'asc' } });
    const cleaned = await Promise.all([maintainEmailHistory(prisma, serverId, 'outbound'), maintainEmailHistory(prisma, serverId, 'outbound')]);
    assert.equal(cleaned.reduce((a, b) => a + b, 0), 1);
    assert.deepEqual(await db.emailSendAttempt.findMany({ where: { id: { in: protectedRows.map(row => row.id) } }, orderBy: { id: 'asc' } }), before);
    const retained = await db.emailSendAttempt.findUniqueOrThrow({ where: { id: eligible.id } });
    assert.ok(retained.historyArchivedAt); assert.equal(retained.intentKey, eligible.intentKey); assert.equal(retained.recipient, eligible.recipient);
    assert.equal(retained.providerMessageId, eligible.providerMessageId);
    const compacted = await db.outboxEvent.findUniqueOrThrow({ where: { id: callback.id } });
    assert.equal(compacted.eventKey, callback.eventKey); assert.doesNotMatch(JSON.stringify(compacted.payloadJson), /recipient|occurredAt/);
    assert.ok((compacted.payloadJson as any).historyCompactedAt);
    results.push('email-retention-concurrent-bounded-cleanup-preserves-pending-suppression-identity-and-event-dedupe');

    const batch=await Promise.all(Array.from({length:101},()=>create()));
    await db.emailHistoryPolicy.update({where:{id:scope},data:{lastCleanupAt:null}});
    const trigger=`retention_audit_${tag.replaceAll('-','')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='email.history.cleaned' AND NEW."targetId"='${scope}' THEN RAISE EXCEPTION 'synthetic retention audit failure'; END IF; RETURN NEW; END $$`);
    try{
      await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      await assert.rejects(maintainEmailHistory(prisma,serverId,'outbound'));
      assert.equal(await db.emailSendAttempt.count({where:{id:{in:batch.map(row=>row.id)},historyArchivedAt:{not:null}}}),0,'failed audit rolls back the whole cleanup');
      assert.equal((await db.emailHistoryPolicy.findUniqueOrThrow({where:{id:scope}})).lastCleanupAt,null);
    }finally{
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
    }
    assert.equal(await maintainEmailHistory(prisma,serverId,'outbound'),100);
    assert.equal(await maintainEmailHistory(prisma,serverId,'outbound'),0,'one batch per hour');
    await db.emailHistoryPolicy.update({where:{id:scope},data:{lastCleanupAt:null}});
    assert.equal(await maintainEmailHistory(prisma,serverId,'outbound'),1,'next eligible batch resumes without skipping the remainder');
    results.push('email-retention-real-audit-rollback-100-row-cap-and-next-batch-continuation');

    const config = { emailProvider: 'postmark', postmarkServerId: serverId, postmarkMessageStream: 'outbound' } as any;
    const delivery = new EmailDeliveryService(prisma, config, {} as any);
    assert.equal((await delivery.prepare({ purpose: eligible.purpose, recipient: eligible.recipient, intentKey: eligible.intentKey })).id, eligible.id);
    await new PostmarkEventsService(config, prisma, delivery).apply({ kind: 'SpamComplaint', serverId, stream: 'outbound',
      messageId: eligible.providerMessageId!, recipient: eligible.recipient, occurredAt: new Date().toISOString(), eventId: tag, attemptId: eligible.id, suppress: true });
    const review = await request('/v1/system/email-delivery?review=1'); assert.equal(review.status, 200);
    assert.ok(review.body.items.some((row: any) => row.id === eligible.id), 'late complaint resurfaces archived evidence');
    assert.ok(await db.emailSuppression.findUnique({ where: { providerServerId_stream_recipient: { providerServerId: serverId, stream: 'outbound', recipient: eligible.recipient } } }));
    command = { ...command, commandId: randomUUID(), version: 1, enabled: false };
    assert.equal((await request(base, 'PUT', command)).status, 200);
    await db.emailHistoryPolicy.update({ where: { id: scope }, data: { lastCleanupAt: null } });
    assert.equal(await maintainEmailHistory(prisma, serverId, 'outbound'), 0);
    results.push('email-retention-late-complaint-visible-original-send-replay-and-disable-stops-next-cleanup');

    if (browser) {
      const page = browser.page; await page.goto(`${browser.origin}/system/email-delivery`, { waitUntil: 'domcontentloaded' });
      const panel = page.getByRole('region', { name: 'การเก็บประวัติเมล', exact: true });
      await panel.getByLabel('เก็บประวัติทั่วไปกี่วัน', { exact: true }).fill('1.5');
      await panel.getByLabel('เหตุผลที่แก้ไข', { exact: true }).fill('ทดสอบการบันทึกโดยผู้ดูแล');
      await panel.getByRole('button', { name: 'ตรวจรายการก่อนบันทึก', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: 'กรอกจำนวนวัน' }).waitFor();
      await panel.getByLabel('เก็บประวัติทั่วไปกี่วัน', { exact: true }).fill('365');
      await panel.getByRole('button', { name: 'ตรวจรายการก่อนบันทึก', exact: true }).click();
      let lost = false; const routePattern = '**/email-delivery/retention';
      await page.route(routePattern, async route => { if (!lost && route.request().method() === 'PUT') { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue(); });
      await panel.getByRole('button', { name: 'ยืนยันบันทึก', exact: true }).click();
      await panel.getByRole('button', { name: 'ลองรายการเดิมอีกครั้ง', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'บันทึกแล้ว' }).waitFor(); await page.unroute(routePattern);
      const final = await request(base); assert.equal(final.body.retentionDays, 365); assert.equal(final.body.enabled, false);
      assert.equal(final.body.history.filter((row: any) => row.reason === 'ทดสอบการบันทึกโดยผู้ดูแล').length, 1);
      await panel.getByText('ประวัติแก้ไขล่าสุด 25 รายการ', { exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await panel.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-100));
      await page.screenshot({ path: `${browser.evidenceDir}/admin-email-retention-20260915.png` });
      results.push('browser-email-retention-mobile-invalid-input-preview-lost-save-same-command-audit');
    }
    return results;
  } finally {
    if (manageId) await db.rolePermission.deleteMany({ where: { roleId, permissionId: manageId } });
    await db.outboxEvent.deleteMany({ where: { id: { in: events } } });
    await db.emailSuppression.deleteMany({ where: { providerServerId: serverId, recipient: { startsWith: tag } } });
    await db.emailSendAttempt.deleteMany({ where: { id: { in: ids } } });
    await db.emailHistoryPolicy.deleteMany({ where: { id: scope } });
    await db.auditLog.deleteMany({ where: { targetType: 'EmailHistoryPolicy', targetId: scope } });
  }
}

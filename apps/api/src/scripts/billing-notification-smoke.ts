import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { EmailDeliveryService } from '../modules/auth/application/email-delivery.service';

/** Only provider transport is simulated. Delivery claims, permissions and journals use PostgreSQL. */
export function billingNotificationFixture() {
  const mail: Array<Record<string, any>> = [], line: Array<{ key: string; body: string; authorization: string | null }> = [];
  const accepted = new Map<string, string>();
  let loseLine = true, loseMail = false, mailSuppressed = false,lineFailureText:string|undefined,mailFailureAttempt:string|undefined;
  const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
  return { mail, line, loseNextLine: (matchingText?:string) => { loseLine = true;lineFailureText=matchingText; }, loseNextMail: (attemptId?:string) => { loseMail = true;mailFailureAttempt=attemptId; }, suppressNextMail: () => { mailSuppressed = true; },
    request(url: URL, init?: RequestInit): Response | undefined {
      if (url.origin === 'https://api.line.me') {
        assert.equal(url.pathname, '/v2/bot/message/push');
        const key = new Headers(init?.headers).get('x-line-retry-key')!, body = String(init?.body);
        assert.match(key, /^[a-f0-9-]{36}$/); line.push({ key, body, authorization: new Headers(init?.headers).get('authorization') });
        if (accepted.has(key)) { assert.equal(accepted.get(key), body); return response({}, 409, { 'x-line-accepted-request-id': key }); }
        accepted.set(key, body);
        if (loseLine&&(!lineFailureText||body.includes(lineFailureText))) { loseLine = false;lineFailureText=undefined; throw new Error('Synthetic LINE accepted, response lost'); }
        return response({ sentMessages: [{ id: randomUUID() }] });
      }
      if (url.origin !== 'https://api.postmarkapp.com') return undefined;
      assert.equal(new Headers(init?.headers).get('x-postmark-server-token'), 'POSTMARK_API_TEST');
      if (url.pathname === '/email') {
        const input = JSON.parse(String(init?.body));
        assert.match(input.To, /@example\.test$/); assert.equal(input.Tag, 'billing_status'); assert.equal(input.Attachments, undefined);
        assert.equal(input.TrackOpens, false); assert.equal(input.TrackLinks, 'None');
        if (mailSuppressed) { mailSuppressed = false; return response({ ErrorCode: 406 }, 422); }
        const result = { MessageID: randomUUID(), SubmittedAt: new Date().toISOString(), ErrorCode: 0 };
        mail.push({ input, result });
        if (loseMail&&(!mailFailureAttempt||input.Metadata.sendAttemptId===mailFailureAttempt)) { loseMail = false;mailFailureAttempt=undefined; throw new Error('Synthetic Postmark accepted, response lost'); }
        return response(result);
      }
      assert.equal(url.pathname, '/messages/outbound');
      const matches = mail.filter(m => m.input.Metadata.sendAttemptId === url.searchParams.get('metadata_sendAttemptId'));
      return response({ TotalCount: matches.length, Messages: matches.map(m => ({ MessageID: m.result.MessageID, MessageStream: m.input.MessageStream,
        Metadata: m.input.Metadata, Recipients: [m.input.To], ReceivedAt: m.result.SubmittedAt })) });
    },
  };
}

export async function checkBillingNotifications(input: { prisma: PrismaService; companyId: string; userId: string; membershipId: string;
  drain: () => Promise<{ status: number; body: any }>; fixture: ReturnType<typeof billingNotificationFixture>; email: EmailDeliveryService;
  request: (path:string,method?:string,body?:unknown)=>Promise<{status:number;body:any}> }) {
  const { companyId, userId, membershipId, drain, fixture, email } = input, db = input.prisma.client, cases: string[] = [];
  const account = await db.billingAccount.findFirstOrThrow({ where: { companyId } });
  const invoice = await db.billingInvoice.findFirstOrThrow({ where: { billingAccountId: account.id, applyStatus: 'APPLIED' } });
  const parent = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: invoice.id, eventType: 'billing.invoice.applied' } });
  const event = await db.notificationEvent.findFirstOrThrow({ where: { companyId, sourceModule: 'billing', sourceId: invoice.id } });
  const recipient = await db.notificationRecipient.findFirstOrThrow({ where: { eventId: event.id, userId } });
  const state = async () => JSON.stringify({ term: await db.companyPlanTerm.findUnique({ where: { companyId } }),
    grants: await db.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }) });
  const before = await state(), settings = await db.billingSettings.findUniqueOrThrow({ where: { id: `${account.stripeAccountId}:test` } });
  const gate = async (enabled: boolean) => db.billingSettings.update({ where: { id: settings.id }, data: {
    gatesJson: { ...(settings.gatesJson as Record<string, boolean>), notification_delivery: enabled }, version: { increment: 1 },
  } });
  const run = async () => { const result = await drain(); assert.equal(result.status, 200, JSON.stringify(result)); return result.body; };
  const queueLine = async () => db.notificationDelivery.create({ data: { companyId, recipientId: recipient.id, channel: 'LINE', nextAttemptAt: new Date(0) } });
  // These rows exercise authorization/replay after eligibility, not the scheduler's timestamp boundary.
  const queueEmail = async () => db.outboxEvent.create({ data: { companyId, aggregateType: 'BillingInvoice', aggregateId: invoice.id, availableAt:new Date(0),
    eventType: 'billing.status.email', eventKey: `synthetic-notice:${randomUUID()}`, payloadJson: { data: { recipientUserId: userId } } } });
  // R-A7: the document recipient column, not a user.
  const queueRecipientEmail = async () => db.outboxEvent.create({ data: { companyId, aggregateType: 'BillingInvoice', aggregateId: invoice.id, availableAt:new Date(0),
    eventType: 'billing.status.email', eventKey: `synthetic-recipient-notice:${randomUUID()}`, payloadJson: { schemaVersion: 2, data: { recipientUserId: null } } } });

  // The paid mail follows the recipient the first payment captured (the verified owner email here).
  assert.equal(account.recipientEmail, `${userId}@example.test`);
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `billing:notice-email:${invoice.id}:recipient` } })).status, 'PUBLISHED');
  assert.equal(parent.status, 'PUBLISHED'); assert.equal(fixture.mail.length, 1);
  assert.equal(fixture.mail[0]!.input.To, `${userId}@example.test`);
  assert.match(fixture.mail[0]!.input.TextBody, new RegExp(`/companies/${companyId}/billing`));
  assert.equal(await db.notificationDelivery.count({ where: { recipientId: recipient.id, channel: 'WEB', status: 'SENT' } }), 1);
  const initialLine = await db.notificationDelivery.findFirstOrThrow({ where: { recipientId: recipient.id, channel: 'LINE' } });
  assert.equal(initialLine.status, 'QUEUED'); assert.equal(fixture.line.length, 1);
  await db.notificationDelivery.update({ where: { id: initialLine.id }, data: { nextAttemptAt: new Date(0) } });
  await run(); assert.equal(fixture.line.length, 2); assert.equal(fixture.line[0]!.key, fixture.line[1]!.key);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: initialLine.id } })).status, 'SENT');
  cases.push('billing-web-verified-owner-email-and-line-lost-response-stable-key');

  await db.notificationEvent.update({ where: { id: event.id }, data: { status: 'RESOLVED' } });
  await db.outboxEvent.update({ where: { id: parent.id }, data: { status: 'PENDING', availableAt: new Date(0) } });
  await run(); await run();
  assert.equal(await db.notificationEvent.count({ where: { companyId, sourceModule: 'billing', sourceId: invoice.id } }), 1);
  assert.equal(await db.notificationDelivery.count({ where: { recipientId: recipient.id } }), 2);
  assert.equal(fixture.mail.length, 1); assert.equal(fixture.line.length, 2);
  await db.notificationEvent.update({ where: { id: event.id }, data: { status: 'OPEN' } });
  cases.push('billing-outbox-replay-preserves-resolved-event-and-sent-deliveries');

  const paused = await queueLine(), pausedMail = await queueEmail();
  await gate(false); await run();
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: paused.id } })).status, 'QUEUED');
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: pausedMail.id } })).status, 'PENDING');
  await gate(true); await run();
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: paused.id } })).status, 'SENT');
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: pausedMail.id } })).status, 'PUBLISHED');
  cases.push('billing-notification-gate-close-reopen-resumes-existing-intents');

  const identity = await db.externalIdentity.findFirstOrThrow({ where: { userId, provider: 'LINE' } });
  const wrong = await queueLine(), sends = fixture.line.length;
  await db.externalIdentity.update({ where: { id: identity.id }, data: { providerChannelId: 'wrong-channel' } });
  await run(); assert.equal(fixture.line.length, sends);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: wrong.id } })).errorCode, 'NO_LINE_DELIVERY_TARGET');
  await db.externalIdentity.update({ where: { id: identity.id }, data: { providerChannelId: identity.providerChannelId } });
  const revokedLine = await queueLine(), revokedMail = await queueEmail(), mailCount = fixture.mail.length;
  const membershipRoles = await db.membershipRole.findMany({ where: { membershipId } });
  await db.membershipRole.deleteMany({ where: { membershipId } });
  const revokedDrain=await run(); assert.equal(fixture.line.length, sends); assert.equal(fixture.mail.length, mailCount);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: revokedLine.id } })).status, 'SUPPRESSED');
  const revokedResult=await db.outboxEvent.findUniqueOrThrow({where:{id:revokedMail.id}});
  if(revokedResult.status!=='PUBLISHED')console.error(JSON.stringify({stage:'revoked-billing-notice',drain:revokedDrain,status:revokedResult.status,
    availableAt:revokedResult.availableAt,createdAt:revokedResult.createdAt,lockedAt:revokedResult.lockedAt,lastError:revokedResult.lastError,
    databaseClock:await db.$queryRaw`SELECT now() AS now, clock_timestamp() AS clock`}));
  assert.equal(revokedResult.status, 'PUBLISHED');
  await db.membershipRole.createMany({ data: membershipRoles });
  await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } }); await queueEmail(); await run();
  assert.equal(fixture.mail.length, mailCount);
  // R-A7: the document recipient does not depend on an owner's verified email ...
  await queueRecipientEmail(); await run();
  assert.equal(fixture.mail.length, mailCount + 1); assert.equal(fixture.mail.at(-1)!.input.To, `${userId}@example.test`);
  await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  // ... and with no recipient stored nothing is sent and the notice goes to review.
  await db.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: null } });
  const noRecipient = await queueRecipientEmail(); await run();
  assert.equal(fixture.mail.length, mailCount + 1);
  assert.equal(await db.billingIssue.count({ where: { kind: 'NOTIFICATION_RECIPIENT_CHANGED', referenceId: noRecipient.id } }), 1);
  await db.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: account.recipientEmail } });
  cases.push('billing-wrong-line-channel-owner-withdrawal-and-unverified-email-do-not-send');

  const lost = await queueEmail(); fixture.loseNextMail(); await run();
  const lostAttempt = await db.emailSendAttempt.findFirstOrThrow({ where: { intentKey: `billing-notice:${lost.id}` } });
  assert.equal(lostAttempt.status, 'UNKNOWN');
  await db.emailSendAttempt.update({ where: { id: lostAttempt.id }, data: { nextRecoveryAt: new Date(0) } });
  await email.reconcileUnknown();
  await db.outboxEvent.update({ where: { id: lost.id }, data: { availableAt: new Date(0) } });
  const sentBefore = fixture.mail.length; await run(); assert.equal(fixture.mail.length, sentBefore);
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: lost.id } })).status, 'PUBLISHED');
  cases.push('billing-postmark-unknown-lookup-recovers-same-message-without-resend');

  const crashed = await queueLine(); fixture.loseNextLine(); await run();
  const crashJournal = await db.notificationDelivery.findUniqueOrThrow({ where: { id: crashed.id } });
  await db.notificationDelivery.update({ where: { id: crashed.id }, data: { status: 'SENDING', nextAttemptAt: new Date(0) } });
  await run(); assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: crashed.id } })).status, 'SENT');
  const aged = await queueLine();
  const journal = (crashJournal.metadataJson as any).billing;
  await db.notificationDelivery.update({ where: { id: aged.id }, data: { status: 'SENDING', attemptCount: 1,
    metadataJson: { billing: { ...journal, firstStartedAt: new Date(Date.now() - 24 * 3600000).toISOString() } } } });
  const countBeforeAged = fixture.line.length; await run(); assert.equal(fixture.line.length, countBeforeAged);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: aged.id } })).errorCode, 'LINE_UNKNOWN_REVIEW');
  const changed = await queueLine();
  await db.notificationDelivery.update({ where: { id: changed.id }, data: { metadataJson: { billing: { ...journal, binding: 'changed' } } } });
  await run(); assert.equal(fixture.line.length, countBeforeAged);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: changed.id } })).errorCode, 'LINE_BINDING_CHANGED');
  cases.push('billing-line-crashed-worker-recovers-aged-or-changed-intent-requires-review');

  const concurrentLine = await queueLine(), concurrentEmail = await queueEmail();
  const priorLine = fixture.line.length, priorMail = fixture.mail.length;
  await Promise.all([run(), run()]);
  assert.equal(fixture.line.length, priorLine + 1); assert.equal(fixture.mail.length, priorMail + 1);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: concurrentLine.id } })).status, 'SENT');
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: concurrentEmail.id } })).status, 'PUBLISHED');
  const otherAccount = await db.billingAccount.create({ data: { companyId, stripeAccountId: account.stripeAccountId, livemode: true } });
  const otherInvoice = await db.billingInvoice.create({ data: { billingAccountId: otherAccount.id, providerInvoiceId: `in_other${randomUUID().replaceAll('-', '')}`,
    offerSnapshot: {}, contractSnapshot: {}, policyRevisionId: invoice.policyRevisionId, currency: 'THB', totalSatang: 1, paidSatang: 1,
    periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, providerStatus: 'paid', applyStatus: 'APPLIED', appliedAt: new Date(), evidenceHash: 'synthetic-other-mode' } });
  const otherIntent = await db.outboxEvent.create({ data: { companyId, eventType: 'billing.invoice.applied', aggregateType: 'BillingInvoice',
    aggregateId: otherInvoice.id, eventKey: `synthetic-other-mode:${otherInvoice.id}`, payloadJson: {} } });
  await run(); assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: otherIntent.id } })).status, 'PENDING');
  assert.equal(await db.notificationEvent.count({ where: { sourceId: otherInvoice.id } }), 0);
  await db.outboxEvent.delete({ where: { id: otherIntent.id } });
  await db.billingInvoice.delete({ where: { id: otherInvoice.id } });
  await db.billingAccount.delete({ where: { id: otherAccount.id } });
  cases.push('billing-concurrent-workers-claim-once-and-cannot-consume-other-mode');

  const heldLine = await queueLine(), heldMail = await queueEmail();
  await db.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });
  const heldLineCount = fixture.line.length, heldMailCount = fixture.mail.length; await run();
  assert.equal(fixture.line.length, heldLineCount); assert.equal(fixture.mail.length, heldMailCount);
  await db.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
  await db.notificationDelivery.update({ where: { id: heldLine.id }, data: { nextAttemptAt: new Date(0) } });
  await db.outboxEvent.update({ where: { id: heldMail.id }, data: { availableAt: new Date(0) } });
  await run();
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: heldLine.id } })).status, 'SENT');
  await db.membershipRole.deleteMany({ where: { membershipId } });
  await db.outboxEvent.update({ where: { id: parent.id }, data: { status: 'PENDING', availableAt: new Date(0) } });
  await run(); assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: parent.id } })).status, 'FAILED');
  await db.membershipRole.createMany({ data: membershipRoles });
  await db.outboxEvent.update({ where: { id: parent.id }, data: { availableAt: new Date(0) } });
  await run(); assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: parent.id } })).status, 'PUBLISHED');
  cases.push('billing-security-hold-and-missing-owner-defer-with-recoverable-original-intents');

  const quiet = await queueLine();
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date()).split(':').map(Number);
  const aroundNow = (delta: number) => `${String((hour! + delta + 24) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const preference = await db.notificationPreference.create({ data: { companyId, userId, enabledChannelsJson: ['web', 'line'],
    enabledTriggerKeysJson: ['billing.package_updated'], timezone: 'Asia/Bangkok', quietHoursStart: aroundNow(-1), quietHoursEnd: aroundNow(1) } });
  const quietBefore = fixture.line.length; await run(); assert.equal(fixture.line.length, quietBefore);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: quiet.id } })).errorCode, 'QUIET_HOURS');
  await db.notificationPreference.update({ where: { id: preference.id }, data: { quietHoursStart: null, quietHoursEnd: null, enabledChannelsJson: ['web'] } });
  await db.notificationDelivery.update({ where: { id: quiet.id }, data: { nextAttemptAt: new Date(0) } });
  await run(); assert.equal(fixture.line.length, quietBefore);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: quiet.id } })).errorCode, 'PREFERENCE_SUPPRESSED');
  await db.notificationPreference.delete({ where: { id: preference.id } });
  cases.push('billing-quiet-hours-defer-and-explicit-line-preference-suppresses');

  const suppressed = await queueRecipientEmail(); fixture.suppressNextMail(); await run();
  assert.equal((await db.emailSendAttempt.findFirstOrThrow({ where: { intentKey: `billing-notice:${suppressed.id}` } })).status, 'SUPPRESSED');
  const emailCount = fixture.mail.length; await queueEmail(); await run(); assert.equal(fixture.mail.length, emailCount);
  assert.equal(await state(), before);
  cases.push('billing-mail-suppression-keeps-paid-term-and-receipt-grants-unchanged');
  // R-A7: the refused recipient is flagged once and the plan managers are told once.
  const bounced = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
  assert.ok(bounced.recipientBouncedAt); assert.ok(bounced.recipientBounceNotifiedAt);
  const bounceEvents = () => db.notificationEvent.count({ where: { companyId, title: 'อีเมลรับเอกสารส่งไม่ถึง' } });
  assert.equal(await bounceEvents(), 1); await run(); assert.equal(await bounceEvents(), 1);
  assert.equal(await db.auditLog.count({ where: { companyId, action: 'billing.recipient.bounced' } }), 1);
  cases.push('billing-recipient-column-drives-mail-and-bounce-flags-once');
  const protectedDelivery=await queueLine();
  await db.notificationDelivery.update({where:{id:protectedDelivery.id},data:{status:'FAILED',attemptCount:1,nextAttemptAt:null}});
  const protectedBefore=await db.notificationDelivery.findUniqueOrThrow({where:{id:protectedDelivery.id}});
  const retry=(id:string)=>input.request(`/v1/companies/${companyId}/notification-deliveries/${id}/retry`,'POST');
  const protectedResult=await retry(protectedDelivery.id);assert.equal(protectedResult.status,400,JSON.stringify(protectedResult));
  assert.equal(protectedResult.body.code,'NOTIFICATION_RETRY_REVIEW_REQUIRED');
  assert.deepEqual(await db.notificationDelivery.findUniqueOrThrow({where:{id:protectedDelivery.id}}),protectedBefore);
  cases.push('billing-company-notification-retry-cannot-bypass-billing-command');
  const genericEvent=await db.notificationEvent.create({data:{...event,payloadJson:{},sourceRefsJson:{},id:randomUUID(),sourceModule:'expenses',sourceType:'expense',sourceId:randomUUID(),dedupKey:`generic-retry-${randomUUID()}`}});
  try{
    const genericRecipient=await db.notificationRecipient.create({data:{companyId,userId,eventId:genericEvent.id,recipientReason:'owner'}});
    const generic=await db.notificationDelivery.create({data:{companyId,recipientId:genericRecipient.id,channel:'LINE',status:'FAILED',attemptCount:1}});
    const results=await Promise.all([retry(generic.id),retry(generic.id)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,400],JSON.stringify(results));
    const after=await db.notificationDelivery.findUniqueOrThrow({where:{id:generic.id}});assert.equal(after.status,'QUEUED');assert.equal(after.attemptCount,1);
    assert.equal(await db.auditLog.count({where:{targetId:generic.id,action:'notification_delivery.retry'}}),1);
    cases.push('ordinary-notification-retry-preserves-budget-and-concurrent-cas');
  }finally{await db.notificationEvent.delete({where:{id:genericEvent.id}});}
  return cases;
}

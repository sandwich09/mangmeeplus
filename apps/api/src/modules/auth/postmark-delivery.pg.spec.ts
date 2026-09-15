import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { EmailDeliveryService } from './application/email-delivery.service';
import { PostmarkEventsService, parsePostmarkEvent } from './application/postmark-events.service';
import { PostmarkClient } from './infrastructure/postmark.client';
import { PostmarkAuthMailerAdapter } from './infrastructure/postmark-auth-mailer.adapter';
import { AccountClaimTokenService } from '../external-signup/application/account-claim-token.service';
import { SignupClaimEmailService } from '../external-signup/application/signup-claim-email.service';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
describe('Postmark durable delivery on PostgreSQL', { skip: !databaseUrl }, () => {
  it('fences attempts, preserves business state and never confuses callback delivery with identity proof', async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `pm-${randomUUID()}`, recipient = `${tag}@example.test`, requestId = tag;
    const serverId = Math.floor(Math.random() * 1_000_000) + 1;
    const config = { emailProvider: 'postmark', postmarkServerId: serverId, postmarkMessageStream: 'outbound', postmarkServerToken: 'POSTMARK_API_TEST',
      postmarkFromAddress: 'system@example.test', postmarkFromName: 'Mangmee', sesWebBaseUrl: 'https://app.example.test', isLocal: true,
      postmarkWebhookUsername: 'test-webhook', postmarkWebhookPassword: 'synthetic-webhook-password-12345' } as any;
    const authorization = `Basic ${Buffer.from(`${config.postmarkWebhookUsername}:${config.postmarkWebhookPassword}`).toString('base64')}`;
    let sendCalls = 0, nextId = randomUUID();
    let transport: (url: string, init: RequestInit) => Promise<Response> = async () => {
      sendCalls += 1;
      return new Response(JSON.stringify({ ErrorCode: 0, MessageID: nextId, SubmittedAt: new Date().toISOString() }));
    };
    const provider = new PostmarkClient(config, ((url: string, init: RequestInit) => transport(url, init)) as any);
    const delivery = new EmailDeliveryService({ client } as any, config, provider);
    const events = new PostmarkEventsService(config, { client } as any, delivery);
    const adapter = new PostmarkAuthMailerAdapter(config, delivery, { client } as any);
    const tokens = new AccountClaimTokenService({ client } as any);
    const callback = (attemptId: string, messageId: string, kind = 'Delivery') => ({
      RecordType: kind, ServerID: serverId, MessageStream: 'outbound', MessageID: messageId,
      Recipient: recipient, Email: recipient, DeliveredAt: new Date().toISOString(), BouncedAt: new Date().toISOString(),
      ID: Math.floor(Math.random() * 1_000_000), Inactive: kind === 'Bounce', Metadata: { sendAttemptId: attemptId }, Content: 'raw-secret-must-be-discarded',
    });
    try {
      await client.$queryRaw`SELECT 1`;
      await client.companySignupRequest.create({ data: { id: requestId, externalSignupId: tag, payloadHash: tag, companyName: 'Synthetic billing fixture',
        ownerDisplayName: tag, contactEmail: recipient, consentVersion: 'test-v1', state: 'EMAIL_PENDING', claimWindowStartedAt: new Date() } });
      await t.test('refuses unauthenticated callbacks before durable receipt', async () => {
        await assert.rejects(events.receive(undefined, callback(randomUUID(), nextId)));
        await assert.rejects(events.receive('Basic wrong', callback(randomUUID(), nextId)));
        assert.equal(await client.outboxEvent.count({ where: { eventType: 'email.postmark.event.received', payloadJson: { path: ['serverId'], equals: serverId } } }), 0);
      });
      await t.test('concurrent claim intents reserve only one in-flight generation', async () => {
        const results = await Promise.allSettled([1, 2].map((i) => delivery.prepare({ purpose: 'account_claim', recipient, signupRequestId: requestId, intentKey: `${tag}:race:${i}` })));
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(await client.emailSendAttempt.count({ where: { signupRequestId: requestId } }), 1);
        const attempt = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
        await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { status: 'PERMANENT' } });
      });
      await t.test('concurrent dispatch and replay send the same attempt at most once', async () => {
        const to = `${tag}-dispatch@example.test`;
        const attempt = await delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:dispatch` });
        const before = sendCalls;
        const input = { toEmail: to, rawToken: 'synthetic-proof', expiresAt: new Date(Date.now() + 60_000), sendAttemptId: attempt.id };
        const results = await Promise.allSettled([adapter.sendPasswordResetLink(input), adapter.sendPasswordResetLink(input)]);
        assert.ok(results.some((result) => result.status === 'fulfilled'));
        assert.equal(sendCalls - before, 1);
        await adapter.sendPasswordResetLink(input);
        assert.equal(sendCalls - before, 1);
        await assert.rejects(delivery.prepare({ purpose: 'email_verification', recipient: to, intentKey: `${tag}:dispatch` }));
        nextId = randomUUID();
      });
      await t.test('expiry and suppression before dispatch persist terminal state without contacting the provider', async () => {
        const before = sendCalls;
        for (const kind of ['expired', 'suppressed']) {
          const to = `${tag}-${kind}@example.test`;
          const attempt = await delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:${kind}` });
          if (kind === 'expired') await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { deadlineAt: new Date(0) } });
          else await client.emailSuppression.create({ data: { providerServerId: serverId, stream: 'outbound', recipient: to, reason: 'test' } });
          await assert.rejects(adapter.sendPasswordResetLink({ toEmail: to, rawToken: 'synthetic-proof', expiresAt: new Date(Date.now() + 60_000), sendAttemptId: attempt.id }));
          const settled = await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
          assert.equal(settled.status, kind === 'expired' ? 'PERMANENT' : 'SUPPRESSED');
          assert.equal(settled.nextRecoveryAt, null);
          assert.equal(settled.dispatchStartedAt, null);
        }
        assert.equal(sendCalls, before);
      });
      await t.test('claim worker records a Postmark ID only in provider-neutral attempts; replay does not mint or send twice', async () => {
        const service = new SignupClaimEmailService({ client } as any, {} as any, tokens, {} as any, {} as any, {} as any, {} as any, adapter,
          { info() {}, warn() {}, error() {} } as any, delivery, events);
        const before = sendCalls;
        await (service as any).sendClaimEmail(requestId, `${tag}:outbox`);
        await (service as any).sendClaimEmail(requestId, `${tag}:outbox`);
        assert.equal(sendCalls - before, 1);
        const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: requestId } });
        assert.equal(request.claimEmailSesMessageId, null);
        assert.equal(request.state, 'EMAIL_PENDING');
        const attempt = await client.emailSendAttempt.findUniqueOrThrow({ where: { id: request.latestClaimEmailAttemptId! } });
        assert.equal(attempt.providerMessageId, nextId);
        assert.equal(await client.accountClaimToken.count({ where: { signupRequestId: requestId, revokedAt: null } }), 1);
        const body = callback(attempt.id, nextId);
        await events.receive(authorization, body);
        await events.receive(authorization, body);
        const inbox = await client.outboxEvent.findMany({ where: { aggregateId: attempt.id } });
        assert.equal(inbox.length, 1);
        assert.doesNotMatch(JSON.stringify(inbox[0]!.payloadJson), /raw-secret|Content/);
        await events.apply(parsePostmarkEvent(body));
        assert.equal((await client.companySignupRequest.findUniqueOrThrow({ where: { id: requestId } })).state, 'EMAIL_PENDING');
        // Changing the outbound selection must not turn replay/reminder into cross-provider failover.
        config.emailProvider = 'ses';
        try {
          const rollback = new SignupClaimEmailService({ client } as any, {} as any, tokens, {} as any, {} as any, {} as any, {} as any,
            { sendAccountClaim: async () => assert.fail('No automatic SES failover') } as any,
            { info() {}, warn() {}, error() {} } as any, delivery, events);
          await (rollback as any).sendClaimEmail(requestId, `${tag}:outbox`);
          await assert.rejects((rollback as any).sendClaimEmail(requestId, `${tag}:new-after-rollback`),
            (error: any) => error.code === 'outbound_provider_changed');
        } finally { config.emailProvider = 'postmark'; }
      });
      await t.test('callback before response can suppress a claim and accepted response cannot undo the failure', async () => {
        nextId = randomUUID();
        const attempt = await delivery.prepare({ purpose: 'account_claim', recipient, signupRequestId: requestId, intentKey: `${tag}:early-bounce` });
        transport = async (_url, init) => {
          sendCalls += 1; const body = JSON.parse(init.body as string);
          assert.equal(body.Metadata.sendAttemptId, attempt.id);
          assert.equal(body.TrackOpens, false); assert.equal(body.TrackLinks, 'None');
          await events.apply(parsePostmarkEvent(callback(attempt.id, nextId, 'Bounce')));
          return new Response(JSON.stringify({ ErrorCode: 0, MessageID: nextId, SubmittedAt: new Date().toISOString() }));
        };
        await adapter.sendAccountClaim({ toEmail: recipient, companyName: tag, rawToken: 'synthetic-proof', expiresAt: new Date(Date.now() + 60000), sendAttemptId: attempt.id });
        const settled = await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        assert.equal(settled.status, 'SUPPRESSED');
        assert.equal((await client.companySignupRequest.findUniqueOrThrow({ where: { id: requestId } })).state, 'EMAIL_FAILED');
        await events.apply(parsePostmarkEvent(callback(attempt.id, nextId)));
        assert.equal((await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'SUPPRESSED');
        await assert.rejects(delivery.prepare({ purpose: 'password_reset', recipient, intentKey: `${tag}:suppressed` }));
      });
      await t.test('mismatched recipient or message identity cannot poison another attempt', async () => {
        const attempt = await client.emailSendAttempt.findFirstOrThrow({ where: { signupRequestId: requestId, status: 'SUPPRESSED' } });
        await assert.rejects(events.apply(parsePostmarkEvent({ ...callback(attempt.id, nextId), Recipient: 'somebody-else@example.test' })));
        await assert.rejects(events.apply(parsePostmarkEvent(callback(attempt.id, randomUUID()))));
      });
      await t.test('timeout keeps UNKNOWN until lookup; an empty lookup permits only a bounded, labelled retry', async () => {
        const to = `${tag}-unknown@example.test`;
        const attempt = await delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:unknown` });
        transport = async () => { sendCalls += 1; throw new Error('response lost'); };
        await assert.rejects(adapter.sendPasswordResetLink({ toEmail: to, rawToken: 'synthetic-secret', expiresAt: new Date(Date.now() + 60000), sendAttemptId: attempt.id }));
        assert.equal((await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'UNKNOWN');
        const calls = sendCalls;
        await assert.rejects(delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:unknown` }));
        assert.equal(sendCalls, calls);
        await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { nextRecoveryAt: new Date(0) } });
        transport = async (url) => {
          assert.match(url, /metadata_sendAttemptId/);
          return new Response(JSON.stringify({ TotalCount: 0, Messages: [] }));
        };
        assert.equal(await delivery.reconcileUnknown(), 0);
        assert.equal((await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'RETRY');
        await assert.rejects(delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:unknown` }));
        await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { nextRecoveryAt: new Date(0) } });
        const retry = await delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:unknown` });
        assert.equal(retry.generation, 2);
        assert.equal(retry.possibleDuplicate, true);
        assert.equal(sendCalls, calls);
        const dump = await client.emailSendAttempt.findMany({ where: { intentKey: { startsWith: tag } } });
        assert.doesNotMatch(JSON.stringify(dump), /synthetic-secret|synthetic-proof|raw-secret/);
      });
      await t.test('unknown lookup rejects mismatched metadata and accepts a single bound provider result', async () => {
        const to = `${tag}-lookup@example.test`;
        const attempt = await delivery.prepare({ purpose: 'password_reset', recipient: to, intentKey: `${tag}:lookup` });
        transport = async () => { throw new Error('response lost'); };
        await assert.rejects(adapter.sendPasswordResetLink({ toEmail: to, rawToken: 'synthetic-proof', expiresAt: new Date(Date.now() + 60_000), sendAttemptId: attempt.id }));
        const message = { MessageID: randomUUID(), MessageStream: 'outbound', Recipients: [to], ReceivedAt: new Date().toISOString(), Metadata: { sendAttemptId: String(randomUUID()) } };
        await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { nextRecoveryAt: new Date(0) } });
        transport = async () => new Response(JSON.stringify({ TotalCount: 1, Messages: [message] }));
        await delivery.reconcileUnknown();
        assert.equal((await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'UNKNOWN');
        message.Metadata.sendAttemptId = attempt.id;
        await client.emailSendAttempt.update({ where: { id: attempt.id }, data: { nextRecoveryAt: new Date(0) } });
        await delivery.reconcileUnknown();
        const settled = await client.emailSendAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        assert.equal(settled.status, 'ACCEPTED');
        assert.equal(settled.providerMessageId, message.MessageID);
        assert.equal(settled.submittedAt?.toISOString(), message.ReceivedAt);
      });
      await t.test('reviewed billing recovery reserves one unsent generation and preserves the failed attempt',async()=>{
        const intentKey=`billing-notice:${tag}:review`,to=`${tag}-review@example.test`;
        const first=await delivery.prepare({purpose:'billing_status',recipient:to,intentKey});
        transport=async()=>{sendCalls++;return new Response(JSON.stringify({ErrorCode:10}),{status:401});};
        const content={subject:'Synthetic billing status',html:'<p>synthetic</p>',text:'synthetic'};
        await assert.rejects(delivery.send(first,content));
        const failed=await client.emailSendAttempt.findUniqueOrThrow({where:{id:first.id}});assert.equal(failed.status,'CONFIG');
        const recover=(expectedLatestId:string)=>client.$transaction(tx=>delivery.prepareReviewedBilling({intentKey,recipient:to,expectedLatestId},tx));
        const results=await Promise.allSettled([recover(first.id),recover(first.id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        const ready=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;assert.equal(ready.status,'READY');assert.equal(ready.generation,2);assert.equal(ready.dispatchStartedAt,null);
        const before=sendCalls;assert.equal(await delivery.reconcileUnknown(ready.id),0);assert.equal(sendCalls,before);
        await assert.rejects(delivery.prepare({purpose:'billing_status',recipient:to,intentKey}));assert.equal((await recover(ready.id)).id,ready.id);
        assert.deepEqual(await client.emailSendAttempt.findUniqueOrThrow({where:{id:first.id}}),failed);
        nextId=randomUUID();transport=async()=>{sendCalls++;return new Response(JSON.stringify({ErrorCode:0,MessageID:nextId,SubmittedAt:new Date().toISOString()}));};
        assert.equal(await delivery.send(ready,content),nextId);assert.equal(await delivery.send(ready,content),nextId);assert.equal(sendCalls,before+1);
        assert.equal(await client.emailSendAttempt.count({where:{intentKey}}),2);await assert.rejects(recover(ready.id));
      });
      await t.test('reviewed recovery keeps suppression, current binding and five-generation limit',async()=>{
        const to=`${tag}-review-limits@example.test`,intentKey=`billing-notice:${tag}:limits`;
        const first=await delivery.prepare({purpose:'billing_status',recipient:to,intentKey});await client.emailSendAttempt.update({where:{id:first.id},data:{status:'CONFIG'}});
        const recover=(recipient=to)=>client.$transaction(tx=>delivery.prepareReviewedBilling({intentKey,recipient,expectedLatestId:first.id},tx));
        await assert.rejects(recover(`${tag}-different@example.test`));
        await client.emailSuppression.create({data:{providerServerId:serverId,stream:'outbound',recipient:to,reason:'synthetic suppression'}});
        await assert.rejects(recover());await client.emailSuppression.deleteMany({where:{providerServerId:serverId,recipient:to}});
        await client.emailSendAttempt.update({where:{id:first.id},data:{generation:5}});await assert.rejects(recover());
        assert.equal(await client.emailSendAttempt.count({where:{intentKey}}),1);
      });
      await t.test('late acceptance of an earlier generation prevents READY from dispatching',async()=>{
        const to=`${tag}-review-late@example.test`,intentKey=`billing-notice:${tag}:late`;
        const first=await delivery.prepare({purpose:'billing_status',recipient:to,intentKey});await client.emailSendAttempt.update({where:{id:first.id},data:{status:'RETRY',errorCode:'delivery_unconfirmed_possible_duplicate',nextRecoveryAt:new Date(0)}});
        const ready=await client.$transaction(tx=>delivery.prepareReviewedBilling({intentKey,recipient:to,expectedLatestId:first.id},tx));assert.equal(ready.possibleDuplicate,true);
        await client.emailSendAttempt.update({where:{id:first.id},data:{status:'ACCEPTED',providerMessageId:randomUUID(),deliveredAt:new Date()}});
        const before=sendCalls;await assert.rejects(delivery.send(ready,{subject:'synthetic',html:'synthetic',text:'synthetic'}));assert.equal(sendCalls,before);
        const stopped=await client.emailSendAttempt.findUniqueOrThrow({where:{id:ready.id}});assert.equal(stopped.status,'PERMANENT');assert.equal(stopped.errorCode,'prior_generation_accepted');assert.equal(stopped.dispatchStartedAt,null);
      });
    } finally {
      await client.auditLog.deleteMany({ where: { targetId: requestId } });
      await client.outboxEvent.deleteMany({ where: { eventType: 'email.postmark.event.received', payloadJson: { path: ['serverId'], equals: serverId } } });
      await client.emailSuppression.deleteMany({ where: { providerServerId: serverId } });
      await client.emailSendAttempt.deleteMany({ where: { providerServerId: serverId } });
      await client.accountClaimToken.deleteMany({ where: { signupRequestId: requestId } });
      await client.companySignupRequest.deleteMany({ where: { id: requestId } });
      await client.$disconnect();
    }
  });
});

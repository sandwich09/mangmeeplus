/** Run from the SWC build so this verifies Nest's real decorator metadata and module wiring. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { PROVIDER_EVENTS_PATH, providerEventsJson } from '../common/middleware/provider-events-body.middleware';

async function main() {
  const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'BILLING_TEST_DATABASE_URL is required; this smoke must not silently skip');
  const database = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(database.pathname));
  const serverId = Math.floor(Math.random() * 1_000_000) + 1;
  const webhookPassword = randomUUID();
  Object.assign(process.env, {
    APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', NODE_ENV: 'test', SERVICE_NAME: 'postmark-http-smoke',
    S3_BUCKET: 'synthetic-postmark-smoke', DATABASE_URL: databaseUrl, EMAIL_PROVIDER: 'postmark', BILLING_MODE: 'disabled',
    POSTMARK_SERVER_TOKEN: 'POSTMARK_API_TEST', POSTMARK_SERVER_ID: String(serverId), POSTMARK_MESSAGE_STREAM: 'outbound',
    POSTMARK_FROM_ADDRESS: 'system@example.test', WEB_BASE_URL: 'https://app.example.test',
    POSTMARK_WEBHOOK_USERNAME: 'smoke', POSTMARK_WEBHOOK_PASSWORD: webhookPassword,
    REQUEST_LOG_ENABLED: 'false', LOG_LEVEL: 'error', AWS_EC2_METADATA_DISABLED: 'true',
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.hostname, '127.0.0.1', 'This smoke forbids external provider requests');
    return nativeFetch(input, init);
  };
  const { AppModule } = await import('../app.module');
  const { PrismaService } = await import('../common/database/prisma.service');
  const { AUTH_MAILER_TOKEN } = await import('../modules/auth/domain/ports/auth-mailer.port');
  const { PostmarkEventsService } = await import('../modules/auth/application/postmark-events.service');
  const { POSTMARK_EVENT_TYPE } = await import('../modules/auth/application/email-delivery.service');
  const app = await NestFactory.create(AppModule, { abortOnError: false, bodyParser: false, logger: false });
  app.use(PROVIDER_EVENTS_PATH, providerEventsJson);
  app.use(json({ limit: '5mb' }));
  app.setGlobalPrefix('v1');
  const client = app.get(PrismaService).client;
  const caseIds: string[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    assert.equal(app.get(AUTH_MAILER_TOKEN).provider, 'postmark');
    caseIds.push('full-app-di-postmark-selection');
    const origin = await app.getUrl();
    const body = { RecordType: 'Delivery', ServerID: serverId, MessageStream: 'outbound', MessageID: randomUUID(),
      Recipient: 'synthetic@example.test', DeliveredAt: new Date().toISOString(), Content: 'raw-proof-must-not-be-persisted' };
    const authorization = `Basic ${Buffer.from(`smoke:${webhookPassword}`).toString('base64')}`;
    const post = (value: unknown, auth = authorization, path = '/v1/public/postmark-events') => fetch(`${origin}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(value),
    });
    for (const auth of ['', 'Basic invalid']) assert.equal((await post(body, auth)).status, 401);
    caseIds.push('missing-and-invalid-basic-auth');
    assert.equal((await post({ ...body, ServerID: serverId + 1 })).status, 400);
    assert.equal((await post({ ...body, MessageStream: 'foreign' })).status, 400);
    caseIds.push('server-and-stream-fence');
    assert.equal((await post({ RecordType: 'Open' })).status, 400);
    const malformed = await fetch(`${origin}/v1/public/postmark-events`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: '{"Content":raw-synthetic-proof}',
    });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /raw-synthetic-proof|Content/);
    caseIds.push('malformed-event-rejection');
    for (const path of ['/v1/public/postmark-events', '/v1/public/postmark-events/', '/v1/PUBLIC/POSTMARK-EVENTS']) {
      assert.equal((await post({ ...body, Content: 'x'.repeat(256 * 1024) }, authorization, path)).status, 413);
    }
    caseIds.push('oversize-case-and-trailing-slash');
    assert.equal((await post(body)).status, 200);
    assert.equal((await post(body)).status, 200);
    const rows = await client.outboxEvent.findMany({ where: { eventType: POSTMARK_EVENT_TYPE, payloadJson: { path: ['serverId'], equals: serverId } } });
    assert.equal(rows.length, 1);
    assert.doesNotMatch(JSON.stringify(rows[0]!.payloadJson), /raw-proof|Content|Authorization/);
    caseIds.push('durable-sanitized-receipt-and-dedupe');
    // Simulate the persistence fault at the repository boundary; the actual HTTP handler must return 503.
    const events = app.get(PostmarkEventsService);
    const originalPrisma = (events as any).prisma;
    (events as any).prisma = { client: { outboxEvent: { upsert: async () => { throw new Error('synthetic persistence fault'); } } } };
    try { assert.equal((await post({ ...body, MessageID: randomUUID() })).status, 503); }
    finally { (events as any).prisma = originalPrisma; }
    caseIds.push('http-503-on-persistence-failure');
    console.log(JSON.stringify({ layer: 'local-real-Nest-HTTP-PostgreSQL', passed: caseIds, externalDelivery: false }));
  } finally {
    await client.outboxEvent.deleteMany({ where: { eventType: POSTMARK_EVENT_TYPE, payloadJson: { path: ['serverId'], equals: serverId } } });
    await app.close();
    globalThis.fetch = nativeFetch;
  }
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Postmark HTTP smoke failed');
  process.exit(1);
});

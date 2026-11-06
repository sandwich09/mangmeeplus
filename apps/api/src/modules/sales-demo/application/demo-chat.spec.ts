import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { DemoChatService, validateDemoChatInput } from './demo-chat.service';
import { DemoChatController } from '../presentation/demo-chat.controller';
import { LineWebhookController } from '../../auth/presentation/line-webhook.controller';
import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { isDemoUnavailableRoute } from './demo-company-access';
import { assertDemoReadAvailable } from './demo-read-limit';

const ctx: any = { companyId: 'one', userId: 'owner', isDemo: true, roles: ['OWNER'], sessionId: 'session' };
function world() {
  const messages: any[] = [], envelopes: any[] = [], rates: any[] = [], objects: any[] = [];
  const link: any = { aiCreditUnits: 80, expiresAt: new Date(Date.now() + 100000), revokedAt: null,
    company: { reportClassification: 'DEMO', status: 'ACTIVE', planTerm: { termEndsAt: new Date(Date.now() + 100000), termDisabledAt: null } } };
  const db: any = { salesDemoLink: { findUnique: async () => link }, company: { findUnique: async () => ({ reportClassification: 'DEMO' }) },
    companyOcrUsageEvent: { count: async () => 0 }, demoChatMessage: { create: async ({ data }: any) => { messages.push(data); return { id: 'in', ...data }; } },
    attachmentObject: { create: async ({ data }: any) => { objects.push(data); return { id: 'attachment', ...data }; } } };
  const service = new DemoChatService({ client: db } as any, { lineAiDraftEditEnabled: true, uploadMaxBytes: 10 * 1024 * 1024 } as any,
    { consume: async (...args: any[]) => { rates.push(args); return { allowed: true }; } } as any,
    { enqueue: async (envelope: any) => { assert.equal(messages.at(-1).replyToken, envelope.item.replyToken); envelopes.push(envelope); } } as any,
    { putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 's3', byteSize: input.bytes.length, checksumSha256: 'sha', objectVersionId: 'v' }) } as any,
    { assertClean: async () => undefined } as any);
  return { service, controller: new DemoChatController(service), db, link, messages, envelopes, rates, objects };
}
it('only DEMO owner sessions can enqueue; expired/revoked terms never reach the buffer', async () => {
  const w = world();
  for (const [context, company, status] of [[{ ...ctx, isDemo: false }, 'one', 404], [ctx, 'two', 404], [{ ...ctx, roles: ['STAFF'] }, 'one', 403], [{ ...ctx, sessionId: undefined }, 'one', 403]] as const) {
    await assert.rejects(w.service.message(context, company, { text: 'hi' }), (e: any) => e.getStatus() === status);
  }
  w.link.expiresAt = new Date(0);
  await assert.rejects(w.service.message(ctx, 'one', { text: 'hi' }), (e: any) => e.getStatus() === 410 && e.getResponse().code === 'demo_link_expired');
  assert.equal(w.envelopes.length, 0); assert.equal(w.messages.length, 0);
});
it('strict text/postback validation rejects mixed or unbounded input', () => {
  for (const body of [{}, null, { text: '' }, { text: ' ' }, { text: 'x'.repeat(1001) }, { text: 'ok', postbackData: 'x' }, { postbackData: 1 }, { text: 'ok', companyId: 'other' }]) assert.throws(() => validateDemoChatInput(body));
  assert.deepEqual(validateDemoChatInput({ text: 'x'.repeat(1000) }), { text: 'x'.repeat(1000) });
  // What the ValidationPipe hands over: a DTO instance with the unset fields present as undefined.
  assert.deepEqual(validateDemoChatInput({ text: undefined, postbackData: 'action=fixed-read&id=expense_month', displayText: 'ค่าใช้จ่ายเดือนนี้' }),
    { postbackData: 'action=fixed-read&id=expense_month', displayText: 'ค่าใช้จ่ายเดือนนี้' });
  assert.deepEqual(validateDemoChatInput({ text: 'สวัสดี', postbackData: undefined, displayText: undefined }), { text: 'สวัสดี' });
});
for (const input of [{ text: 'ยอดเดือนนี้เท่าไหร่' }, { postbackData: 'action=line-rich-talk', displayText: 'คุยกับมั่งมี' }, { postbackData: 'action=package-callback' }, { postbackData: 'action=draft-update-confirm&previewId=12345678-1234-4123-8123-123456789abc' }]) {
  it(`LINE and demo controllers produce identical envelopes: ${'text' in input ? 'text' : input.postbackData}`, async () => {
    const w = world();
    await w.controller.message('one', input, { context: ctx } as any);
    const demo = w.envelopes[0]; assert.ok(demo);
    const seen: any[] = [];
    const line = new LineWebhookController(lineMessagingCredentialsFixture({ lineMessagingChannelId: 'demo-web', lineMessagingChannelSecret: 'secret' } as any), { lineAiDraftEditEnabled: true } as any, { enqueue: async (envelope: any) => seen.push(envelope) } as any);
    const event = { type: 'text' in input ? 'message' : 'postback', source: { type: 'user', userId: 'Vdemoone' }, replyToken: demo.item.replyToken, webhookEventId: demo.item.webhookEventId, timestamp: demo.item.timestamp,
      ...('text' in input ? { message: { type: 'text', text: input.text } } : { postback: { data: input.postbackData } }) };
    const body = { events: [event] }, rawBody = Buffer.from(JSON.stringify(body));
    await line.lineWebhook({ body, rawBody, headers: { 'x-line-signature': createHmac('sha256', 'secret').update(rawBody).digest('base64') } } as any);
    assert.deepEqual(seen[0], demo); assert.equal(demo.messagingChannelId, 'demo-web');
    assert.match(demo.item.replyToken, /^vreply:/); assert.equal(w.messages[0].direction, 'in');
    assert.deepEqual(w.rates[0], ['demo-chat-messages', 'one', 30, 600]);
  });
}
it('WebP upload is validated, stored under the tenant and enqueued as an existing attachment', async () => {
  const w = world(); const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).webp().toBuffer();
  await w.controller.file('one', { buffer, mimetype: 'image/webp', originalname: 'receipt.webp', size: buffer.length }, { context: ctx } as any);
  assert.equal(w.objects[0].companyId, 'one'); assert.equal(w.objects[0].mimeType, 'image/jpeg'); assert.match(w.objects[0].objectKey, /^one\/demo-chat\//);
  assert.equal(w.envelopes[0].item.kind, 'media'); assert.equal(w.envelopes[0].item.lineMessageId, 'demo-att:attachment');
  assert.deepEqual(w.messages[0].messagesJson, [{ type: 'image', fileName: 'receipt.webp' }]);
  assert.deepEqual(w.rates[0], ['demo-chat-files', 'one', 10, 3600]);
});
it('demo fourth web upload returns 403 and the agreed Thai way forward', async () => {
  const w = world(); w.db.companyOcrUsageEvent.count = async () => 3;
  await assert.rejects(assertDemoReadAvailable(w.db, { companyId: 'one', isDemo: true }), (e: any) => e.getStatus() === 403 && e.getResponse().code === 'demo_read_limit_reached' && /เปิดร้านจริงฟรี/.test(e.getResponse().message));
  await assert.rejects(w.service.file(ctx, 'one', undefined), (e: any) => e.getStatus() === 403);
  assert.equal(w.objects.length, 0); assert.equal(w.envelopes.length, 0);
});
it('upload completions and extraction are open while AI, billing, email and real LINE entry walls remain', () => {
  for (const path of ['expenses/e/receipt-uploads/a/complete', 'expenses/capture-groups/g/files/f/complete', 'expenses/e/extraction-request', 'demo-chat/messages', 'demo-chat/files']) assert.equal(isDemoUnavailableRoute('POST', `/v1/companies/one/${path}`), false, path);
  for (const path of ['ai/chat', 'billing/checkout', 'package-change-requests', 'crm/conversations/c/messages', 'crm/channels', 'settings/employees']) assert.equal(isDemoUnavailableRoute('POST', `/v1/companies/one/${path}`), true, path);
  for (const path of ['/v1/auth/account/email/send', '/v1/auth/line/link', '/v1/auth/password/change']) assert.equal(isDemoUnavailableRoute('POST', path), true, path);
});

it('polling is company-scoped, preserves exact outgoing cards, floors credits and follows durable waiting state', async () => {
  const w = world(); const createdAt = new Date('2026-11-06T00:00:00Z'); let running = true;
  const card = [{ type: 'flex', altText: 'ผล', contents: { type: 'bubble' }, quickReply: { items: [{ type: 'action', action: { type: 'postback', label: 'เลือก', data: 'action=line-rich-talk' } }] } }];
  w.db.demoChatMessage.findFirst = async ({ where }: any) => where.id === 'cursor' && where.companyId === 'one' ? { id: 'cursor', createdAt } : null;
  w.db.demoChatMessage.findMany = async ({ where }: any) => { assert.equal(where.companyId, 'one'); assert.equal(where.OR[1].id.gt, 'cursor'); return [{ id: 'next', direction: 'out', createdAt, messagesJson: card }]; };
  w.db.aiCreditGrant = { findMany: async () => [{ id: 'lot', units: 8000, sourceKind: 'SALES_EVENT', availableAt: new Date(0), expiresAt: new Date(Date.now() + 10000) }] };
  w.db.aiCreditEntry = { groupBy: async () => [{ grantId: 'lot', kind: 'CONSUME', _sum: { units: -199 } }] };
  w.db.aiBudgetReservation = { findMany: async () => [] };
  w.db.companyOcrUsageEvent.count = async () => 2;
  w.db.lineWebhookEventLog = { findFirst: async () => running ? { id: 'running' } : null };
  w.db.expenseCaptureReadJob = { findMany: async () => [], findFirst: async () => null };
  w.db.lineDocumentQaJob = { findFirst: async () => null };
  w.db.expenseRecord = { findFirst: async () => null };
  const result = await w.controller.messages('one', 'cursor', { context: ctx } as any);
  assert.deepEqual(result, { items: [{ id: 'next', direction: 'out', createdAt: createdAt.toISOString(), messages: card }], cursor: 'next', waiting: true, credit: { remaining: 78, total: 80 }, reads: { used: 2, limit: 3 } });
  running = false; assert.equal((await w.service.messages(ctx, 'one', 'cursor')).waiting, false);
  await assert.rejects(w.service.messages(ctx, 'one', 'other-company-cursor'), (e: any) => e.getStatus() === 400);
});
it('company rate limits reject before writing or enqueueing', async () => {
  const w = world(); (w.service as any).limits = { consume: async () => ({ allowed: false, retryAfterSeconds: 60 }) };
  await assert.rejects(w.service.message(ctx, 'one', { text: 'hi' }), (e: any) => e.getStatus() === 429);
  await assert.rejects(w.service.file(ctx, 'one', undefined), (e: any) => e.getStatus() === 429);
  assert.equal(w.messages.length, 0); assert.equal(w.objects.length, 0); assert.equal(w.envelopes.length, 0);
});

/** Local PostgreSQL proof for receipt identity, reservation races and exactly-once customer credit. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import { PrismaExpenseRepository } from '../expenses/infrastructure/prisma-expense.repository';
import { InitReceiptUploadUseCase, CompleteReceiptUploadUseCase } from '../expenses/application/use-cases/expense-upload.use-case';
import { PrismaAttachmentRepository } from '../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { CreateUploadIntentUseCase } from '../data-model-core/application/use-cases/create-upload-intent.use-case';
import { AiGatewayClient } from './infrastructure/ai-gateway.client';
import { LineReplyAdapter } from './infrastructure/line-reply.adapter';
import { RecoverOrphanLineEventsUseCase } from './application/use-cases/recover-orphan-line-events.use-case';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from './domain/logic/line-message-buffer.logic';
import { admitCompanyOcr, releaseCompanyOcrAdmission, LINE_RECEIPT_RETRY_LEASE_MS } from './application/company-ocr-governance';

const databaseUrl = process.env.RECEIPT_RELIABILITY_TEST_DATABASE_URL;

describe('receipt reliability on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `receipt-reliability-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const branchId = `${tag}-branch`;
  let client: PrismaClient;
  let unreachable: string | null = null;
  let storageReservations = 0;
  const noAudit = { log: async () => undefined } as any;
  const storage = {
    createUploadIntent: async (input: any) => {
      storageReservations += 1;
      return { uploadUrl: '/synthetic-upload', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date(),
        objectKey: input.objectKey, bucket: 'synthetic-local-test', storageProvider: 'local' };
    },
    getObjectMetadata: async () => ({ exists: false }),
  } as any;
  const ctx = () => ({ companyId, userId, requestId: randomUUID(), authProvider: 'line', membershipId: `${tag}-membership`,
    roles: ['OWNER'], scopes: {}, permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create'] } as any);

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    assert.equal(url.pathname, '/watchdog_bms', 'requires the local test database name');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'RECEIPT_RELIABILITY_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.user.create({ data: { id: userId, displayName: 'Synthetic receipt reliability', status: 'ACTIVE' } });
    await client.company.create({ data: { id: companyId, name: tag, businessCategory: 'SERVICE' } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'Synthetic branch', type: 'HEAD_OFFICE', createdByUserId: userId } });
  });
  after(async () => {
    if (!client) return;
    try {
      if (!unreachable) {
        await client.lineTurnOutcome.deleteMany({ where: { companyId } });
        await client.lineWebhookEventLog.deleteMany({ where: { companyId } });
        await client.aiUsageEvent.deleteMany({ where: { companyId } });
        await client.companyAiMonthlyUsage.deleteMany({ where: { companyId } });
        await client.auditLog.deleteMany({ where: { companyId } });
        await client.outboxEvent.deleteMany({ where: { companyId } });
        await client.companyOcrUsageEvent.deleteMany({ where: { companyId } });
        await client.companyOcrMonthlyUsage.deleteMany({ where: { companyId } });
        await client.companyAiConfiguration.deleteMany({ where: { companyId } });
        await client.attachmentLink.deleteMany({ where: { companyId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.attachmentObject.deleteMany({ where: { companyId } });
        await client.branch.deleteMany({ where: { companyId } });
        await client.company.deleteMany({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: userId } });
      }
    } finally { await client.$disconnect(); }
  });

  const sharedUpload = () => new CreateUploadIntentUseCase(new PrismaAttachmentRepository({ client } as any), storage, noAudit,
    { uploadMaxBytes: 1_000_000, uploadPendingMaxBytesPerCompany: 10_000_000, signedUrlTtlSeconds: 300 } as any);
  const init = (upload: any = sharedUpload()) => new InitReceiptUploadUseCase(new PrismaExpenseRepository({ client } as any), upload,
    noAudit, { execute: async () => ({ mode: 'FULL' }) } as any,
    { assertLaunchRouteOpen: async () => undefined } as any, { client } as any);
  const command = (messageId: string) => ({ originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
    expenseDate: '2026-09-07', branchId, captureSource: 'LINE_UPLOAD' as const,
    lineCapture: { lineMessageId: `${tag}-${messageId}`, lineEventId: `${tag}-original-event`, chatKeyHash: `${tag}-chat` } });

  it('serializes simultaneous new-event retries after losing the original reservation response', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const realUpload = sharedUpload();
    const failingUpload = { execute: async (...args: Parameters<typeof realUpload.execute>) => {
      await realUpload.execute(...args);
      throw new Error('synthetic process exit after reservation commit');
    }, resume: (...args: Parameters<typeof realUpload.resume>) => realUpload.resume(...args) };
    const cmd = command('reservation-crash');
    await assert.rejects(() => init(failingUpload).execute(ctx(), cmd), /synthetic process exit/);
    const captured = await client.expenseRecord.findFirstOrThrow({ where: { companyId, lineMessageId: cmd.lineCapture.lineMessageId } });
    const reserved = await client.attachmentObject.findMany({ where: { companyId, metadataJson: { path: ['lineReceiptExpenseId'], equals: captured.id } } });
    assert.equal(reserved.length, 1);
    const results = await Promise.all([init().execute(ctx(), cmd), init().execute(ctx(), {
      ...cmd, lineCapture: { ...cmd.lineCapture, lineEventId: `${tag}-new-webhook-event` },
    })]);
    assert.equal(results[0]!.expenseId, captured.id);
    assert.equal(results[1]!.expenseId, captured.id);
    assert.equal(results[0]!.attachmentId, reserved[0]!.id);
    assert.equal(results[1]!.attachmentId, reserved[0]!.id);
    assert.equal(await client.expenseRecord.count({ where: { companyId, lineMessageId: cmd.lineCapture.lineMessageId } }), 1);
    assert.equal(await client.attachmentObject.count({ where: { companyId, metadataJson: { path: ['lineReceiptExpenseId'], equals: captured.id } } }), 1);
  });

  it('uses the database identity fence even when two initial captures race', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const cmd = command('initial-race');
    const results = await Promise.all([init().execute(ctx(), cmd), init().execute(ctx(), cmd)]);
    assert.equal(results[0]!.expenseId, results[1]!.expenseId);
    assert.equal(results[0]!.attachmentId, results[1]!.attachmentId);
    assert.equal(await client.expenseRecord.count({ where: { companyId, lineMessageId: cmd.lineCapture.lineMessageId } }), 1);
  });

  it('resumes an ACTIVE reservation and finalizes its original primary without uploading or scanning twice', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const cmd = command('active-reservation');
    const original = await init().execute(ctx(), cmd);
    await client.attachmentObject.update({ where: { id: original.attachmentId }, data: { status: 'ACTIVE', checksumSha256: 'synthetic-checksum' } });
    const countBefore = storageReservations;
    const resumed = await init().execute(ctx(), cmd);
    assert.equal(resumed.uploadRequired, false);
    assert.equal(storageReservations, countBefore);
    const complete = new CompleteReceiptUploadUseCase(new PrismaExpenseRepository({ client } as any),
      { execute: async () => { throw new Error('ACTIVE image must not be reprocessed'); } } as any,
      noAudit, { append: async () => undefined } as any, new PrismaAttachmentRepository({ client } as any), { client } as any);
    const record = await complete.execute(ctx(), { expenseId: resumed.expenseId, attachmentId: resumed.attachmentId, checksumSha256: 'synthetic-checksum' });
    assert.equal(record.primaryAttachmentId, original.attachmentId);
    assert.equal(await client.attachmentLink.count({ where: { companyId, targetId: record.id, attachmentId: original.attachmentId } }), 1);
    await assert.rejects(() => init().execute({ ...ctx(), userId: `${tag}-other-user` }, cmd), /Forbidden/);
    await assert.rejects(() => init().execute({ ...ctx(), scopes: { branchIds: [] } }, cmd), /outside your assigned branch scope/);
  });

  it('recovers an expired pre-capture admission under one event lease, retaining its month and actual second provider cost', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const originalFetch = globalThis.fetch;
    const messageId = `${tag}-provider-crash`;
    let providerCalls = 0;
    try {
      globalThis.fetch = (async (url: unknown) => {
        if (!String(url).includes('/internal/ai/line-intake-route')) return new Response('{}');
        providerCalls += 1;
        return new Response(JSON.stringify({ status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99,
          usage: [{ tag: 'line-intake', modelId: 'anthropic.claude-sonnet-4-6', ok: true, inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }] }));
      }) as typeof fetch;
      const gateway = new AiGatewayClient({ aiGatewayInternalUrl: 'http://synthetic-gateway.test', aiGatewayInternalSecret: 'synthetic', aiThbPerUsd: 35, aiMonthlyBudgetSatang: 1000000 } as any,
        { issue: () => 'synthetic' } as any, undefined, { client } as any);
      const request = { requestId: `${tag}-provider-original`, companyId, userId, messageText: '', locale: 'th-TH', permissions: [], activeCategories: [],
        attachments: [{ id: messageId, mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }] };
      await (gateway as any).requestLineIntakeRouteAdmitted(request, messageId, '2026-08');
      await client.companyOcrUsageEvent.updateMany({ where: { companyId, requestId: messageId }, data: { createdAt: new Date(Date.now() - LINE_RECEIPT_RETRY_LEASE_MS - 1000) } });
      const retryIds = [`${tag}-provider-retry-a`, `${tag}-provider-retry-b`];
      for (const webhookEventId of retryIds) await client.lineWebhookEventLog.create({ data: {
        webhookEventId, companyId, eventType: 'message', lineUserIdHash: 'synthetic', status: 'received', processedAt: new Date(),
        payloadJson: { item: { lineMessageId: messageId, companyIdAtAcceptance: companyId } },
      } });
      const retried = await Promise.all(retryIds.map((id) => (gateway as any).requestLineIntakeRouteAdmitted({ ...request, requestId: id }, messageId, '2026-09', id)));
      assert.equal(retried.filter((result: any) => result.ocrAdmission === 'admitted').length, 1);
      assert.equal(providerCalls, 2, 'one original provider call plus one recovery, despite overlapping retries');
      assert.equal(retried.find((result: any) => result.ocrAdmission === 'admitted').ocrMonthKey, '2026-08');
      assert.equal((await client.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: '2026-08' } } })).usedCount, 1);
      const usage = await client.aiUsageEvent.findMany({ where: { companyId, requestId: { in: [request.requestId, ...retryIds] } } });
      assert.equal(usage.length, 2, 'both provider calls retain their independently metered spend');
      assert.equal(usage.reduce((sum, row) => sum + row.inputTokens, 0), 2000);
      assert.ok(usage.every((row) => row.costSatang > 0));
      // Once a capture exists, even an old fence and a fresh event are not permission to OCR again.
      const capture = await init().execute(ctx(), { ...command('provider-crash'), lineCapture: { ...command('provider-crash').lineCapture, lineMessageId: messageId } });
      await client.lineWebhookEventLog.updateMany({ where: { companyId, webhookEventId: { in: retryIds } }, data: { processedAt: new Date(Date.now() - LINE_RECEIPT_RETRY_LEASE_MS - 1) } });
      const fresh = `${tag}-provider-after-capture`;
      await client.lineWebhookEventLog.create({ data: { webhookEventId: fresh, companyId, eventType: 'message', lineUserIdHash: 'synthetic', status: 'received', processedAt: new Date(), payloadJson: { item: { lineMessageId: messageId, companyIdAtAcceptance: companyId } } } });
      assert.equal((await (gateway as any).requestLineIntakeRouteAdmitted({ ...request, requestId: fresh }, messageId, '2026-09', fresh)).ocrAdmission, 'denied');
      assert.equal(providerCalls, 2);
      assert.ok(capture.expenseId);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('retries a response-lost first push with identical bytes/key from JSONB and closes event/outcome coherently', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const originalFetch = globalThis.fetch;
    const eventId = `${tag}-outcome`;
    const messages = [{ type: 'flex' as const, altText: 'เก็บร่างแล้ว', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } } }];
    const calls: Array<{ key: string | null; body: string }> = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        calls.push({ key: new Headers(init?.headers).get('X-Line-Retry-Key'), body: String(init?.body) });
        if (calls.length === 1) throw new TypeError('synthetic response loss after LINE accepted');
        return new Response('', { status: 409, headers: { 'x-line-accepted-request-id': 'synthetic-accepted' } });
      }) as typeof fetch;
      const adapter = new LineReplyAdapter({ lineMessagingChannelAccessToken: 'synthetic' } as any);
      assert.equal(await adapter.sendPush('U-synthetic', messages, eventId), 'failed_other');
      await client.lineWebhookEventLog.create({ data: { webhookEventId: eventId, companyId, lineUserIdHash: 'synthetic', eventType: 'message',
        status: 'delivery_pending', errorCode: 'LINE_DELIVERY_FAILED_OTHER', createdAt: new Date(Date.now() - LINE_BUFFER_ORPHAN_REPROCESS_MS - 1000),
        payloadJson: { chatId: 'U-synthetic', lineUserId: 'U-synthetic', messagingChannelId: 'synthetic', item: { kind: 'media', webhookEventId: eventId, replyToken: 'expired', lineMessageId: `${tag}-image` } } } });
      await client.lineTurnOutcome.create({ data: { webhookEventId: eventId, companyId, messagesJson: messages, presentationKind: 'flex' } });
      const worker = new RecoverOrphanLineEventsUseCase({ client } as any, { lineAiTerminalOutcomeReplayEnabled: true, aiDataRetentionDays: 90 } as any,
        noAudit, { enqueue: async () => { throw new Error('business work must not be replayed'); } } as any, adapter);
      await Promise.all([worker.execute(), worker.execute()]);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
      assert.equal((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: eventId } })).status, 'completed');
      assert.ok((await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId: eventId } })).deliveredAt);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('serializes admission/compensation so one failure gives one credit and concurrent inputs cannot exceed quota', async (t) => {
    if (unreachable) return t.skip(unreachable);
    await client.companyAiConfiguration.create({ data: { companyId, ocrEnabled: true, ocrMonthlyLimit: 1 } });
    const input = { companyId, sourceRoute: 'receipt-ocr-line' as const, requestId: `${tag}-quota-operation`, monthKey: '2026-09' };
    const admitted = await Promise.all([admitCompanyOcr({ client } as any, input), admitCompanyOcr({ client } as any, input)]);
    assert.equal(admitted.filter((result) => result.allowed).length, 1);
    const credits = await Promise.all([1, 2].map(() => releaseCompanyOcrAdmission({ client } as any, { ...input, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' })));
    assert.deepEqual(credits, [true, true]);
    assert.equal((await client.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: input.monthKey } } })).usedCount, 0);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'receipt.ocr.admission.compensated' } }), 1);
    const next = await Promise.all([1, 2].map((n) => admitCompanyOcr({ client } as any, { ...input, requestId: `${tag}-quota-new-${n}` })));
    assert.equal(next.filter((result) => result.allowed).length, 1);
    assert.equal((await client.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: input.monthKey } } })).usedCount, 1);
  });
});

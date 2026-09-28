import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { LineCaptureResultNotifierUseCase, LINE_CAPTURE_READ_FINISHED_EVENT_TYPE } from './use-cases/line-capture-result-notifier.use-case';
import { ExpenseCaptureLineUseCase } from '../../expenses/application/use-cases/expense-capture-line.use-case';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { LineConversationContextService } from './line-conversation-context.service';
import { LineLedgerDeliveryService } from './line-ledger-delivery.service';
import { hashMessagePreview } from '../domain/logic/line-ai-classifier.logic';

const url = process.env.BILLING_TEST_DATABASE_URL;
test('DI capture outbox freezes real PostgreSQL source, replays after UNKNOWN/flag-off and refuses source revocation', { skip: !url }, async t => {
  const parsed = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok(parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927' || parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) }), prisma = { client } as PrismaService;
  const tag = randomUUID(), userId = `capture-${tag}`, lineUserId = `U${tag}`, channelId = `oa-${tag}`;
  const company = await client.company.create({ data: { name: `capture-${tag}` } });
  const contexts = new LineConversationContextService(prisma), plans = new LineLedgerDeliveryService(prisma), outbox = new PrismaOutboxRepository(prisma);
  const owner = { companyId: company.id, userId, membershipId: `m-${tag}`, channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: channelId, chatKeyHash: hashMessagePreview(lineUserId) };
  const conversation = await contexts.admit(owner), ownerBinding = { conversationId: conversation.id, membershipId: owner.membershipId, channelId, ownerEpoch: 0 };
  const config: any = { webBaseUrl: 'https://example.test', lineMessagingChannelId: channelId, lineAiReliabilityV2Mode: 'on', lineAiDeliveryPlanV2Enabled: true, lineAiReliabilityV2CompanyIds: [company.id], lineAiDeliveryPlanV2WriteCompanyIds: [company.id], aiDataRetentionDays: 30 };
  const access: any = { membershipId: owner.membershipId, roles: ['STAFF'], permissions: ['expense.receipt.line_upload'], scopes: {} };
  const capture = new ExpenseCaptureLineUseCase({} as any, prisma, {} as any);
  let reads = 0, sends: any[] = [], accept = false;
  const read = capture.readFinishedExpenseSnapshot.bind(capture);
  capture.readFinishedExpenseSnapshot = async (...args) => { reads++; return read(...args); };
  const notifier = new LineCaptureResultNotifierUseCase(prisma, config, { resolveAccess: async () => access } as any, capture, { updateLineIntakeAttemptOutcome: async () => true } as any,
    { sendFrozenV2: async (input: any) => { sends.push(structuredClone(input)); return accept ? { kind: 'accepted', code: 'API_ACCEPTED' } : { kind: 'unknown', code: 'NETWORK' }; } } as any,
    outbox, { execute: async () => { throw new Error('must not run handoff'); } } as any);
  Object.assign(notifier, { plans, contexts });
  async function fixture(empty = false) {
    const expense = await client.expenseRecord.create({ data: { companyId: company.id, createdByUserId: userId, expenseDate: new Date(), captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW', grandTotalAmount: empty ? '0' : '123.45', vendorNameSnapshot: 'ร้านทดสอบ', sourceChannelMetadataJson: { channel: 'LINE', chatKeyHash: owner.chatKeyHash, pushTargetId: lineUserId, ownerBinding } } });
    const job = await client.expenseCaptureReadJob.create({ data: { companyId: company.id, expenseId: expense.id, ownerType: 'EXPENSE', attachmentId: `attachment-${expense.id}`, attachmentChecksum: 'a'.repeat(64), status: 'DONE', ocrAdmissionRequestId: `ocr-${expense.id}`, manifestJson: {} } });
    const event = await outbox.append({ companyId: company.id, eventType: LINE_CAPTURE_READ_FINISHED_EVENT_TYPE, availableAt: new Date(0), aggregateType: 'expense', aggregateId: expense.id, eventKey: `capture-${expense.id}`, payloadJson: { ownerType: 'EXPENSE', expenseId: expense.id, jobId: job.id, status: 'DONE', applied: true, ...(empty ? { classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } } : {}) } });
    return { expense, job, event };
  }
  async function ready(id: string) {
    await client.outboxEvent.update({ where: { id }, data: { availableAt: new Date(0) } });
    await client.lineDeliveryPlan.updateMany({ where: { outboxEventId: id }, data: { nextAttemptAt: new Date(0) } });
  }
  try {
    await client.user.create({ data: { id: userId, displayName: 'capture fixture' } });
    await client.externalIdentity.create({ data: { userId, provider: 'LINE', providerUserId: lineUserId, providerChannelId: channelId } });
    await t.test('UNKNOWN replays saved body/key with flags off and no result recomposition', async () => {
      const { event } = await fixture();
      assert.equal((await notifier.execute()).parked, 1);
      const stored = await client.lineDeliveryPlan.findUniqueOrThrow({ where: { outboxEventId: event.id } });
      assert.equal(stored.status, 'UNKNOWN'); assert.equal(reads, 1);
      assert.equal((await client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status, 'FAILED');
      config.lineAiReliabilityV2Mode = 'off'; config.lineAiDeliveryPlanV2Enabled = false; accept = true;
      await ready(event.id); assert.equal((await notifier.execute()).pushed, 1);
      assert.equal(reads, 1); assert.deepEqual(sends[1].messages, sends[0].messages); assert.equal(sends[1].pushRetryKey, sends[0].pushRetryKey);
      // R-B1 exit 4: every result link was escaped once when the plan froze; the replay adds nothing.
      const wire = JSON.stringify(sends[0].messages);
      assert.equal(wire.split('openExternalBrowser=1').length, wire.split('https://example.test/').length);
      assert.ok(wire.includes('openExternalBrowser=1'));
      assert.equal((await client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status, 'PUBLISHED');
    });
    await t.test('source revision changes refuse saved output without another send', async () => {
      config.lineAiReliabilityV2Mode = 'on'; config.lineAiDeliveryPlanV2Enabled = true; accept = false;
      const { event, expense } = await fixture(); await notifier.execute(); const count = sends.length;
      await client.expenseRecord.update({ where: { id: expense.id }, data: { vendorNameSnapshot: 'changed' } });
      accept = true; await ready(event.id); assert.equal((await notifier.execute()).parked, 1); assert.equal(sends.length, count);
      assert.equal((await client.lineDeliveryPlan.findUniqueOrThrow({ where: { outboxEventId: event.id } })).status, 'REFUSED');
      assert.equal((await client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status, 'DEAD');
    });
    await t.test('NR07 soft receipt is readable after cancellation and retry never repeats deletion', async () => {
      accept = false; const { event, expense } = await fixture(true); const first = await notifier.execute(); assert.equal(first.claimed, 1); assert.equal(first.parked, 1);
      const cancelled = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
      assert.equal(cancelled.status, 'VOIDED'); assert.equal(cancelled.voidReason, 'LINE_NR07_EMPTY_DRAFT');
      const previousReads = reads; accept = true; await ready(event.id); assert.equal((await notifier.execute()).pushed, 1);
      assert.equal(reads, previousReads); assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).updatedAt.toISOString(), cancelled.updatedAt.toISOString());
    });
  } finally {
    await client.outboxEvent.deleteMany({ where: { companyId: company.id } });
    await client.company.delete({ where: { id: company.id } }); await client.user.deleteMany({ where: { id: userId } }); await client.$disconnect();
  }
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { ProcessLineWebhookUseCase } from './use-cases/process-line-webhook.use-case';
const url = process.env.BILLING_TEST_DATABASE_URL;
test('CI08 pending media replacement/supplement use atomic full-owner rows and never adopt another OA or active read job', { skip: !url }, async () => {
  const parsed = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927') || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const prefix = randomUUID(), companyId = `media-${prefix}`, userId = `user-${prefix}`, owner = { companyId, userId, membershipId: 'member', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'chat' };
  const rows = await Promise.all(['a', 'b', 'other'].map((name, i) => client.lineIntakePendingMedia.create({ data: {
    companyId, userId, lineMessageId: `${prefix}-${name}`, attachmentId: `${prefix}-${name}`, mimeType: 'image/png', status: 'PENDING',
    channelKind: 'USER', messagingChannelId: i === 2 ? 'other-oa' : 'oa', chatKeyHash: 'chat', membershipId: 'member', lifecycleEpoch: 3,
    expiresAt: new Date(Date.now() + 900000), askedQuestionJson: { kind: 'receipt', pageCount: 1 },
  } })));
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype), replies: string[] = [];
  Object.assign(flow, { prisma: { client }, boundConversations: new WeakMap(), deliverReply: async (_event: unknown, text: string) => replies.push(text), updateEventLog: async () => undefined });
  const command = async (messageText: string) => { const event = { messageText, webhookEventId: randomUUID() }; flow.boundConversations.set(event, { owner, epoch: 3 }); return flow.handlePendingMediaControl(event); };
  try {
    assert.equal(await command(`/media supplement ${rows[0]!.attachmentId} ${rows[1]!.attachmentId}`), true);
    let state = await client.lineIntakePendingMedia.findMany({ where: { companyId }, orderBy: { lineMessageId: 'asc' } });
    const a = state.find(row => row.id === rows[0]!.id)!, b = state.find(row => row.id === rows[1]!.id)!;
    assert.deepEqual((a.askedQuestionJson as any).selectedAttachmentIds, [a.attachmentId, b.attachmentId]);
    assert.equal((a.askedQuestionJson as any).selectedForContinuation, true); assert.equal((b.askedQuestionJson as any).selectedForContinuation, false);
    assert.equal(state.find(row => row.id === rows[2]!.id)!.revision, 0);
    await command(`/media replace ${a.attachmentId} ${b.attachmentId}`);
    state = await client.lineIntakePendingMedia.findMany({ where: { companyId } });
    assert.equal(state.find(row => row.id === a.id)!.status, 'EXPIRED');
    assert.equal((state.find(row => row.id === b.id)!.askedQuestionJson as any).selectedForContinuation, true);
    const before = JSON.stringify(state);
    await command(`/media select ${rows[2]!.attachmentId}`);
    assert.equal(JSON.stringify(await client.lineIntakePendingMedia.findMany({ where: { companyId } })), before);
    await client.lineIntakePendingMedia.update({ where: { id: b.id }, data: { readJobId: 'started-reader' } });
    await command(`/media select ${b.attachmentId}`);
    assert.match(replies.at(-1)!, /เริ่มอ่านแล้ว/);
  } finally { await client.lineIntakePendingMedia.deleteMany({ where: { companyId } }); await client.$disconnect(); }
});

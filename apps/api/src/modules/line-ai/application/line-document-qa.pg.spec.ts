import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { LineAiBudgetAuthorityService } from './line-ai-budget-authority.service';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { LineConversationContextService } from './line-conversation-context.service';
import { LineDocumentQaService, LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT, type LineDocumentQaAdmissionInput } from './line-document-qa.service';
import { LineDocumentQaWorker } from './line-document-qa.worker';
import { LINE_DOCUMENT_QA_READER_VERSION, type LineDocumentQaResult } from '@watchdog-bms/contracts';

const url = process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const model = 'gpt-4.1-mini';
const result = (attachmentId: string, page = 1): LineDocumentQaResult => ({ version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
  answer: 'ยอดรวม 1177 ตามหน้า 1', answerPageRefs: [{ attachmentId, page }],
  pages: [{ attachmentId, page, visibleText: 'TOTAL 1177', facts: [{ attachmentId, page, text: '1177', role: 'total', localSpan: { start: 6, end: 10 } }],
    evidence: [{ attachmentId, page, role: 'visible_text', text: 'TOTAL 1177', localSpan: { start: 0, end: 10 } }] }],
  coverage: { requested: [{ attachmentId, page }], read: [{ attachmentId, page }], failed: [] } });

describe('question-only durable QA and owner/source/lease fences on PostgreSQL', { skip: !url }, () => {
  const tag = `qa-${randomUUID().slice(0, 8)}`, bytes = new Map<string, Buffer>();
  let failStorageDelete = false;
  let client: PrismaClient, jobs: LineDocumentQaService, authority: LineAiBudgetAuthorityService, contexts: LineConversationContextService;
  before(async () => {
    const location = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(location.hostname));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) }); await client.$connect();
    const prisma: any = { client }, config: any = { lineAiDocumentQaEnabled: true, approvedAiModelIds: [model], aiGatewayInternalSecret: 'synthetic-qa-secret', aiMonthlyBudgetSatang: 1000000 };
    authority = new LineAiBudgetAuthorityService(prisma, config); contexts = new LineConversationContextService(prisma);
    jobs = new LineDocumentQaService(prisma, config, { getObject: async ({ objectKey }: any) => ({ bytes: bytes.get(objectKey)! }),
      getObjectMetadata: async ({ objectKey }: any) => ({ exists: bytes.has(objectKey), byteSize: bytes.get(objectKey)?.length ?? 0,
        objectVersionId: bytes.has(objectKey) ? hash(bytes.get(objectKey)!) : undefined }),
      deleteObject: async ({ objectKey }: any) => { if (failStorageDelete) throw new Error('synthetic unavailable'); bytes.delete(objectKey); },
    } as any, authority);
    Object.assign(jobs, { attachmentRepository: new PrismaAttachmentRepository(prisma), outbox: new PrismaOutboxRepository(prisma) });
  });
  after(async () => {
    if (!client) return;
    await client.lineIntakePendingMedia.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.lineWebhookEventLog.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.outboxEvent.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.company.deleteMany({ where: { id: { startsWith: tag } } });
    await client.user.deleteMany({ where: { id: { startsWith: tag } } }); await client.$disconnect();
  });
  async function fixture(suffix: string) {
    const companyId = `${tag}-${suffix}`, userId = `${companyId}-user`, membershipId = `${companyId}-member`, messagingChannelId = `${companyId}-oa`;
    await client.company.create({ data: { id: companyId, name: 'Synthetic QA company' } });
    await client.user.create({ data: { id: userId, displayName: 'Synthetic QA actor', status: 'ACTIVE' } });
    await client.companyMembership.create({ data: { id: membershipId, companyId, userId, status: 'ACTIVE' } });
    await client.lineChannelBinding.create({ data: { companyId, messagingChannelId } });
    const owner = { companyId, userId, membershipId, channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId, chatKeyHash: hash(userId) };
    const conversation = await contexts.admit(owner);
    const event = await client.lineWebhookEventLog.create({ data: { companyId, webhookEventId: `${companyId}-event`, eventType: 'message', status: 'received' } });
    const inputDigest = hash('synthetic original question');
    const grant = await authority.issue({ authorityKind: 'webhook_event', authorityId: event.id,
      owner: { kind: 'PRIVATE', owner, epoch: conversation.lifecycleEpoch }, turnKey: `${companyId}-turn`, attemptKey: `${companyId}-attempt`, inputDigest,
      requestKind: 'IMAGE', admittedAtMs: Date.now(), coalescingExtraMs: 0, lane: 'mixed', model: { provider: 'openai', modelId: model, region: 'US' },
      modelContextTokens: 1047576, modelMaxOutputTokens: 32768, allowedProfileIds: ['line-intake-image/2'],
      tariff: { provider: 'openai', modelId: model, region: 'US', version: 'synthetic:1', thbPerUsd: 33, usdPerMTok: { input: .4, output: 1.6, cacheRead: .1, cacheWrite: .4 } } }); assert.ok(grant);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
    const attachmentId = `${companyId}-attachment`; bytes.set(attachmentId, image);
    await client.attachmentObject.create({ data: { id: attachmentId, companyId, uploadedByUserId: userId, status: 'ACTIVE', storageProvider: 'local', bucket: 'synthetic-only',
      objectKey: attachmentId, originalFileName: 'synthetic.png', mimeType: 'image/png', byteSize: image.length, checksumSha256: hash(image) } });
    const input: LineDocumentQaAdmissionInput = { ...owner, ownerEpoch: conversation.lifecycleEpoch, requestId: `${companyId}-request`, turnId: grant.turnKey,
      question: 'ยอดรวมเท่าไร', originalBudgetGrantV2: grant, originalInputDigest: inputDigest, attachments: [{ attachmentId, requestedPages: [1] }] };
    return { input, owner, conversation, attachmentId };
  }

  it('deduplicates concurrent admission, keeps original deadlines and creates no financial/capture records', async () => {
    const f = await fixture('dedupe');
    const admitted = await Promise.all([jobs.admit(f.input), jobs.admit(f.input)]);
    assert.equal(admitted[0]!.jobId, admitted[1]!.jobId);
    const saved = await jobs.getById(admitted[0]!.jobId);
    assert.equal(saved.admittedAt.getTime(), f.input.originalBudgetGrantV2.admittedAtMs);
    assert.equal(saved.jobDeadlineAt.getTime(), saved.admittedAt.getTime() + 900000);
    assert.equal(await client.expenseRecord.count({ where: { companyId: f.input.companyId } }), 0);
    assert.equal(await client.expenseCaptureReadJob.count({ where: { companyId: f.input.companyId } }), 0);
    assert.equal(await client.reimbursementRequest.count({ where: { companyId: f.input.companyId } }), 0);
    assert.equal((await jobs.admit(f.input)).jobId, saved.id);
    await assert.rejects(jobs.admit({ ...f.input, messagingChannelId: 'wrong-oa' }), /QA_TURN_AUTHORITY_INVALID/);
  });

  it('rejects a manifest exceeding the existing input wire before persisting a job or transferring authority', async () => {
    const f = await fixture('oversize');
    await assert.rejects(jobs.admit({ ...f.input, question: 'ก'.repeat(11999) }), /QA_INPUT_TOO_LARGE/);
    assert.equal(await client.lineDocumentQaJob.count({ where: { companyId: f.input.companyId } }), 0);
    assert.ok(await authority.resolvePrivateOwner(f.input.originalBudgetGrantV2, f.input.originalInputDigest, f.owner));
  });

  it('refuses stale worker checkpoints, freezes exact results and verifies full-owner proof', async () => {
    const f = await fixture('fences'), admitted = await jobs.admit(f.input);
    const old = await jobs.claim(admitted.jobId, 'worker-old'); assert.ok(old);
    await client.lineDocumentQaJob.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } });
    const current = await jobs.claim(old.id, 'worker-current'); assert.ok(current);
    assert.equal(await jobs.markAnswerReady(old, 'worker-old', result(f.attachmentId)), false);
    assert.equal(await jobs.markAnswerReady(current, 'worker-current', result(f.attachmentId)), true);
    const ready = await jobs.getForDelivery(current.id, f.input); assert.ok(ready);
    const proof = jobs.buildDeliveryProof(ready);
    assert.equal(await jobs.verifyDeliveryProof(proof, f.input), false, 'an orphan answer is not authorized for delivery');
    const pending = await client.lineIntakePendingMedia.create({ data: {
      companyId: f.input.companyId, userId: f.input.userId, membershipId: f.input.membershipId, lineMessageId: `${ready.id}-message`,
      attachmentId: f.attachmentId, mimeType: 'image/png', status: 'PENDING', expiresAt: ready.purgeAt,
      lifecycleEpoch: f.input.ownerEpoch, channelKind: f.input.channelKind, messagingChannelId: f.input.messagingChannelId,
      chatKeyHash: f.input.chatKeyHash, readJobId: ready.id,
    } });
    assert.equal(await jobs.verifyDeliveryProof(proof, f.input), true);
    await client.lineIntakePendingMedia.update({ where: { id: pending.id }, data: { status: 'EXPIRED' } });
    assert.equal(await jobs.verifyDeliveryProof(proof, f.input), false, 'canceling a pending task fences a worker that already loaded ANSWER_READY');
    await client.lineIntakePendingMedia.update({ where: { id: pending.id }, data: { status: 'RESOLVED_RECEIPT' } });
    assert.equal(await jobs.verifyDeliveryProof(proof, f.input), true, 'accepted immutable replay still verifies');
    assert.equal(await jobs.verifyDeliveryProof({ ...proof, jobRevision: 999 }, f.input), false);
    assert.equal(await jobs.verifyDeliveryProof(proof, { ...f.input, chatKeyHash: hash('other-chat') }), false);
    await client.attachmentLink.deleteMany({ where: { targetId: ready.id } });
    assert.equal(await jobs.verifyDeliveryProof(proof, f.input), false);
  });

  it('binds semantic file questions to the original grant and refuses a missing or transplanted clause result', async () => {
    const f = await fixture('questions');
    f.input.question = 'ยอดรวมเท่าไร และวันที่เท่าไร';
    f.input.questions = [{ subrequestIndex: 0, question: 'ยอดรวมเท่าไร' }, { subrequestIndex: 2, question: 'วันที่เท่าไร' }];
    const admitted = await jobs.admit(f.input), claimed = await jobs.claim(admitted.jobId, 'worker'); assert.ok(claimed);
    assert.deepEqual(claimed.questionsJson, f.input.questions);
    assert.equal(await jobs.markAnswerReady(claimed, 'worker', result(f.attachmentId)), false, 'read-page coverage alone cannot prove both questions answered');
    const output: LineDocumentQaResult = { ...result(f.attachmentId), questionCoverage: [
      { subrequestIndex: 0, status: 'answered', answer: 'ยอดรวม1177', answerPageRefs: [{ attachmentId: f.attachmentId, page: 1 }] },
      { subrequestIndex: 2, status: 'unreadable', answer: 'ไม่เห็นวันที่', answerPageRefs: [] },
    ] };
    assert.equal(await jobs.markAnswerReady(claimed, 'worker', { ...output, questionCoverage: output.questionCoverage!.slice(0, 1) }), false);
    assert.equal(await jobs.markAnswerReady(claimed, 'worker', output), true);
    const ready = await jobs.getForDelivery(claimed.id, f.input); assert.ok(ready);
    assert.ok(String((ready.resultJson as any).answer).includes('1177'));
    await client.lineDocumentQaJob.update({ where: { id: claimed.id }, data: { questionsJson: [{ subrequestIndex: 0, question: 'ยอดรวมเท่าไร' }] } });
    assert.equal(await jobs.getForDelivery(claimed.id, f.input), null, 'changed question manifest invalidates frozen delivery');
  });

  it('runs actual image preprocessing and reader boundary once, with source and rendered hashes separate', async () => {
    const f = await fixture('worker'), admitted = await jobs.admit(f.input); let calls = 0;
    const worker = new LineDocumentQaWorker(jobs, { requestLineDocumentQa: async (request: any) => {
      calls++; assert.equal(request.pages.length, 1); assert.equal(request.pages[0].sourceMimeType, 'image/png');
      assert.equal(request.pages[0].renderedSha256, hash(Buffer.from(request.pages[0].contentBase64, 'base64')));
      assert.equal(request.pages[0].contentHash, hash(bytes.get(f.attachmentId)!));
      assert.equal(request.budgetGrantV2.attemptKey, f.input.originalBudgetGrantV2.attemptKey);
      return { status: 'ok', result: result(f.attachmentId) };
    } } as any);
    assert.equal((await worker.execute(admitted.jobId))?.status, 'ANSWER_READY');
    assert.equal((await worker.execute(admitted.jobId))?.status, 'ANSWER_READY'); assert.equal(calls, 1);
  });

  it('reads the selected PDF page from the actual DB blob and renders that page without expense side effects', async () => {
    const f = await fixture('pdf');
    const pdf = await PDFDocument.create(); pdf.addPage().drawText('Unselected page 1'); pdf.addPage().drawText('TOTAL 1177');
    const source = Buffer.from(await pdf.save());
    await client.attachmentObject.update({ where: { id: f.attachmentId }, data: { storageProvider: 'db', mimeType: 'application/pdf', byteSize: source.length, checksumSha256: hash(source) } });
    await client.attachmentBlob.create({ data: { attachmentId: f.attachmentId, companyId: f.input.companyId, data: new Uint8Array(source) } });
    f.input.attachments[0]!.requestedPages = [2];
    const admitted = await jobs.admit(f.input); let calls = 0;
    const worker = new LineDocumentQaWorker(jobs, { requestLineDocumentQa: async (request: any) => {
      calls++; assert.deepEqual(request.pages.map((page: any) => page.page), [2]);
      assert.equal(request.pages[0].sourceMimeType, 'application/pdf'); assert.equal(request.pages[0].mimeType, 'image/jpeg');
      assert.equal(request.pages[0].contentHash, hash(source));
      assert.notEqual(request.pages[0].renderedSha256, request.pages[0].contentHash);
      return { status: 'ok', result: result(f.attachmentId, 2) };
    } } as any);
    assert.equal((await worker.execute(admitted.jobId))?.status, 'ANSWER_READY'); assert.equal(calls, 1);
    assert.equal(await client.expenseRecord.count({ where: { companyId: f.input.companyId } }), 0);
  });

  it('purges only QA-created orphan DB bytes after24h and leaves generic source records alone', async () => {
    const f = await fixture('orphan'); const source = bytes.get(f.attachmentId)!;
    await client.attachmentObject.update({ where: { id: f.attachmentId }, data: { storageProvider: 'db', createdAt: new Date(Date.now() - 86400001), metadataJson: { lineDocumentQaOnly: true } } });
    await client.attachmentBlob.create({ data: { attachmentId: f.attachmentId, companyId: f.input.companyId, data: new Uint8Array(source) } });
    await jobs.purgeExpired();
    assert.equal(await client.attachmentBlob.count({ where: { attachmentId: f.attachmentId } }), 0);
    assert.equal(await client.attachmentObject.findUnique({ where: { id: f.attachmentId } }), null);
    const ordinary = await fixture('generic'); await client.attachmentObject.update({ where: { id: ordinary.attachmentId }, data: { createdAt: new Date(0) } });
    await jobs.purgeExpired();
    assert.equal((await client.attachmentObject.findUniqueOrThrow({ where: { id: ordinary.attachmentId } })).status, 'ACTIVE');
  });

  it('atomically excludes concurrent domain links from orphan byte deletion', { timeout: 10000 }, async () => {
    const f = await fixture('purge-race');
    await client.attachmentObject.update({ where: { id: f.attachmentId }, data: { storageProvider: 'db', createdAt: new Date(0), metadataJson: { lineDocumentQaOnly: true } } });
    await client.attachmentBlob.create({ data: { attachmentId: f.attachmentId, companyId: f.input.companyId, data: new Uint8Array(bytes.get(f.attachmentId)!) } });
    let announce!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { announce = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const repository = new PrismaAttachmentRepository({ client } as any);
    const scoped = new LineDocumentQaService({ client } as any, {} as any, {} as any, authority);
    Object.assign(scoped, { attachmentRepository: {
      markDeleted: async (input: any, tx: any) => { announce(); await proceed; return repository.markDeleted(input, tx); },
    }, outbox: new PrismaOutboxRepository({ client } as any) });
    const purging = scoped.purgeExpired();
    await locked;
    const linking = Promise.allSettled([client.attachmentLink.create({ data: { companyId: f.input.companyId, attachmentId: f.attachmentId,
      targetType: 'expense.record', targetId: 'synthetic-domain-target', purpose: 'receipt', linkedByUserId: f.input.userId } })]);
    release(); await purging;
    assert.equal((await linking)[0]!.status, 'rejected');
    assert.equal(await client.attachmentLink.count({ where: { attachmentId: f.attachmentId } }), 0);
    assert.equal(await client.attachmentBlob.count({ where: { attachmentId: f.attachmentId } }), 0);

    const shared = await fixture('preserve-shared');
    await client.attachmentObject.update({ where: { id: shared.attachmentId }, data: { storageProvider: 'db', createdAt: new Date(0), metadataJson: { lineDocumentQaOnly: true } } });
    await client.attachmentBlob.create({ data: { attachmentId: shared.attachmentId, companyId: shared.input.companyId, data: new Uint8Array(bytes.get(shared.attachmentId)!) } });
    await client.attachmentLink.create({ data: { companyId: shared.input.companyId, attachmentId: shared.attachmentId,
      targetType: 'expense.record', targetId: 'already-shared', purpose: 'receipt', linkedByUserId: shared.input.userId } });
    await jobs.purgeExpired();
    assert.equal(await client.attachmentBlob.count({ where: { attachmentId: shared.attachmentId } }), 1);
  });

  it('commits an exact-version cleanup receipt with external orphan removal and retries a failed storage deletion', async () => {
    const f = await fixture('external-orphan');
    await client.attachmentObject.update({ where: { id: f.attachmentId }, data: { createdAt: new Date(0),
      objectVersionId: hash(bytes.get(f.attachmentId)!), metadataJson: { lineDocumentQaOnly: true } } });
    failStorageDelete = true;
    try { await jobs.purgeExpired(); } finally { failStorageDelete = false; }
    assert.equal(await client.attachmentObject.findUnique({ where: { id: f.attachmentId } }), null);
    assert.equal(bytes.has(f.attachmentId), true);
    const receipt = await client.outboxEvent.findFirstOrThrow({ where: { companyId: f.input.companyId, eventType: LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT } });
    assert.equal(receipt.status, 'FAILED');
    await client.outboxEvent.update({ where: { id: receipt.id }, data: { availableAt: new Date(0) } });
    await jobs.purgeExpired();
    assert.equal(bytes.has(f.attachmentId), false);
    assert.equal((await client.outboxEvent.findUniqueOrThrow({ where: { id: receipt.id } })).status, 'PUBLISHED');
  });

  it('refuses changed bytes/owner and expires unclaimed jobs; purge clears failed raw data but preserves shared attachments', async () => {
    const f = await fixture('retention'), admitted = await jobs.admit(f.input);
    const claimed = await jobs.claim(admitted.jobId, 'worker'); assert.ok(claimed);
    bytes.set(f.attachmentId, Buffer.from('changed')); assert.equal(await jobs.canRun(claimed), false);
    await jobs.markFailed(claimed, 'worker', 'QA_SOURCE_CHANGED');
    await client.lineDocumentQaJob.update({ where: { id: claimed.id }, data: { purgeAt: new Date(0) } });
    await client.attachmentLink.create({ data: { companyId: f.input.companyId, attachmentId: f.attachmentId, targetType: 'EXPENSE', targetId: 'shared-domain-record', purpose: 'receipt', linkedByUserId: f.input.userId } });
    const pending = await client.lineIntakePendingMedia.create({ data: { companyId: f.input.companyId, userId: f.input.userId,
      lineMessageId: `${claimed.id}-pending`, attachmentId: f.attachmentId, readJobId: claimed.id, mimeType: 'image/png',
      caption: 'raw question', askedQuestionJson: { question: 'raw question' }, expiresAt: new Date(Date.now() + 60000) } });
    assert.equal(await jobs.purgeExpired(), 1);
    const purgedPending = await client.lineIntakePendingMedia.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(purgedPending.caption, null); assert.equal(purgedPending.askedQuestionJson, null); assert.equal(purgedPending.status, 'EXPIRED');
    assert.equal((await jobs.getById(claimed.id)).questionText, '');
    assert.equal(await client.attachmentLink.count({ where: { attachmentId: f.attachmentId, targetType: 'EXPENSE' } }), 1);
    const f2 = await fixture('expiry'), q2 = await jobs.admit(f2.input);
    await client.lineDocumentQaJob.update({ where: { id: q2.jobId }, data: { jobDeadlineAt: new Date(0) } });
    assert.equal(await jobs.expireDue(), 1); assert.equal((await jobs.getById(q2.jobId)).status, 'EXPIRED');
  });
});

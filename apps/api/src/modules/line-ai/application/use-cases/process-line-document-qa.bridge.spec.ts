import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';

function fixture() {
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  const event = { webhookEventId: 'event', lineUserId: 'line-user', replyToken: 'reply', lineMessageId: 'message', messagingChannelId: 'oa', channelKind: 'USER', messageType: 'image' };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'chat' };
  const ctx = { ...owner, requestId: 'request', permissions: ['line.ai.query', 'attachment.create'] };
  const access = { membershipId: 'member', permissions: ['line.ai.query', 'attachment.create'], entitledFeatureKeys: [], roles: [], scopes: {} };
  const trace: string[] = [], delivered: string[] = [];
  let pending: any = null, route: any = { status: 'ROUTED', semanticSubrequests: [{ index: 0, kind: 'file', goal: 'read file' }] };
  const grant = { turnKey: 'turn', admittedAtMs: Date.now(), authorityKind: 'webhook_event' };
  const result = { version: 1, readerVersion: 'line-document-qa/1', answer: 'เอกสารมีข้อความต้นทาง', answerPageRefs: [{ attachmentId: 'attachment', page: 1 }], pages: [{ attachmentId: 'attachment', page: 1, visibleText: 'ข้อความต้นทาง', facts: [], evidence: [] }],
    coverage: { requested: [{ attachmentId: 'attachment', page: 1 }], read: [{ attachmentId: 'attachment', page: 1 }], failed: [] } };
  const job = { id: 'job', resultJson: result, status: 'ANSWER_READY' };
  Object.assign(flow, {
    preserveSemanticTask: async () => true, bindDocumentQaTask: async () => undefined, restoreDocumentQaTask: async () => [],
    documentQaQuestions: () => [{ subrequestIndex: 0, question: 'อ่านไฟล์นี้ว่าอย่างไร' }], semanticTaskMappings: new WeakMap(), semanticDelivery: new WeakMap(),
    config: { lineAiDocumentQaEnabled: true }, mediaTextContinuations: new WeakMap(), boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]),
    deliveryAccess: new WeakMap([[event, { fingerprint: 'fingerprint' }]]), budgetGrantsV2: new WeakMap(), documentQaDelivery: new WeakMap(), intermediateDeliveries: new WeakSet(),
    prisma: { client: { lineIntakePendingMedia: { findUnique: async () => pending, create: async ({ data }: any) => { trace.push('pending'); pending = data; }, updateMany: async ({ data }: any) => { trace.push('pending-update'); pending = { ...pending, ...data }; return { count: 1 }; } } } },
    textValueCandidates: async () => undefined,
    tryRouteIntake: async ({ event: routed, messageText }: any) => { trace.push('intake'); assert.equal(messageText, 'อ่านไฟล์นี้ว่าอย่างไร'); routed.inputEvidence = { joinedSha256: 'digest' }; flow.budgetGrantsV2.set(routed, grant); return route; },
    createUploadIntent: { resume: async (_ctx: any, id: string) => { trace.push('resume-upload'); return { attachmentId: id, uploadRequired: true }; }, execute: async () => { trace.push('upload-intent'); return { attachmentId: 'attachment' }; } },
    uploadLineMedia: async () => { trace.push('upload'); }, completeAttachmentUpload: { execute: async () => { trace.push('complete-upload'); } },
    documentQa: { admit: async (input: any) => { trace.push('qa-admit'); assert.equal(input.question, 'อ่านไฟล์นี้ว่าอย่างไร'); assert.equal(input.originalInputDigest, 'digest'); assert.equal(input.originalBudgetGrantV2, grant); assert.deepEqual(input.attachments, [{ attachmentId: 'attachment', requestedPages: [1] }]); return { jobId: 'job', foregroundDeadlineAt: new Date(Date.now() + 10000).toISOString() }; },
      getForDelivery: async (_id: string, binding: any) => { assert.equal(binding.ownerEpoch, 3); assert.equal(binding.membershipId, 'member'); return job; } },
    documentQaWorker: { execute: async () => { trace.push('qa-execute'); return job; } },
    deliverMessages: async (_event: any, messages: any[]) => { delivered.push(...messages.map(message => message.text)); return 'ok'; },
    deliverReply: async (_event: any, text: string) => { delivered.push(text); }, updateEventLog: async () => undefined,
    expenseRepo: new Proxy({}, { get() { throw new Error('Question-only must not call expense repository'); } }),
  });
  return { flow, event, owner, ctx, access, trace, delivered, result, setRoute: (value: any) => { route = value; }, setPending: (value: any) => { pending = value; }, media: { fileName: 'image.png', mimeType: 'image/png', byteSize: 3, bytes: Buffer.from('abc'), checksumSha256: 'hash' } };
}

describe('document question pre-capture bridge', () => {
  it('stores an ACTIVE generic attachment, transfers the original turn and delivers QA without expense access', async () => {
    const f = fixture();
    assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', f.media), { handled: true });
    assert.deepEqual(f.trace.slice(0, 6), ['intake', 'upload-intent', 'pending', 'upload', 'complete-upload', 'qa-admit']);
    assert.equal(f.trace.filter(value => value === 'qa-execute').length, 1);
    assert.match(f.delivered[0]!, /ข้อความต้นทาง/); assert.match(f.delivered[0]!, /1\/1/);
  });
  it('replays an existing owned job when new QA writes are disabled, without new intake or upload', async () => {
    const f = fixture(); f.flow.config.lineAiDocumentQaEnabled = false;
    f.setPending({ readJobId: 'job', messagingChannelId: 'oa', chatKeyHash: 'chat', membershipId: 'member', lifecycleEpoch: 3 });
    assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, '', f.media), { handled: true });
    assert.deepEqual(f.trace, ['pending-update']); assert.equal(f.delivered.length, 1);
  });
  it('does not manufacture a question for bare media or discard a mixed requested write', async () => {
    const f = fixture();
    assert.equal(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, '', f.media), null);
    f.setRoute({ semanticSubrequests: [{ kind: 'file' }, { kind: 'write' }] });
    assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', f.media), { handled: true });
    assert.deepEqual(f.trace, ['intake']); assert.match(f.delivered[0]!, /ยังไม่ได้สร้างรายการ/);
  });
  it('reports a terminal failed job instead of promising background reading forever', async () => {
    const f = fixture();
    f.flow.documentQa.getForDelivery = async () => null;
    f.flow.documentQa.getById = async () => ({ ...f.owner, ownerMembershipId: 'member', ownerEpoch: 3, status: 'FAILED', errorCode: 'QA_PAGE_RENDER_UNAVAILABLE' });
    assert.equal(await f.flow.deliverDocumentQaResult(f.event, 'job', { ...f.owner, ownerEpoch: 3 }), true);
    assert.match(f.delivered[0]!, /ยังอ่านไฟล์นี้เพื่อตอบคำถามไม่สำเร็จ/);
    assert.doesNotMatch(f.delivered[0]!, /กำลังอ่าน/);
  });

  it('rejects a real 21-page PDF before storing an attachment or creating a job', async () => {
    const f = fixture(), pdf = await PDFDocument.create(); for (let i = 0; i < 21; i++) pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', { ...f.media, bytes, byteSize: bytes.length, mimeType: 'application/pdf' }), { handled: true });
    assert.deepEqual(f.trace, ['intake']); assert.match(f.delivered[0]!, /20 หน้า/);
  });
});


it('resumes the exact interrupted generic upload without reserving another attachment', async () => {
  const f = fixture();
  f.setPending({ attachmentId: 'attachment', userId: 'user', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'chat', membershipId: 'member', lifecycleEpoch: 3 });
  assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', f.media), { handled: true });
  assert.equal(f.trace.includes('upload-intent'), false);
  assert.deepEqual(f.trace.slice(0, 4), ['intake', 'resume-upload', 'upload', 'complete-upload']);
});

it('stages explicit reimbursement media and resumes the same admitted caption without expense capture or another intake', async () => {
  const f = fixture();
  f.flow.config.lineAiReimbursementDraftWriteEnabled = true;
  f.access.permissions.push('reimbursement.create');
  f.setRoute({ status: 'ROUTED', intent: 'REIMBURSEMENT_REQUEST_START', semanticSubrequests: [{ index: 0, kind: 'write', goal: 'draft claim' }] });
  f.flow.execute = async (event: any) => {
    f.trace.push('same-turn-reimbursement');
    assert.equal(event.webhookEventId, f.event.webhookEventId);
    assert.equal(event.messageText, 'อ่านไฟล์นี้ว่าอย่างไร');
    assert.equal(f.flow.mediaTextContinuations.get(event).route.intent, 'REIMBURSEMENT_REQUEST_START');
    assert.equal(f.flow.budgetGrantsV2.get(event).turnKey, 'turn');
  };
  assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', f.media), { handled: true });
  assert.equal(f.trace.filter(item => item === 'intake').length, 1);
  assert.deepEqual(f.trace, ['intake', 'upload-intent', 'pending', 'upload', 'complete-upload', 'pending-update', 'same-turn-reimbursement']);
});


it('does not resume another owner or epoch’s interrupted QA upload', async () => {
  const f = fixture();
  f.setPending({ attachmentId: 'attachment', userId: 'user', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'other-chat', membershipId: 'member', lifecycleEpoch: 3 });
  assert.deepEqual(await f.flow.routeDocumentQuestionBeforeCapture(f.event, f.ctx, f.access, 'อ่านไฟล์นี้ว่าอย่างไร', f.media), { handled: true });
  assert.deepEqual(f.trace, ['intake']); assert.match(f.delivered[0]!, /บริบทแชตปัจจุบัน/);
});

it('asks a new question about the same owned bytes and keeps original event proof binding', async () => {
  const f = fixture(), event = Object.assign(f.event, { messageText: 'อ่านหน้า 2 ว่าอย่างไร', inputEvidence: { joinedSha256: 'digest' } });
  f.flow.budgetGrantsV2.set(event, { turnKey: 'new-turn' });
  const route = { semanticSubrequests: [{ index: 0, kind: 'file', requestedFilters: { page: 2 } }] };
  f.flow.textValueCandidates = async () => ({ amounts: [{ value: '2', span: '2' }] });
  f.flow.prisma.client.lineIntakePendingMedia.findMany = async ({ where }: any) => {
    assert.equal(where.chatKeyHash, 'chat'); assert.equal(where.lifecycleEpoch, 3);
    return [{ id: 'pending', attachmentId: 'attachment', readJobId: 'old-job', revision: 0 }];
  };
  f.flow.documentQa.getById = async () => ({ ...f.owner, ownerMembershipId: 'member', ownerEpoch: 3, attachmentsJson: [{ attachmentId: 'attachment', requestedPages: [1, 2] }] });
  f.flow.documentQa.admit = async (input: any) => {
    f.trace.push('qa-admit'); assert.deepEqual(input.attachments, [{ attachmentId: 'attachment', requestedPages: [2] }]);
    assert.equal(input.turnId, 'new-turn'); assert.equal(input.question, event.messageText);
    return { jobId: 'job', foregroundDeadlineAt: new Date(Date.now() + 10000).toISOString() };
  };
  const deliver = f.flow.deliverMessages;
  f.flow.deliverMessages = async (actual: any, messages: any[]) => {
    assert.equal(actual, event); assert.equal(f.flow.boundConversations.get(actual).epoch, 3);
    assert.equal(f.flow.documentQaDelivery.get(actual).id, 'job'); return deliver(actual, messages);
  };
  assert.equal(await f.flow.resumeDocumentQuestionV2(event, 'new-request', route, f.access), true);
  assert.deepEqual(f.trace, ['qa-admit', 'pending-update', 'qa-execute', 'pending-update']);
  assert.equal(f.trace.includes('intake'), false); assert.equal(f.trace.includes('upload'), false);
  f.trace.length = 0; route.semanticSubrequests[0]!.requestedFilters.page = 3;
  assert.equal(await f.flow.resumeDocumentQuestionV2(event, 'new-request', route, f.access), true);
  assert.deepEqual(f.trace, []); assert.match(f.delivered.at(-1)!, /เลขหน้าที่ขอ/);
});


it('cancels the exact owned job without provider calls, and keeps ready results immutable while stopping pending delivery', async () => {
  for (const status of ['READING', 'ANSWER_READY']) {
    const f = fixture(), event = Object.assign(f.event, { messageText: '/qa cancel job' });
    f.flow.prisma.client.lineIntakePendingMedia.findMany = async () => [];
    f.flow.documentQa.getById = async () => ({ id: 'job', ...f.owner, ownerMembershipId: 'member', ownerEpoch: 3, status });
    f.flow.documentQa.cancel = async (id: string, owner: any) => { assert.equal(id, 'job'); assert.equal(owner.ownerEpoch, 3); f.trace.push('cancel-job'); return status === 'READING'; };
    assert.equal(await f.flow.handleDocumentQaControl(event), true);
    assert.deepEqual(f.trace, ['cancel-job', 'pending-update']);
    assert.match(f.delivered[0]!, status === 'READING' ? /ยกเลิก/ : /หยุดการส่ง/);
    f.trace.length = 0; f.flow.documentQa.getById = async () => ({ id: 'job', ...f.owner, ownerMembershipId: 'member', ownerEpoch: 2, status });
    assert.equal(await f.flow.handleDocumentQaControl(event), true); assert.deepEqual(f.trace, []);
  }
});

it('keeps non-file clauses pending and closes only explicitly answered file clauses after accepted delivery', async () => {
  const f = fixture();
  const inventory = [{ index: 0, kind: 'file', goal: 'read total' }, { index: 1, kind: 'general', goal: 'why sky blue' }];
  f.flow.restoreDocumentQaTask = async () => inventory;
  (f.result as any).questionCoverage = [{ subrequestIndex: 0, status: 'answered', answer: f.result.answer, answerPageRefs: f.result.answerPageRefs }];
  const settled: any[] = []; f.flow.settleSemanticTask = async (_event: any, coverage: any) => settled.push(coverage);
  const send = f.flow.deliverMessages; f.flow.deliverMessages = async () => 'failed';
  assert.equal(await f.flow.deliverDocumentQaResult(f.event, 'job', { ...f.owner, ownerEpoch: 3 }), false);
  assert.equal(settled.length, 0);
  f.flow.deliverMessages = send;
  assert.equal(await f.flow.deliverDocumentQaResult(f.event, 'job', { ...f.owner, ownerEpoch: 3 }), true);
  assert.deepEqual(settled[0].map((item: any) => item.status), ['handled', 'needs_user']);
  assert.match(f.delivered[0]!, /why sky blue/);
  assert.equal(f.flow.semanticDelivery.get(f.event)[1].status, 'needs_user');
});

// The real media entry point must stop before the former unconditional PDF capture branch.
async function pdfEntryFixture(route: any, v2 = true) {
  const f = fixture(), pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const media = { ...f.media, fileName: 'document.pdf', mimeType: 'application/pdf', bytes, byteSize: bytes.length };
  Object.assign(f.event, { companyIdAtAcceptance: 'company', messageType: 'file', fileName: media.fileName });
  f.access.permissions.push('expense.receipt.upload');
  if (!v2) f.flow.boundConversations.delete(f.event);
  let expenseInitializations = 0;
  Object.assign(f.flow, {
    claimWebhookEvent: async () => true, stampSupportMedia: async () => false, assistantPaused: async () => false,
    resolveLineIdentity: async () => ({ userId: 'user', user: { status: 'ACTIVE' } }),
    permissionResolver: { resolveAccess: async () => f.access }, refusePendingLegalAcceptance: async () => false,
    recordShadowTurn: async () => undefined, refuseWhenLaunchRouteClosed: async () => false, bindConversation: async () => undefined,
    timeStage: async (_id: string, _stage: string, run: () => Promise<unknown>) => run(),
    downloadLineMedia: async () => ({ ok: true, media }), lineMediaRejectionReason: async () => null,
    expenseRepo: { findByLineMessageId: async () => null, findExpenseIdsByAttachmentChecksum: async () => [] },
    initReceiptUpload: { execute: async () => { expenseInitializations++; return { expenseId: 'unexpected-expense' }; } },
    completeReceiptUpload: { execute: async () => { throw new Error('Unexpected expense completion'); } },
    captureLine: {}, captureLineFile: async () => { f.trace.push('expense-capture'); await f.flow.initReceiptUpload.execute(); },
    loadConversationContext: async () => undefined, mayDeliverBusinessReply: async () => true,
    tryRouteIntake: async () => { f.trace.push('intake'); return route; },
    persistIntakeTurn: async () => undefined,
    appendMediaClarification: async (_event: any, input: any) => {
      assert.equal(input.pending.attachmentId, 'attachment'); f.trace.push('waiting-for-purpose');
    },
    logger: { warn: (entry: unknown) => { throw new Error(`Unexpected pending-media failure: ${JSON.stringify(entry)}`); } },
  });
  f.flow.prisma.client.companyFeatureEntitlement = { findMany: async () => [] };
  f.flow.prisma.client.lineIntakePendingMedia.findFirst = async () => null;
  return { ...f, media, expenseInitializations: () => expenseInitializations };
}

for (const classification of [
  { status: 'ROUTED', intent: 'CLARIFY', semanticSubrequests: [{ kind: 'read' }] },
  { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', semanticSubrequests: [{ kind: 'read' }] },
  { status: 'UNAVAILABLE', intent: 'CLARIFY' },
  { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticSubrequests: [{ kind: 'read' }] },
  { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticSubrequests: [{ kind: 'write', writeIntent: 'REIMBURSEMENT_REQUEST_START' }] },
]) it(`keeps a v2 PDF pending without expense initialization for ${classification.status}/${classification.intent}/${classification.semanticSubrequests?.[0]?.kind ?? 'unknown'}`, async () => {
  const f = await pdfEntryFixture(classification);
  if (classification.status === 'UNAVAILABLE') f.flow.config.lineAiDocumentQaEnabled = false;
  await f.flow.executeReceiptUploadInner(f.event, 'อ่านไฟล์นี้ว่าอย่างไร', {});
  assert.equal(f.expenseInitializations(), 0);
  assert.deepEqual(f.trace, ['intake', 'upload-intent', 'pending', 'upload', 'complete-upload', 'waiting-for-purpose']);
  assert.match(f.delivered[0]!, /ยังไม่ได้สร้างรายการ/);
  const pending = await f.flow.prisma.client.lineIntakePendingMedia.findUnique();
  assert.equal(pending.status, 'PENDING'); assert.equal(pending.askedQuestionJson.pageCount, 2);
  assert.equal(pending.chatKeyHash, 'chat'); assert.equal(pending.lifecycleEpoch, 3);
});

it('asks purpose for a blank v2 PDF without a model call, but retains legacy blank upload behavior', async () => {
  for (const v2 of [true, false]) {
    const f = await pdfEntryFixture({ status: 'UNAVAILABLE', intent: 'CLARIFY' }, v2);
    await f.flow.executeReceiptUploadInner(f.event, '', {});
    assert.equal(f.trace.includes('intake'), false);
    assert.equal(f.expenseInitializations(), v2 ? 0 : 1);
    assert.equal(f.trace.includes('waiting-for-purpose'), v2);
    assert.equal(f.trace.includes('expense-capture'), !v2);
  }
});

it('allows a typed explicit expense write through the v2 PDF capture path after exactly one intake', async () => {
  const f = await pdfEntryFixture({ status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE',
    semanticSubrequests: [{ kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE' }] });
  await f.flow.executeReceiptUploadInner(f.event, 'บันทึกเอกสารนี้เป็นค่าใช้จ่าย', {});
  assert.equal(f.expenseInitializations(), 1);
  assert.deepEqual(f.trace, ['intake', 'expense-capture']);
});

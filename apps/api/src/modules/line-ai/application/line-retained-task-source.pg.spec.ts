import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, createLineAiInputEvidence, type AiBudgetGrantV2, type LineAiTurnRequest } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { LineConversationContextService, invalidateLineConversationState } from './line-conversation-context.service';
import { LineAiLedgerService } from './line-ai-ledger.service';
import { buildLineDeliveryPlan, deliveryHash, initialDeliveryBatchStates } from '../domain/logic/line-delivery-plan.logic';
import { ProcessLineWebhookUseCase } from './use-cases/process-line-webhook.use-case';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const url = process.env.BILLING_TEST_DATABASE_URL;

test('selected mixed action restores only its original clause across restart with current input/grant and rejects stale owner/source', { skip: !url }, async () => {
  const address = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(address.hostname));
  assert.ok(address.port === '15439' && address.pathname === '/watchdog_bms_ai_reliability_20260927' || address.port === '5432' && address.pathname === '/watchdog_postmark_ci');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) }), prisma = { client } as PrismaService;
  const company = await client.company.create({ data: { name: `retained-${randomUUID()}` } });
  const user = await client.user.create({ data: { displayName: 'Synthetic retained input' } });
  const now = Date.now(), lineUserId = `line-${randomUUID()}`, channelId = 'oa-A';
  const owner = { companyId: company.id, userId: user.id, membershipId: 'member', channel: 'line' as const, channelKind: 'USER' as const,
    messagingChannelId: channelId, chatKeyHash: sha(lineUserId).slice(0, 16) };
  const context = new LineConversationContextService(prisma), conversation = await context.admit(owner);
  const first = 'บันทึกค่าแท็กซี่ 120 บาท วันที่ 2026-09-26', second = 'บันทึกค่ากระดาษ 950 บาท วันที่ 2026-09-27';
  const original = (await createLineAiInputEvidence({ turnKey: 'original-turn', parts: [{ partId: 'part', eventIdHash: sha('original'), acceptedAtMs: now - 60000, rawText: `${first}\n${second}` }] }))!;
  const grant: AiBudgetGrantV2 = { version: 2, turnKey: original.inputEvidence.turnKey, authorityKind: 'webhook_event', authorityId: 'old-event-db', channelOwnerDigest: sha('owner'), attemptKey: 'old-attempt', monthKey: '2026-09', payerCompanyId: company.id,
    model: { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'global' }, allowedProfileIds: ['line-answer/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
    maxTurnSlots: 2, maxRepairs: 1, admittedAtMs: now - 60000, workDeadlineAtMs: now - 43000, finalDeadlineAtMs: now - 40000, nonce: 'nonce', issuerVersion: 'api-1', signature: sha('signature'), nextOrdinal: 1 };
  const inventory: NonNullable<LineAiTurnRequest['semanticSubrequests']> = [first, second].map((text, index) => ({ index, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: text,
    requiredEvidence: [], requestedFilters: {}, dependsOn: index ? [0] : [], evidenceRefs: [{ partId: 'part', rawSha256: original.inputEvidence.parts[0]!.rawSha256,
      startUtf16: index ? first.length + 1 : 0, endUtf16: index ? original.messageText.length : first.length }] }));
  const event = { webhookEventId: 'original', lineUserId, messagingChannelId: channelId, replyToken: 'reply', ...original };
  const request: LineAiTurnRequest = { ...original, requestId: 'req-original', webhookEventId: event.webhookEventId, messagePreviewHash: sha(original.messageText).slice(0, 16), budgetGrantV2: grant, semanticSubrequests: inventory,
    userContext: { companyId: company.id, internalUserId: user.id, membershipId: owner.membershipId, lineUserId, roles: ['OWNER'], permissions: ['line.ai.query'], locale: 'th-TH' } };
  const sent: any[] = [], binding = { owner, id: conversation.id, epoch: 0 }, flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, { prisma, contextV2: context, boundConversations: new WeakMap([[event, binding]]), semanticDelivery: new WeakMap(), intermediateDeliveries: new WeakSet(), semanticTaskMappings: new WeakMap(), retainedTaskSources: new WeakMap(), deliveryAccess: new WeakMap([[event, { fingerprint: 'fp' }]]), deliverReply: async (_event: any, text: string) => sent.push(text) });
  try {
    assert.equal(await flow.preserveSemanticTask(event, inventory), true);
    const ledger = new LineAiLedgerService({ lineAiLedgerEnabled: false } as never, { log: async () => {} } as never, prisma);
    await ledger.appendTurn({ companyId: company.id, userId: user.id, messagingChannelId: channelId, chatKey: lineUserId, turnId: request.requestId,
      webhookEventId: event.webhookEventId, text: event.messageText, acceptedRequest: { request, ownerEpoch: 0, conversationId: conversation.id, accessFingerprint: 'fp' } });
    await flow.bindMixedTaskSource(event, request.requestId);
    const coverage = inventory.map(item => ({ index: item.index, status: 'needs_user', question: 'choose' }));
    flow.semanticDelivery.set(event, coverage);
    await flow.persistSemanticTaskCompletion(event);
    const parent = await client.lineLedgerDelivery.findFirstOrThrow({ where: { companyId: company.id } });
    const expiresAt = new Date(now + 600000).toISOString(), at = new Date(now).toISOString();
    const plan = buildLineDeliveryPlan({ producerKind: 'LEDGER', producerId: parent.id, createdAt: at, readyAt: at, expiresAt,
      firstDispatchDeadlineAt: new Date(now + 40000).toISOString(), authorization: { v: 2, kind: 'PRIVATE', issuedAt: at, expiresAt,
        actor: { userId: user.id, companyId: company.id, membershipId: owner.membershipId, requestId: request.requestId, accessFingerprint: 'fp',
          channelId, channel: 'line', channelKind: 'USER', recipientHash: sha(lineUserId), chatKeyHash: owner.chatKeyHash, conversationId: conversation.id, ownerEpoch: 0 }, proofs: [] },
      control: null, businessResult: null, answer: { status: 'PARTIAL', pendingSubrequestIds: ['0', '1'], items: [{ kind: 'limitation', text: 'choose one pending action', required: true, sourceProofIds: [] }] } });
    const states = initialDeliveryBatchStates(plan);
    await client.lineDeliveryPlan.create({ data: { id: plan.planId, ledgerDeliveryId: parent.id, companyId: company.id, userId: user.id,
      planJson: plan as any, planHash: deliveryHash(plan), batchStateJson: states as any, status: 'UNKNOWN', expiresAt: new Date(expiresAt), purgeAt: new Date(expiresAt) } });
    // Process dies before task settlement. UNKNOWN cannot become completed task state.
    flow.semanticTaskMappings = new WeakMap();
    await flow.reconcileDeliveredSemanticTasks(event);
    assert.equal((await context.projection(owner))!.tasks[0]!.state, 'active');
    await client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    await flow.reconcileDeliveredSemanticTasks(event);
    assert.equal((await context.projection(owner))!.tasks[0]!.state, 'active', 'status without accepted batch receipts is insufficient');
    for (const state of states) { state.status = 'ACCEPTED'; state.acceptedAt = new Date().toISOString(); }
    await client.lineDeliveryPlan.update({ where: { id: plan.planId }, data: { batchStateJson: states as any } });
    await flow.reconcileDeliveredSemanticTasks(event);
    const completedVersion = (await context.projection(owner))!.stateVersion;
    await flow.reconcileDeliveredSemanticTasks(event);
    assert.equal((await context.projection(owner))!.stateVersion, completedVersion, 'accepted recovery is idempotent');
    const task = (await context.projection(owner))!.tasks[0]!;
    assert.equal(task.sourceRevisionLocators!.length, 2); assert.equal(task.state, 'waiting_user');
    assert.ok(!JSON.stringify(task).includes('rawText'));
    const blocked = { ...event, webhookEventId: 'blocked-dependent', messageText: `/task choose ${task.taskId} ${task.revision} 1` };
    flow.boundConversations.set(blocked, binding); flow.deliveryAccess.set(blocked, { fingerprint: 'fp' });
    assert.equal(await flow.prepareRetainedTaskSelection(blocked), true); assert.equal(flow.retainedTaskSources.has(blocked), false);
    sent.length = 0;
    const selection = `/task choose ${task.taskId} ${task.revision} 0`;
    const current = (await createLineAiInputEvidence({ turnKey: 'new-turn', parts: [{ partId: 'current', eventIdHash: sha('selection'), acceptedAtMs: now, rawText: selection }] }))!;
    const next = { webhookEventId: 'selection', lineUserId, messagingChannelId: channelId, replyToken: 'new-reply', ...current };
    // No maps from the original worker survive. The current event/grant are not relabelled old text.
    flow.retainedTaskSources = new WeakMap(); flow.semanticTaskMappings = new WeakMap(); flow.boundConversations = new WeakMap([[next, binding]]); flow.deliveryAccess = new WeakMap([[next, { fingerprint: 'fp' }]]);
    assert.equal(await flow.prepareRetainedTaskSelection(next), false);
    const retained = flow.retainedTaskSources.get(next);
    assert.equal(retained.sourceText, first); assert.ok(!retained.sourceText.includes('950'));
    assert.equal(next.messageText, selection); assert.equal(next.inputEvidence.joinedSha256, current.inputEvidence.joinedSha256);
    assert.equal(retained.source.inputEvidence.joinedSha256, original.inputEvidence.joinedSha256);
    assert.equal(retained.source.inputEvidence.parts[0].acceptedAtMs, now - 60000);
    assert.ok(retained.operationId); assert.equal(sent.length, 0);
    const selected = [{ ...inventory[0]!, index: 0, taskRef: retained.source.taskRef }];
    assert.equal(await flow.preserveSemanticTask(next, selected), true);
    assert.equal((await context.projection(owner))!.tasks[0]!.subrequests[1]!.status, 'needs_user');
    const remaining = await flow.remainingTaskChoiceMessages(next);
    assert.equal(remaining.length, 1); assert.match(remaining[0].text, /950/);
    await flow.settleSemanticTask(next, [{ index: 0, status: 'needs_user', question: 'confirm preview' }], ['selected-reimbursement-action']);
    const previewTask = (await context.projection(owner))!.tasks[0]!;
    assert.equal(previewTask.sourceRevisionLocators!.length, 2, 'preview keeps both immutable original source locators');
    assert.equal(previewTask.slots!.reimbursementActionId0, 'selected-reimbursement-action');
    await flow.finishReimbursementTask(owner, 0, 'selected-reimbursement-action', true);
    const appliedTask = (await context.projection(owner))!.tasks[0]!;
    assert.equal(appliedTask.subrequests[0]!.status, 'handled');
    assert.equal(appliedTask.subrequests[1]!.status, 'needs_user', 'confirming one action never completes its sibling');
    assert.equal(appliedTask.state, 'waiting_user');
    const secondSelection = { ...next, webhookEventId: 'selection-2', messageText: `/task choose ${appliedTask.taskId} ${appliedTask.revision} 1` };
    flow.boundConversations.set(secondSelection, binding); flow.deliveryAccess.set(secondSelection, { fingerprint: 'fp' });
    assert.equal(await flow.prepareRetainedTaskSelection(secondSelection), false);
    assert.equal(flow.retainedTaskSources.get(secondSelection).sourceText, second);
    assert.notEqual(flow.retainedTaskSources.get(secondSelection).operationId, retained.operationId);
    // Tamper in the immutable row cannot be hidden by retaining its old digest/locator.
    const sourceRow = await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: task.sourceRevisionLocators![0]!.sourceId } });
    const tampered = structuredClone(sourceRow.acceptedRequestJson) as any; tampered.request.messageText += ' 999';
    await client.lineLedgerDelivery.update({ where: { id: sourceRow.id }, data: { acceptedRequestJson: tampered } });
    assert.equal(await flow.prepareRetainedTaskSelection(secondSelection), true);
    assert.equal(flow.retainedTaskSources.has(secondSelection), false);
    await client.lineLedgerDelivery.update({ where: { id: sourceRow.id }, data: { acceptedRequestJson: sourceRow.acceptedRequestJson as any } });
    sent.length = 0;
    assert.equal(await flow.prepareRetainedTaskSelection(next), true); // selected revision is consumed before domain dispatch
    assert.equal(sent.length, 1);
    await client.$transaction(tx => invalidateLineConversationState(tx, { companyId: company.id, userId: user.id }, false));
    assert.equal(await flow.prepareRetainedTaskSelection(next), true);
    assert.equal(sent.length, 2);
    const other = { ...next, messagingChannelId: 'oa-B' }; const otherOwner = { ...owner, messagingChannelId: 'oa-B' }; const otherConversation = await context.admit(otherOwner);
    flow.boundConversations.set(other, { owner: otherOwner, id: otherConversation.id, epoch: 0 }); flow.deliveryAccess.set(other, { fingerprint: 'fp' });
    assert.equal(await flow.prepareRetainedTaskSelection(other), true); assert.equal(flow.retainedTaskSources.has(other), false);
  } finally { await client.company.delete({ where: { id: company.id } }); await client.user.delete({ where: { id: user.id } }); await client.$disconnect(); }
});

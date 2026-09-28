import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../../generated/prisma/client';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';
import { LineAiBudgetDeadlineExceededError } from '../line-ai-budget-authority.service';
import { parseLineDeliveryPlan, type DeliveryPlanV2 } from '../../domain/logic/line-delivery-plan.logic';
import { buildLineBusinessAnswerMessage, inheritCompleteLineBusinessAnswerPresentation } from '../../domain/logic/line-business-card.logic';

it('answers an admitted private general/help turn without private ERP prefetch or touching four waiting tasks', async () => {
  const event: any = { webhookEventId: 'evt', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'ทำไมท้องฟ้าเป็นสีฟ้า', inputEvidence: { joinedSha256: 'digest' } };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', chatKeyHash: 'chat' };
  const grant = { turnKey: 'turn' }, calls: string[] = [];
  const conversationContext = { windowMinutes: 15, maxTurns: 15,
    recentTurns: [{ at: new Date().toISOString(), userMessagePreview: 'กำไรคืออะไร', assistantReplyPreview: 'กำไรคือรายได้หักค่าใช้จ่าย' }] };
  const route = { status: 'ROUTED', intent: 'ADVISOR_CONVERSATION', semanticSubrequests: [{ index: 0, kind: 'general', goal: 'sky', requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] };
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]), budgetGrantsV2: new WeakMap([[event, grant]]),
    deliveryAccess: new WeakMap([[event, { fingerprint: 'fp' }]]), semanticDelivery: new WeakMap(), deliverySources: new WeakMap(),
    config: { webBaseUrl: '', lineAiApprovedKnowledgeEnabled: false },
    reliabilityContext: async () => ({ taskProjection: { tasks: Array.from({ length: 4 }, () => ({ state: 'waiting_user' })) } }),
    preserveSemanticTask: async () => { throw new Error('General side question must not replace or consume a waiting task slot'); },
    expenseRepo: new Proxy({}, { get() { throw new Error('No private ERP prefetch'); } }),
    loadConversationContext: async () => { throw new Error('No legacy business context'); },
    aiGateway: { narrowLineReliabilityGrant: async (original: any, lane: string, profiles: string[]) => {
      assert.equal(original, grant); assert.equal(lane, 'general'); assert.deepEqual(profiles, ['line-answer/2']); return grant;
    }, requestLineTurn: async (request: any) => {
      calls.push('answer'); assert.equal(request.messageText, event.messageText); assert.equal(request.inputEvidence, event.inputEvidence);
      assert.equal(request.conversationContext, conversationContext);
      return { replyText: 'อากาศกระเจิงแสงสีน้ำเงิน', webLinks: [], sourceLabels: [], toolsInvoked: [], sourceRefs: [], refused: false, semanticCoverage: [{ index: 0, status: 'handled' }] };
    } },
    ledger: { appendTurn: async ({ acceptedRequest }: any) => { calls.push('durable'); assert.equal(acceptedRequest.request.budgetGrantV2, grant); return 'ledger'; }, ack: async () => calls.push('ack') },
    persistTurn: async () => { calls.push('persist'); }, updateEventLog: async () => undefined,
    deliverMessages: async (_event: any, messages: any[]) => { calls.push('accepted'); assert.match(messages[0].text, /อากาศ/); return 'ok'; },
  });
  await flow.deliverPureGeneralV2(event, 'request', route, { permissions: ['line.ai.query'], roles: [], scopes: {} }, [], undefined, conversationContext);
  assert.deepEqual(calls, ['durable', 'answer', 'persist', 'accepted', 'ack']);
});

for (const scenario of [
  { name: 'general grant admission is unavailable', kind: 'grant', status: 'provider_unavailable', error: 'AI_GENERAL_ADMISSION_UNAVAILABLE', calls: ['narrow', 'reply', 'terminal'] },
  { name: 'the authoritative grant deadline elapsed', kind: 'deadline', status: 'ai_timeout', error: 'DEADLINE_EXCEEDED', calls: ['narrow', 'reply', 'terminal'] },
  { name: 'a resumed task selection is stale', kind: 'task', status: 'clarification_required', error: 'STALE_TASK_SELECTION', calls: ['narrow', 'preserve', 'reply', 'terminal'] },
  { name: 'semantic coverage is absent', kind: 'missing', status: 'provider_unavailable', error: 'AI_CONTRACT_UNSUPPORTED', calls: ['narrow', 'context', 'durable', 'answer', 'reply', 'terminal'] },
  { name: 'semantic coverage omits a clause', kind: 'count', status: 'provider_unavailable', error: 'AI_CONTRACT_UNSUPPORTED', calls: ['narrow', 'context', 'durable', 'answer', 'reply', 'terminal'] },
  { name: 'a general response claims tool invocation', kind: 'tool', status: 'provider_unavailable', error: 'AI_CONTRACT_UNSUPPORTED', calls: ['narrow', 'context', 'durable', 'answer', 'reply', 'terminal'] },
]) it(`finishes the durable webhook when ${scenario.name}, without extra calls or task mutation`, async () => {
  const event: any = { webhookEventId: 'evt-failure', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'อันเมื่อกี้คืออะไร', inputEvidence: { joinedSha256: 'digest' } };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', chatKeyHash: 'chat' };
  const grant = { turnKey: 'turn' }, calls: string[] = [], replies: string[] = [];
  const tasks = [{ taskId: 'waiting-task', state: 'waiting_user', revision: 4 }], originalTasks = structuredClone(tasks);
  const route = { status: 'ROUTED', intent: 'ADVISOR_CONVERSATION', semanticSubrequests: [
    { index: 0, kind: 'general', goal: 'explain', requiredEvidence: [], requestedFilters: {}, dependsOn: [], ...(scenario.kind === 'task' ? { taskRef: 'waiting-task' } : {}) },
  ] };
  const stored: any = { status: 'received', processedAt: null, payloadJson: { messageText: event.messageText } };
  const forbidden = () => { throw new Error('Failed general turn must not mutate business/task state, acknowledge success or prefetch ERP'); };
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]), budgetGrantsV2: new WeakMap([[event, grant]]),
    deliveryAccess: new WeakMap([[event, { fingerprint: 'fp' }]]), semanticDelivery: new WeakMap(), deliverySources: new WeakMap(),
    config: { webBaseUrl: '', lineAiApprovedKnowledgeEnabled: false }, logger: { log() {}, warn() {} },
    reliabilityContext: async () => { calls.push('context'); return { taskProjection: { tasks } }; },
    preserveSemanticTask: async () => { calls.push('preserve'); return false; },
    settleSemanticTask: forbidden, persistTurn: forbidden, deliverMessages: forbidden, loadConversationContext: forbidden,
    expenseRepo: new Proxy({}, { get: forbidden }), contextV2: new Proxy({}, { get: forbidden }),
    aiGateway: {
      narrowLineReliabilityGrant: async () => {
        calls.push('narrow');
        if (scenario.kind === 'deadline') throw new LineAiBudgetDeadlineExceededError();
        return scenario.kind === 'grant' ? null : grant;
      },
      requestLineTurn: async () => { calls.push('answer'); return { replyText: 'UNVERIFIED ANSWER MUST NOT BE SENT', toolsInvoked: scenario.kind === 'tool' ? ['expense.get_detail'] : [],
        semanticCoverage: scenario.kind === 'missing' ? undefined : scenario.kind === 'count' ? [] : [{ index: 0, status: 'handled' }] }; },
    },
    ledger: { appendTurn: async () => { calls.push('durable'); return 'ledger'; }, ack: forbidden },
    deliverReply: async (_event: any, text: string) => { calls.push('reply'); replies.push(text); return 'ok'; },
    prisma: { client: { lineWebhookEventLog: { updateMany: async ({ where, data }: any) => {
      calls.push('terminal');
      assert.equal(where.webhookEventId, event.webhookEventId);
      assert.deepEqual(where.OR, [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }]);
      assert.deepEqual(where.status, { not: 'delivery_pending' });
      Object.assign(stored, data); return { count: 1 };
    } } } },
  });
  await flow.deliverPureGeneralV2(event, 'request', route, { permissions: ['line.ai.query'], roles: [], scopes: {} }, [], undefined);
  assert.deepEqual(calls, scenario.calls);
  assert.equal(stored.status, scenario.status); assert.equal(stored.errorCode, scenario.error); assert.equal(stored.companyId, owner.companyId);
  assert.ok(stored.processedAt instanceof Date); assert.equal(stored.payloadJson, Prisma.DbNull, 'terminal turn must release its buffered replay payload');
  assert.equal(replies.length, 1); assert.ok(replies[0]!.trim()); assert.ok(!replies[0]!.includes('UNVERIFIED ANSWER'));
  if (scenario.kind === 'grant') assert.doesNotMatch(replies[0]!, /budget|งบประมาณ/i, 'failed admission alone does not establish exhausted budget');
  if (scenario.kind === 'deadline') assert.match(replies[0]!, /ใช้เวลานาน|ลองใหม่/i);
  assert.deepEqual(tasks, originalTasks); assert.equal(flow.semanticDelivery.has(event), false); assert.equal(flow.deliverySources.has(event), false);
});

for (const scenario of [
  { name: 'handled', coverage: [{ index: 0, status: 'handled' }], pending: [], pages: false },
  { name: 'denied and unsupported are terminal dispositions', coverage: [{ index: 0, status: 'denied' }, { index: 1, status: 'unsupported' }], pending: [], pages: false },
  { name: 'actual clarification', coverage: [{ index: 0, status: 'needs_user', question: 'ต้องตรวจข้อมูลหรือสิทธิ์ของส่วนนี้ก่อน ยังไม่ได้ทำรายการให้' }], pending: ['0'], pages: false },
  { name: 'mixed handled and pending clauses', coverage: [{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user', question: 'ต้องการใช้สาขาใด' }], pending: ['1'], pages: false },
  { name: 'one already-rendered clarification', coverage: [{ index: 0, status: 'needs_user', question: 'ต้องการใช้สาขาใด' }], pending: ['0'], pages: false, outgoing: ['ต้องการใช้สาขาใด'] },
  { name: 'an answered clause plus an already-rendered pending question', coverage: [{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user', question: 'ต้องการใช้สาขาใด' }], pending: ['1'], pages: false, outgoing: ['ยอดที่ตรวจสอบแล้ว 120 บาท', 'ต้องการใช้สาขาใด'] },
  { name: 'a pending question embedded in the canonical answer', coverage: [{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user', question: 'ต้องการใช้สาขาใด' }], pending: ['1'], pages: false, outgoing: ['ยอดที่ตรวจสอบแล้ว 120 บาท\nต้องการใช้สาขาใด'] },
  { name: 'an already-rendered failed page', coverage: [], pending: ['file:attachment:page:2'], pages: true, outgoing: ['อ่านหน้าแรกได้\nยังอ่านเอกสารแนบลำดับที่ 1 หน้า 2 ไม่สำเร็จ'] },
  { name: 'historical QA failed page without indexed coverage', coverage: [], pending: ['file:attachment:page:2'], pages: true },
  { name: 'QA failed page and pending clause', coverage: [{ index: 0, status: 'needs_user', question: 'ยังตอบคำถามจากหน้าที่เลือกไม่ได้' }], pending: ['0', 'file:attachment:page:2'], pages: true },
]) it(`frozen webhook delivery preserves ${scenario.name} through the real plan validator`, async () => {
  const event: any = { webhookEventId: 'partial-event', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply' };
  const createdAt = new Date(), calls: string[] = [], wire: string[] = [];
  const originalCoverage = structuredClone(scenario.coverage);
  let saved: DeliveryPlanV2 | undefined;
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  const qa = { version: 1, readerVersion: 'line-document-qa/1', answer: 'อ่านหน้าแรกได้', answerPageRefs: [{ attachmentId: 'attachment', page: 1 }],
    pages: [{ attachmentId: 'attachment', page: 1, visibleText: 'ข้อความต้นทาง', facts: [], evidence: [] }],
    coverage: { requested: [{ attachmentId: 'attachment', page: 1 }, { attachmentId: 'attachment', page: 2 }],
      read: [{ attachmentId: 'attachment', page: 1 }], failed: [{ attachmentId: 'attachment', page: 2, code: 'UNREADABLE' }] } };
  Object.assign(flow, {
    config: { aiDataRetentionDays: 30 }, semanticDelivery: new WeakMap([[event, scenario.coverage]]),
    documentQaDelivery: new WeakMap(scenario.pages ? [[event, { resultJson: qa, jobDeadlineAt: new Date(createdAt.getTime() + 40_000) }]] : []),
    deliveryReimbursements: new WeakMap(), deliveryDraftPreviews: new WeakMap(),
    // buildTurnAuthorizationJson (called from sendMessagesV2) reads these WeakMaps on `this` directly,
    // same as the real class fields — empty here, same as the other unused delivery-* maps above.
    deliveryAccess: new WeakMap(), deliverySources: new WeakMap(), publicPolicyTopics: new WeakMap(),
    deliveryReceiptSources: new WeakMap(), deliverySubstituteSources: new WeakMap(), deliveryCandidates: new WeakMap(),
    persistSemanticTaskCompletion: async () => { calls.push('persist-pending-state'); },
    webhookPlanAuthorization: async (_event: any, expiresAt: string) => ({ v: 2, kind: 'PRIVATE', issuedAt: createdAt.toISOString(), expiresAt,
      actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint',
        channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 0 }, proofs: 'outgoing' in scenario ? [{ id: 'read', kind: 'READ', evidenceIds: ['evidence'] }] : [] }),
    prisma: { client: { lineTurnOutcome: { findUnique: async () => null }, lineWebhookEventLog: { findUnique: async () => ({ createdAt }) } } },
    deliveryPlans: { savePlan: async (_owner: unknown, plan: DeliveryPlanV2) => {
      assert.ok(parseLineDeliveryPlan(plan), 'actual plan must meet unchanged coverage and frozen-wire validation');
      calls.push('save-plan'); saved = plan; return { id: plan.planId };
    } },
    replayDeliveryPlan: async (id: string) => {
      assert.equal(id, saved!.planId); calls.push('replay');
      wire.push(...saved!.batches.flatMap(batch => batch.primary.messages.map(message => message.type === 'text' ? message.text : '')));
      return 'ok';
    },
  });
  const outgoing = 'outgoing' in scenario ? scenario.outgoing! : ['คำตอบหรือคำอธิบายขอบเขตที่ตรวจสอบแล้ว'];
  const answer = outgoing[0]!;
  assert.equal(await flow.sendMessagesV2(event, outgoing.map(text => ({ type: 'text', text }))), 'ok');
  assert.deepEqual(calls, ['persist-pending-state', 'save-plan', 'replay']);
  assert.deepEqual(saved!.answer.pendingSubrequestIds, scenario.pending);
  assert.equal(saved!.answer.status, scenario.pending.length ? 'PARTIAL' : 'COMPLETE');
  assert.equal(saved!.answer.items.filter(item => item.kind === 'limitation').length, scenario.pending.length ? 1 : 0);
  assert.equal(saved!.answer.items[0]!.text, answer); assert.equal(wire[0], answer);
  for (const item of scenario.coverage) if (item.status === 'needs_user') assert.ok(wire.join('\n').includes(item.question!));
  if (scenario.pages) { assert.match(wire.join('\n'), /ยังอ่านเอกสารแนบลำดับที่ 1 หน้า 2 ไม่สำเร็จ/); assert.doesNotMatch(wire.join('\n'), /attachment/); }
  if ('outgoing' in scenario) {
    assert.deepEqual(wire, outgoing, 'already-rendered limitations must not append a second question or discard the answer');
    assert.ok(saved!.answer.items.every(item => item.required));
    for (const item of saved!.answer.items) assert.deepEqual(item.sourceProofIds, ['read'], 'marking a limitation must retain its original source proof');
  }
  assert.deepEqual(scenario.coverage, originalCoverage, 'transport must not promote pending or denied work to handled');
});

it('freezes the trusted expense card and safe link through the actual webhook v2 seam', async () => {
  const event: any = { webhookEventId: 'expense-card-event', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply' };
  const createdAt = new Date(); let saved: DeliveryPlanV2 | undefined;
  const response: any = { requestId: 'expense-card-request', replyText: 'ค่าใช้จ่ายเดือนนี้ 500 บาท', sourceRefs: [], sourceLabels: ['ค่าใช้จ่าย'],
    webLinks: [{ label: 'เปิดค่าใช้จ่าย', path: '/companies/company/expenses' }], intent: 'read_summary', agent: 'accounting', refused: false,
    toolsInvoked: ['expense.list_recent'], durationMs: 1, presentation: { kind: 'answer_cards', cards: [{ title: 'ค่าใช้จ่ายเดือนนี้',
      text: 'ค่าใช้จ่ายเดือนนี้ 500 บาท', sourceLabels: ['ค่าใช้จ่าย'], webLink: { label: 'เปิดค่าใช้จ่าย', path: '/companies/company/expenses' } }] } };
  const rendered = buildLineBusinessAnswerMessage(response, response.replyText, 'https://app.example.com', 'company');
  assert.equal(rendered.type, 'flex');
  const message = inheritCompleteLineBusinessAnswerPresentation(rendered, { ...rendered,
    quickReply: { items: [{ type: 'action' as const, action: { type: 'message' as const, label: 'ถามข้อมูล', text: 'ถามข้อมูล' } }] } });
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    config: { aiDataRetentionDays: 30 }, semanticDelivery: new WeakMap(), documentQaDelivery: new WeakMap(), deliveryReimbursements: new WeakMap(), deliveryDraftPreviews: new WeakMap(),
    // buildTurnAuthorizationJson (called from sendMessagesV2) reads these WeakMaps on `this` directly.
    deliveryAccess: new WeakMap(), deliverySources: new WeakMap(), publicPolicyTopics: new WeakMap(),
    deliveryReceiptSources: new WeakMap(), deliverySubstituteSources: new WeakMap(), deliveryCandidates: new WeakMap(),
    persistSemanticTaskCompletion: async () => undefined,
    webhookPlanAuthorization: async (_event: any, expiresAt: string) => ({ v: 2, kind: 'PRIVATE', issuedAt: createdAt.toISOString(), expiresAt,
      actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint', channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 0 },
      proofs: [{ id: 'read', kind: 'READ', evidenceIds: ['expense-evidence'] }] }),
    prisma: { client: { lineTurnOutcome: { findUnique: async () => null }, lineWebhookEventLog: { findUnique: async () => ({ createdAt }) } } },
    deliveryPlans: { savePlan: async (_owner: unknown, plan: DeliveryPlanV2) => { saved = plan; return { id: plan.planId }; } },
    replayDeliveryPlan: async () => 'ok',
  });
  assert.equal(await flow.sendMessagesV2(event, [message]), 'ok');
  assert.ok(saved && parseLineDeliveryPlan(saved));
  const primary = saved!.batches[0]!.primary.messages[0]!, fallback = saved!.batches[0]!.fallback!.messages[0]!;
  assert.equal(primary.type, 'flex'); assert.equal((primary as any).canonicalText, undefined);
  assert.match(JSON.stringify(primary), /https:\/\/app\.example\.com\/companies\/company\/expenses/);
  // R-B1 exit 4: frozen once, in the card uri and in the fallback's link line alike.
  assert.equal(JSON.stringify(primary).split('openExternalBrowser=1').length, 2);
  assert.equal(fallback.type, 'text');
  if (fallback.type === 'text') {
    assert.match(fallback.text, /ค่าใช้จ่ายเดือนนี้ 500 บาท/);
    assert.match(fallback.text, /แหล่งข้อมูล: ค่าใช้จ่าย/);
    assert.match(fallback.text, /https:\/\/app\.example\.com\/companies\/company\/expenses/);
    assert.equal(fallback.text.split('openExternalBrowser=1').length, 2);
  }
});

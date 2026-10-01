import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../../generated/prisma/client';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';
import { LineAiBudgetDeadlineExceededError } from '../line-ai-budget-authority.service';
import { deliveryHash, parseLineDeliveryPlan, type DeliveryPlanV2 } from '../../domain/logic/line-delivery-plan.logic';
import { withLineExternalBrowserText } from '@watchdog-bms/contracts';
import { buildAiBudgetExceededMessage, buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage, buildReceiptQuotaExceededMessage,
  buildReimbursementHandoffMessage, buildReimbursementPayerClarificationMessage, inheritCompleteLineBusinessAnswerPresentation } from '../../domain/logic/line-business-card.logic';
import { buildPendingApprovalCard, buildReceiptCapturePrompt, buildServiceEntitlementMessage, buildStaffMainMenu } from '../../domain/logic/line-staff-menu.logic';
import { receiptQuotaExceededTextTh } from '../../../system-partner-management/domain/logic/receipt-quota.logic';
import { ASK_PLAN_MANAGER_TH } from '../../../access-control/domain/logic/plan-manager.logic';

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
    persistTurn: async () => { calls.push('persist'); return 'turn'; }, updateEventLog: async () => undefined,
    prisma: { client: { aiTurn: { update: async ({ where, data }: any) => { calls.push(`${where.id}:${data.status}`); return {}; } } } },
    deliverMessages: async (_event: any, messages: any[]) => { calls.push('accepted'); assert.match(messages[0].text, /อากาศ/); return 'ok'; },
  });
  await flow.deliverPureGeneralV2(event, 'request', route, { permissions: ['line.ai.query'], roles: [], scopes: {} }, [], undefined, conversationContext);
  assert.deepEqual(calls, ['durable', 'answer', 'persist', 'accepted', 'turn:COMPLETED', 'ack']);
});

// UAT 2026-09-29: nine general-lane answers reached the customer (plan ACCEPTED, webhook completed) while
// their AiTurn rows stayed PROCESSING. The next turn's conversation context reads only COMPLETED/REFUSED
// rows, so a follow-up to a general answer lost that answer.
for (const scenario of [
  { name: 'a delivered answer', refused: false, delivery: 'ok', status: 'COMPLETED', errorCode: undefined },
  { name: 'a delivered refusal', refused: true, delivery: 'ok', status: 'REFUSED', errorCode: undefined },
  { name: 'an answer LINE did not accept', refused: false, delivery: 'failed_other', status: 'ERROR', errorCode: 'LINE_DELIVERY_FAILED_OTHER' },
]) it(`finishes the AiTurn row of ${scenario.name} as ${scenario.status}, never leaving it PROCESSING`, async () => {
  const event: any = { webhookEventId: 'evt-row', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'ส่วนลดคืออะไร', inputEvidence: { joinedSha256: 'digest' } };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', chatKeyHash: 'chat' };
  const grant = { turnKey: 'turn' }, rows: any[] = [], statuses: string[] = [], acks: string[] = [];
  const route = { status: 'ROUTED', intent: 'ADVISOR_CONVERSATION', semanticSubrequests: [{ index: 0, kind: 'general', goal: 'discount', requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] };
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]), budgetGrantsV2: new WeakMap([[event, grant]]),
    deliveryAccess: new WeakMap([[event, { fingerprint: 'fp', membershipId: 'member' }]]), semanticDelivery: new WeakMap(), deliverySources: new WeakMap(),
    config: { webBaseUrl: '', lineAiApprovedKnowledgeEnabled: false, lineAiReliabilityV2Mode: 'on', lineAiReliabilityV2CompanyIds: [],
      lineAiDeliveryPlanV2Enabled: true, lineAiDeliveryPlanV2WriteCompanyIds: [] },
    reliabilityContext: async () => ({}),
    aiGateway: { narrowLineReliabilityGrant: async () => grant, requestLineTurn: async () => ({ replyText: 'ส่วนลดคือยอดที่ลดจากราคาขาย', webLinks: [],
      sourceLabels: [], toolsInvoked: [], sourceRefs: [], intent: 'unknown', agent: 'general', refused: scenario.refused, durationMs: 6683,
      semanticCoverage: [{ index: 0, status: 'handled' }] }) },
    ledger: { appendTurn: async () => 'ledger', ack: async () => { acks.push('ack'); } },
    // The real persistTurn writes the row; only its storage is faked.
    contextV2: { createTurn: async (_owner: unknown, _epoch: number, data: any) => { rows.push({ id: 'turn-row', ...data }); return rows[0]; } },
    prisma: { client: { aiTurn: { update: async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id), data) } } },
    updateEventLog: async (_id: string, status: string) => { statuses.push(status); },
    deliverMessages: async () => scenario.delivery,
  });
  await flow.deliverPureGeneralV2(event, 'request', route, { permissions: ['line.ai.query'], roles: [], scopes: {} }, [], undefined);
  assert.equal(rows.length, 1); assert.equal(rows[0].agent, 'general');
  assert.equal(rows[0].status, scenario.status); assert.equal(rows[0].errorCode, scenario.errorCode);
  assert.deepEqual(statuses, scenario.delivery === 'ok' ? ['response_ready', 'completed'] : ['response_ready']);
  assert.deepEqual(acks, scenario.delivery === 'ok' ? ['ack'] : [], 'an undelivered answer keeps its ledger entry for retry');
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

// UAT 2026-09-29 (main c4513ddd): the owner sent two receipt photos back to back. The second one waited
// behind the first, its draft was created 62 s after acceptance — past the 40 s foreground deadline — and
// the plan that should have announced it failed validation (PLAN_INVALID_LIFETIME) in 13 ms. The draft
// existed; the customer never heard about it.
function mediaResultFlow(createdAt: Date, capture: { saved?: DeliveryPlanV2 }) {
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    config: { aiDataRetentionDays: 30 }, semanticDelivery: new WeakMap(), documentQaDelivery: new WeakMap(), deliveryReimbursements: new WeakMap(), deliveryDraftPreviews: new WeakMap(),
    deliveryAccess: new WeakMap(), deliverySources: new WeakMap(), publicPolicyTopics: new WeakMap(),
    deliveryReceiptSources: new WeakMap(), deliverySubstituteSources: new WeakMap(), deliveryCandidates: new WeakMap(),
    persistSemanticTaskCompletion: async () => undefined,
    webhookPlanAuthorization: async (_event: any, expiresAt: string) => ({ v: 2, kind: 'PRIVATE', issuedAt: createdAt.toISOString(), expiresAt,
      actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint', channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 0 },
      proofs: [{ id: 'receipt', kind: 'EXPENSE_REVISION', records: [{ id: 'expense-2', revision: 'r1' }], categories: [], choices: null }] }),
    prisma: { client: { lineTurnOutcome: { findUnique: async () => null },
      lineWebhookEventLog: { findUnique: async () => ({ createdAt, budgetAuthorityJson: { grant: { finalDeadlineAtMs: createdAt.getTime() + 40_000 } } }) } } },
    deliveryPlans: { savePlan: async (_owner: unknown, plan: DeliveryPlanV2) => { capture.saved = plan; return { id: plan.planId }; } },
    replayDeliveryPlan: async () => 'ok',
  });
  return flow;
}
const SECOND_PHOTO: any = { webhookEventId: 'second-photo', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', lineMessageId: 'msg-2', messageType: 'image' };

it('a photo result that finishes after the foreground deadline still freezes a deliverable plan', async () => {
  const capture: { saved?: DeliveryPlanV2 } = {};
  const flow = mediaResultFlow(new Date(Date.now() - 62_000), capture);
  assert.equal(await flow.sendMessagesV2(SECOND_PHOTO, [{ type: 'text', text: '🧾 บันทึกร่างค่าใช้จ่ายแล้ว ยอด 120.00 บาท' }]), 'ok');
  assert.ok(capture.saved && parseLineDeliveryPlan(capture.saved), 'the plan validates');
  assert.ok(Date.parse(capture.saved!.firstDispatchDeadlineAt) > Date.parse(capture.saved!.readyAt), 'its first send may still start');
  assert.equal(capture.saved!.firstDispatchDeadlineAt, capture.saved!.expiresAt, 'a stored-file result lives as long as its plan');
});

it('an expired reply token is followed at once by a push of the same frozen batch (E4)', async () => {
  const capture: { saved?: DeliveryPlanV2 } = {};
  await mediaResultFlow(new Date(Date.now() - 62_000), capture).sendMessagesV2(SECOND_PHOTO, [{ type: 'text', text: '🧾 บันทึกร่างค่าใช้จ่ายแล้ว' }]);
  const plan = capture.saved!, row = { id: plan.planId, status: 'READY', planJson: plan, planHash: deliveryHash(plan), outcomeId: 'outcome-2' };
  const sent: Array<{ transport: string; messages: unknown }> = [];
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, {
    prisma: { client: { lineDeliveryPlan: { findUnique: async () => row }, lineTurnOutcome: { updateMany: async () => ({ count: 1 }) } } },
    verifyWebhookPlan: async () => true,
    deliveryPlans: {
      claimPlan: async () => ({ row, plan, states: [{ status: 'READY', variant: 'primary', replyAttempted: false, pushAttempts: 0 }], token: 'lease', fence: {} }),
      beginPlanBatch: async () => ({ index: 0, timeoutMs: 5_000 }),
      finishPlanBatch: async (claim: any, index: number, result: any) => {
        claim.states[index] = { ...claim.states[index], status: result.kind === 'accepted' ? 'ACCEPTED' : 'READY' }; return true;
      },
    },
    lineReply: { sendFrozenV2: async (input: any) => {
      sent.push({ transport: input.transport, messages: input.messages });
      return input.transport === 'REPLY' ? { kind: 'rejected', code: 'REPLY_TOKEN_REJECTED', rejection: 'TOKEN' } : { kind: 'accepted', code: 'API_ACCEPTED' };
    } },
  });
  assert.equal(await flow.replayDeliveryPlan(plan.planId, { ...SECOND_PHOTO, pushTargetId: 'line' }, 2), 'ok');
  assert.deepEqual(sent.map(item => item.transport), ['REPLY', 'PUSH'], 'the push follows the refused reply in the same turn');
  assert.deepEqual(sent[1]!.messages, sent[0]!.messages, 'the same frozen words, not a re-render');
});

it('a deterministic receipt reply is delivered as its card with the link on a button, as production sent it', async () => {
  const capture: { saved?: DeliveryPlanV2 } = {};
  const text = '📸 บันทึกเป็นร่างค่าใช้จ่ายแล้ว (รอตรวจสอบ)\n• ยอดรวม – 120.00 บาท\n\n✅ ตรวจสอบและยืนยันในเว็บแอป:\nhttps://app.example.com/companies/company/expenses/expense-2';
  const card = buildLineAssistantTextCardMessage(text, 'https://app.example.com', 'company');
  await mediaResultFlow(new Date(), capture).sendMessagesV2(SECOND_PHOTO, [card]);
  const primary = capture.saved!.batches[0]!.primary.messages[0]!, fallback = capture.saved!.batches[0]!.fallback?.messages[0];
  assert.equal(primary.type, 'flex', 'the card itself, not its canonical text');
  assert.doesNotMatch(JSON.stringify((primary as any).contents.body), /https?:\/\//u, 'no raw link in the card body');
  assert.match(JSON.stringify((primary as any).contents.footer), /ตรวจสอบและยืนยันในเว็บแอป/u, 'the link is the labelled button');
  assert.equal(fallback?.type, 'text', 'the plain text stays the fallback');
});

it('a text answer finished after its foreground deadline is delivered, never dropped as PLAN_INVALID_LIFETIME', async () => {
  const capture: { saved?: DeliveryPlanV2 } = {};
  const flow = mediaResultFlow(new Date(Date.now() - 75_000), capture);
  const lateText: any = { webhookEventId: 'late-text', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'สรุปค่าใช้จ่ายเดือนนี้ให้หน่อย' };
  assert.equal(await flow.sendMessagesV2(lateText, [{ type: 'text', text: 'ค่าใช้จ่ายเดือนนี้รวม 4,325.50 บาทค่ะ' }]), 'ok');
  assert.ok(capture.saved && parseLineDeliveryPlan(capture.saved), 'the plan validates');
  assert.equal(capture.saved!.firstDispatchDeadlineAt, capture.saved!.expiresAt);
  // An answer still inside its foreground deadline keeps that deadline.
  const onTime: { saved?: DeliveryPlanV2 } = {};
  const created = new Date();
  await mediaResultFlow(created, onTime).sendMessagesV2({ ...lateText, webhookEventId: 'on-time-text' }, [{ type: 'text', text: 'ทันเวลา' }]);
  assert.equal(onTime.saved!.firstDispatchDeadlineAt, new Date(created.getTime() + 40_000).toISOString());
});

// Production 2026-10-01: a shop over its receipt quota sent a photo and heard nothing. The quota card
// carried no canonicalText, so this seam threw LINE_PLAN_CANONICAL_TEXT_REQUIRED before a plan was saved;
// "เมนูหลัก" and the other deterministic cards of a bound chat failed the same way. Each now freezes into
// a plan as its own words, with its quick reply. (A card is sent as itself only with the business
// renderer's completeness proof; these carry none, so the text is what reaches the customer. The two
// limit cards carry it — see below.)
const STAFF_MENU = { displayName: 'พิม', roleLabel: 'เจ้าของ', branchScopeLabel: 'ทุกสาขา', companyId: 'company', webBaseUrl: 'https://app.example.com',
  permissions: ['reimbursement.approve', 'expense.read', 'expense.receipt.line_upload'], entitledFeatureKeys: null };
for (const [name, card] of [
  ['main menu', buildStaffMainMenu(STAFF_MENU)],
  ['services', buildServiceEntitlementMessage(null)],
  ['receipt prompt', buildReceiptCapturePrompt(STAFF_MENU)],
  ['pending approvals', buildPendingApprovalCard(STAFF_MENU, { reimbursement: { total: 1, items: ['RB-1 · 100.00 บาท'] } })],
  ['reimbursement payer question', buildReimbursementPayerClarificationMessage()],
  ['reimbursement handoff', buildReimbursementHandoffMessage('https://app.example.com', 'company')],
] as const) it(`freezes the ${name} card of a bound chat as its own words, never LINE_PLAN_CANONICAL_TEXT_REQUIRED`, async () => {
  assert.equal(card.type, 'flex');
  const capture: { saved?: DeliveryPlanV2 } = {};
  assert.equal(await mediaResultFlow(new Date(), capture).sendMessagesV2({ ...SECOND_PHOTO, webhookEventId: `card-${name}` }, [card]), 'ok');
  assert.ok(capture.saved && parseLineDeliveryPlan(capture.saved), 'the plan validates');
  assert.deepEqual(capture.saved!.batches.flatMap(batch => batch.primary.messages), [{ type: 'text',
    text: withLineExternalBrowserText((card as any).canonicalText, Number.POSITIVE_INFINITY), ...(card.quickReply ? { quickReply: card.quickReply } : {}) }]);
});

// A limit card exists for its buttons — "ดูแพ็กเกจ / ขอเปลี่ยนแพ็กเกจ" at the moment the limit is hit — so
// the plan sends the card itself, exactly as the builder made it, and keeps its sentence as the fallback
// LINE gets if it refuses the Flex body. Advisor spec §2.2 holds in both forms: the buttons are for a
// reader who may manage the package; anyone else gets no button and is told who to ask.
const TOTAL_EXCEEDED = { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' } as const;
const PACKAGE_BUTTONS = ['ดูแพ็กเกจ', 'ขอเปลี่ยนแพ็กเกจ'];
for (const [name, card, buttons] of [
  ['receipt quota (owner)', buildReceiptQuotaExceededMessage(receiptQuotaExceededTextTh(30, 'STARTER_249', undefined, false, true), true), PACKAGE_BUTTONS],
  ['receipt quota (staff)', buildReceiptQuotaExceededMessage(receiptQuotaExceededTextTh(30, 'STARTER_249', undefined, false, false), false), []],
  ['AI credit (owner)', buildAiBudgetExceededMessage(false, TOTAL_EXCEEDED, true), PACKAGE_BUTTONS],
  ['AI credit (staff)', buildAiBudgetExceededMessage(false, TOTAL_EXCEEDED, false), []],
  ['AI credit, not enough left (owner)', buildAiBudgetExceededMessage(true, { budgetErrorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'TOTAL' }, true), PACKAGE_BUTTONS],
  ['chat credit (staff)', buildAiBudgetExceededMessage(false, { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT' }, false), ['ติดต่อเจ้าหน้าที่']],
] as const) it(`sends the ${name} card of a bound chat as the card itself`, async () => {
  const capture: { saved?: DeliveryPlanV2 } = {};
  assert.equal(await mediaResultFlow(new Date(), capture).sendMessagesV2({ ...SECOND_PHOTO, webhookEventId: `limit-card-${name}` }, [card]), 'ok');
  assert.ok(capture.saved && parseLineDeliveryPlan(capture.saved), 'the plan validates');
  const { canonicalText, ...wire } = card as any;
  assert.deepEqual(capture.saved!.batches.map(batch => batch.primary.messages), [[wire]], 'the plan item is the Flex card, byte for byte');
  assert.deepEqual((wire.contents.footer?.contents ?? []).map((button: any) => button.action.label), buttons);
  assert.deepEqual(capture.saved!.batches[0]!.fallback?.messages, [{ type: 'text', text: canonicalText }]);
  assert.equal(capture.saved!.answer.items[0]!.text, canonicalText);
  if (name.endsWith('(staff)') && buttons.length === 0) {
    assert.ok(canonicalText.endsWith(ASK_PLAN_MANAGER_TH), canonicalText);
    assert.doesNotMatch(JSON.stringify(capture.saved!.batches), /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|แพ็กเกจที่ใหญ่ขึ้น|ซื้อ|โปรโมชั่น/);
  }
});

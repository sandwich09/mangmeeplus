import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../../generated/prisma/client';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';

it('answers an admitted private general/help turn without private ERP prefetch or touching four waiting tasks', async () => {
  const event: any = { webhookEventId: 'evt', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'ทำไมท้องฟ้าเป็นสีฟ้า', inputEvidence: { joinedSha256: 'digest' } };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', chatKeyHash: 'chat' };
  const grant = { turnKey: 'turn' }, calls: string[] = [];
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
      assert.equal(request.conversationContext, undefined);
      return { replyText: 'อากาศกระเจิงแสงสีน้ำเงิน', webLinks: [], sourceLabels: [], toolsInvoked: [], sourceRefs: [], refused: false, semanticCoverage: [{ index: 0, status: 'handled' }] };
    } },
    ledger: { appendTurn: async ({ acceptedRequest }: any) => { calls.push('durable'); assert.equal(acceptedRequest.request.budgetGrantV2, grant); return 'ledger'; }, ack: async () => calls.push('ack') },
    persistTurn: async () => { calls.push('persist'); }, updateEventLog: async () => undefined,
    deliverMessages: async (_event: any, messages: any[]) => { calls.push('accepted'); assert.match(messages[0].text, /อากาศ/); return 'ok'; },
  });
  await flow.deliverPureGeneralV2(event, 'request', route, { permissions: ['line.ai.query'], roles: [], scopes: {} }, [], undefined);
  assert.deepEqual(calls, ['durable', 'answer', 'persist', 'accepted', 'ack']);
});

for (const scenario of [
  { name: 'general grant admission is unavailable', kind: 'grant', status: 'provider_unavailable', error: 'AI_GENERAL_ADMISSION_UNAVAILABLE', calls: ['narrow', 'reply', 'terminal'] },
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
      narrowLineReliabilityGrant: async () => { calls.push('narrow'); return scenario.kind === 'grant' ? null : grant; },
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
  assert.deepEqual(tasks, originalTasks); assert.equal(flow.semanticDelivery.has(event), false); assert.equal(flow.deliverySources.has(event), false);
});

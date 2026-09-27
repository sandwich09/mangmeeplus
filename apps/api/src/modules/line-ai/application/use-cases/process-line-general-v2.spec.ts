import { it } from 'node:test';
import assert from 'node:assert/strict';
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

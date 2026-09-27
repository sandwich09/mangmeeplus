import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';

function fixture(kind: 'general' | 'read' = 'general') {
  const event: any = { webhookEventId: 'evt', messagingChannelId: 'oa', lineUserId: 'line', replyToken: 'reply', messageText: 'บันทึกค่าเดินทาง 100 บาท แล้วกำไรกับเงินสดต่างกันอย่างไร', inputEvidence: { joinedSha256: 'digest' } };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', chatKeyHash: 'chat' };
  const grant = { turnKey: 'turn' }, calls: string[] = [], delivered: any[][] = [];
  const route: any = { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', semanticSubrequests: [
    { index: 0, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: 'บันทึกค่าเดินทาง', requiredEvidence: [], requestedFilters: {}, dependsOn: [] },
    { index: 1, kind, goal: 'กำไรต่างจากเงินสดอย่างไร', requiredEvidence: [], requestedFilters: {}, dependsOn: [] },
  ] };
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  let acceptance = 'ok', providerFails = false;
  Object.assign(flow, {
    boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]), budgetGrantsV2: new WeakMap([[event, grant]]),
    deliveryAccess: new WeakMap([[event, { fingerprint: 'fp' }]]), semanticDelivery: new WeakMap(), deliverySources: new WeakMap(),
    bindMixedTaskSource: async () => {}, retainedTaskSources: new WeakMap(), mixedBusinessQuestions: new WeakMap(), intermediateDeliveries: new WeakSet(), config: { webBaseUrl: '', lineAiApprovedKnowledgeEnabled: false },
    reliabilityContext: async () => ({ taskProjection: { tasks: [{ taskId: 'task', state: 'active' }] } }),
    aiGateway: { requestLineTurn: async (request: any) => {
      calls.push('answer'); assert.equal(request.messageText, event.messageText); assert.equal(request.inputEvidence, event.inputEvidence);
      assert.equal(request.budgetGrantV2, grant); assert.equal(request.intakeIntent, 'BUSINESS_READ_QUESTION');
      assert.deepEqual(request.semanticSubrequests.map((item: any) => [item.index, item.kind]), [[0, kind]]);
      if (providerFails) throw new Error('provider unavailable');
      return { requestId: 'req', replyText: 'กำไรนับรายได้หักค่าใช้จ่าย ส่วนเงินสดคือเงินรับจ่ายจริง', intent: 'casual_conversation', agent: 'orchestrator', durationMs: 1,
        webLinks: [], sourceLabels: [], toolsInvoked: kind === 'read' ? ['expense.get_daily_closing'] : [], sourceRefs: [], refused: false, semanticCoverage: [{ index: 0, status: 'handled' }] };
    } },
    readEvidence: { forTurn: async () => { calls.push('evidence'); return kind === 'read' ? ['read-evidence'] : []; } },
    ledger: { appendTurn: async ({ acceptedRequest }: any) => { calls.push('durable'); assert.equal(acceptedRequest.request.budgetGrantV2, grant);
      assert.deepEqual(acceptedRequest.request.semanticSubrequests, route.semanticSubrequests); return 'ledger'; }, ack: async () => calls.push('ack') },
    timeStage: async (_event: string, _stage: string, fn: any) => fn(),
    sendMessages: async (_event: any, messages: any[]) => { calls.push('send'); delivered.push(messages); return acceptance; },
    settleSemanticTask: async (_event: any, coverage: any[]) => { calls.push('settle'); assert.deepEqual(coverage.map(item => item.index), [0, 1]); },
  });
  return { flow, event, route, calls, delivered, access: { permissions: ['line.ai.query'], roles: [], scopes: {} },
    rejectDelivery: () => { acceptance = 'failed_other'; }, failProvider: () => { providerFails = true; } };
}

describe('same-turn existing business write and independent questions', () => {
  it('retains full admitted inventory before answering, then sends committed receipt and side answer together', async () => {
    const f = fixture();
    assert.equal(await f.flow.prepareMixedBusinessQuestions(f.event, 'req', f.route, f.access, null, undefined), true);
    assert.deepEqual(f.calls, ['durable', 'answer', 'evidence']);
    f.flow.mixedBusinessQuestions.get(f.event).businessStatus = 'handled'; // set only after original API capture returns its receipt
    assert.equal(await f.flow.deliverMessages(f.event, [{ type: 'text', text: 'บันทึกร่างค่าเดินทาง 100 บาทแล้ว' }]), 'ok');
    assert.equal(f.delivered[0]!.length, 2); assert.match(f.delivered[0]![0].text, /100/); assert.match(f.delivered[0]![1].text, /เงินสด/);
    assert.deepEqual(f.flow.semanticDelivery.get(f.event), [{ index: 0, status: 'handled' }, { index: 1, status: 'handled' }]);
    assert.deepEqual(f.calls.slice(-3), ['send', 'settle', 'ack']);
  });
  it('keeps a write clarification and read source proof while failed delivery closes neither task nor ledger', async () => {
    const f = fixture('read'); f.rejectDelivery();
    assert.equal(await f.flow.prepareMixedBusinessQuestions(f.event, 'req', f.route, f.access, null, undefined), true);
    assert.deepEqual(f.flow.deliverySources.get(f.event), { requestId: 'req', ids: ['read-evidence'] });
    assert.equal(await f.flow.deliverMessages(f.event, [{ type: 'text', text: 'ค่าเดินทางนี้จ่ายวันที่เท่าไรคะ' }]), 'failed_other');
    assert.equal(f.flow.semanticDelivery.get(f.event)[0].status, 'needs_user');
    assert.equal(f.calls.includes('settle'), false); assert.equal(f.calls.includes('ack'), false);
  });
  it('does not lose a successful business receipt when the independent provider fails', async () => {
    const f = fixture(); f.failProvider();
    assert.equal(await f.flow.prepareMixedBusinessQuestions(f.event, 'req', f.route, f.access, null, undefined), true);
    f.flow.mixedBusinessQuestions.get(f.event).businessStatus = 'handled';
    await f.flow.deliverMessages(f.event, [{ type: 'text', text: 'บันทึกร่างแล้ว' }]);
    assert.match(f.delivered[0]![0].text, /บันทึก/); assert.match(f.delivered[0]![1].text, /ยังตอบส่วนนี้ไม่สำเร็จ/);
    assert.deepEqual(f.flow.semanticDelivery.get(f.event).map((item: any) => item.status), ['handled', 'needs_user']);
  });
  it('runs the guarded write first and keeps its source-dependent question pending against the committed result', async () => {
    const f = fixture('read'); f.route.semanticSubrequests[1].dependsOn = [0];
    assert.equal(await f.flow.prepareMixedBusinessQuestions(f.event, 'req', f.route, f.access, null, undefined), true);
    assert.deepEqual(f.calls, ['durable']); // no dependent provider/read before the source write
    const pending = f.flow.mixedBusinessQuestions.get(f.event);
    assert.deepEqual(pending.dependentQuestions, [{ index: 1, goal: 'กำไรต่างจากเงินสดอย่างไร', dependsOn: [0] }]);
    pending.businessStatus = 'handled'; // set only after the guarded API domain returned its receipt
    assert.equal(await f.flow.deliverMessages(f.event, [{ type: 'text', text: 'บันทึกร่างค่าเดินทางแล้ว' }]), 'ok');
    assert.match(f.delivered[0]![1].text, /รายการที่เพิ่งบันทึก/);
    assert.deepEqual(f.flow.semanticDelivery.get(f.event), [
      { index: 0, status: 'handled' },
      { index: 1, status: 'needs_user', reasonCode: 'DEPENDENCY_SOURCE_PENDING', question: 'กรุณาถามข้อ 2 ต่อโดยอ้างรายการที่เพิ่งบันทึก' },
    ]);
    assert.deepEqual(f.calls, ['durable', 'send', 'settle', 'ack']);
  });

  it('dispatches multiple document writes to an explicit one-at-a-time selection without executing or dropping either action', async () => {
    const f = fixture();
    const owner = f.flow.boundConversations.get(f.event).owner;
    let projection: any = { version: 2, stateVersion: 1, lifecycleEpoch: 3, tasks: [{ taskId: 'accepted-expense', revision: 4,
      kind: 'write', state: 'waiting_user', userGoal: 'บันทึกค่าเดินทาง', slots: { amount: '100', purpose: 'เดินทาง' },
      subrequests: [{ index: 0, kind: 'write', goal: 'บันทึกค่าเดินทาง', status: 'needs_user' }] }] };
    f.flow.contextV2 = { projection: async () => structuredClone(projection), save: async (_owner: any, version: number, epoch: number, next: any) => {
      assert.equal(_owner, owner); assert.equal(version, projection.stateVersion); assert.equal(epoch, 3);
      projection = { ...next, stateVersion: version + 1, lifecycleEpoch: epoch }; return true;
    } };
    f.flow.semanticTaskMappings = new WeakMap();
    f.flow.settleSemanticTask = (ProcessLineWebhookUseCase.prototype as any).settleSemanticTask.bind(f.flow);
    f.route.semanticSubrequests[0].taskRef = { taskId: 'accepted-expense', taskRevision: 4, subrequestIndex: 0 };
    f.route.semanticSubrequests[1] = { index: 1, kind: 'write', writeIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
      goal: 'ทำใบรับรองแทนใบเสร็จสำหรับค่าแท็กซี่', requiredEvidence: [], requestedFilters: {}, dependsOn: [] };
    assert.equal(await f.flow.preserveSemanticTask(f.event, f.route.semanticSubrequests), true);
    assert.equal(await f.flow.prepareMixedBusinessQuestions(f.event, 'req', f.route, f.access, null, undefined), true);
    assert.deepEqual(f.calls, ['durable']); // no generic writer and no reused expense-create call
    assert.equal(await f.flow.deliverMixedBusinessWriteSelection(f.event, f.route.semanticSubrequests), 'ok');
    assert.equal(f.delivered[0]!.length, 1);
    assert.match(f.delivered[0]![0].text, /1\) บันทึกค่าเดินทาง/);
    assert.match(f.delivered[0]![0].text, /2\) ทำใบรับรองแทนใบเสร็จ/);
    assert.match(f.delivered[0]![0].text, /ระบบจะใช้รายละเอียดเดิมของข้อนั้น/);
    assert.deepEqual(f.flow.semanticDelivery.get(f.event).map((item: any) => [item.index, item.status, item.reasonCode]), [
      [0, 'needs_user', 'FINANCIAL_ACTION_SELECTION_REQUIRED'],
      [1, 'needs_user', 'FINANCIAL_ACTION_SELECTION_REQUIRED'],
    ]);
    assert.deepEqual(projection.tasks[0].slots, { amount: '100', purpose: 'เดินทาง' });
    assert.equal(projection.tasks[0].state, 'waiting_user'); assert.equal(projection.tasks[0].revision, 6);
    assert.equal(projection.tasks[1].state, 'waiting_user');
    const nextEvent = { ...f.event, webhookEventId: 'evt-next' };
    f.flow.boundConversations.set(nextEvent, f.flow.boundConversations.get(f.event));
    const selected = [{ ...f.route.semanticSubrequests[0], index: 0, taskRef: { taskId: 'accepted-expense', taskRevision: 6, subrequestIndex: 0 } }];
    assert.equal(await f.flow.preserveSemanticTask(nextEvent, selected), true); // the numbered choice reaches the exact current task revision
    assert.deepEqual(projection.tasks[0].slots, { amount: '100', purpose: 'เดินทาง' });
    assert.equal(projection.tasks[0].state, 'active');
    assert.equal(projection.tasks[1].state, 'waiting_user'); // the other document stays paused for a later, separately identified turn
    assert.deepEqual(f.calls, ['durable', 'send', 'ack']);
  });
});

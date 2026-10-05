import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase, pendingWorkReply } from './process-line-webhook.use-case';
import { readLineSystemCard } from '../../domain/logic/line-system-card.fixture';

function fixture() {
  const event = { webhookEventId: 'followup' }, owner = { companyId: 'company' };
  let projection: any = { version: 2, stateVersion: 2, lifecycleEpoch: 3, tasks: [
    { taskId: 'claim', revision: 4, kind: 'write', state: 'waiting_user', userGoal: 'claim taxi', slots: { title: 'already accepted' },
      sourceRevisionLocators: [{ sourceType: 'REIMBURSEMENT_ACTION', sourceId: 'action', revision: 'pending' }],
      subrequests: [{ index: 0, kind: 'write', goal: 'claim taxi', status: 'needs_user' }] },
    { taskId: 'read', revision: 2, kind: 'read', state: 'paused', userGoal: 'report', subrequests: [{ index: 0, kind: 'read', goal: 'report', status: 'needs_user' }] },
  ] };
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  Object.assign(flow, { boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]), semanticTaskMappings: new WeakMap(),
    contextV2: { projection: async () => structuredClone(projection), save: async (_owner: any, version: number, epoch: number, next: any) => {
      assert.equal(_owner, owner); assert.equal(epoch, 3); assert.equal(version, projection.stateVersion);
      projection = { ...next, stateVersion: version + 1, lifecycleEpoch: epoch }; return true;
    } } });
  return { flow, event, projection: () => projection };
}
const resume = { index: 0, kind: 'write', goal: 'taxi amount 100', requiredEvidence: [], requestedFilters: {}, dependsOn: [], taskRef: { taskId: 'claim', taskRevision: 4, subrequestIndex: 0 } };
it('resumes the selected exact revision, retains accepted fields, and keeps a side question independent', async () => {
  const f = fixture();
  assert.equal(await f.flow.preserveSemanticTask(f.event, [resume, { index: 1, kind: 'general', goal: 'why sky blue', requiredEvidence: [], requestedFilters: {}, dependsOn: [] }]), true);
  assert.equal(f.projection().tasks.length, 3);
  assert.deepEqual(f.projection().tasks[0].slots, { title: 'already accepted' });
  assert.equal(f.projection().tasks[1].state, 'paused');
  await f.flow.settleSemanticTask(f.event, [{ index: 0, status: 'needs_user', question: 'confirm preview' }, { index: 1, status: 'handled' }], ['action']);
  assert.equal(f.projection().tasks[0].state, 'waiting_user');
  assert.equal(f.projection().tasks[0].revision, 6);
  assert.equal(f.projection().tasks[2].state, 'completed');
  assert.equal(f.projection().tasks[1].revision, 2);
});
it('closes a system give-up (unsupported) as completed like a success, never waiting_user, and records no question', async () => {
  const f = fixture();
  assert.equal(await f.flow.preserveSemanticTask(f.event, [resume, { index: 1, kind: 'read', goal: 'ยอดเดือนนี้เท่าไหร่', requiredEvidence: [], requestedFilters: {}, dependsOn: [] }]), true);
  assert.equal(f.projection().tasks.length, 3);
  await f.flow.settleSemanticTask(f.event, [{ index: 0, status: 'needs_user', question: 'confirm preview' },
    { index: 1, status: 'unsupported', reasonCode: 'READ_SOURCE_UNAVAILABLE' }], ['action']);
  assert.equal(f.projection().tasks[0].state, 'waiting_user', 'a genuine missing-value clarification still waits on the user');
  assert.equal(f.projection().tasks[2].state, 'completed', 'a system give-up closes the task instead of leaving it waiting');
  assert.deepEqual(f.projection().tasks[2].deliveredQuestionRefs ?? [], [], 'an unsupported give-up records no delivered question');
});
it('rejects stale, unknown, duplicate or wrong-kind task selection before changing state', async () => {
  for (const item of [
    { ...resume, taskRef: { ...resume.taskRef, taskRevision: 3 } },
    { ...resume, taskRef: { ...resume.taskRef, taskId: 'other-owner-task' } }, { ...resume, kind: 'general' },
  ]) {
    const f = fixture(); assert.equal(await f.flow.preserveSemanticTask(f.event, [item]), false); assert.equal(f.projection().stateVersion, 2);
  }
  const f = fixture(); assert.equal(await f.flow.preserveSemanticTask(f.event, [resume, { ...resume, index: 1 }]), false);
});
it('continuation uses the same task even when all four task slots are occupied', async () => {
  const f = fixture();
  f.projection().tasks.push(...[2, 3].map(i => ({ taskId: `waiting-${i}`, revision: 1, kind: 'read', state: 'waiting_user', userGoal: 'question', subrequests: [{ index: 0, kind: 'read', goal: 'question', status: 'needs_user' }] })));
  assert.equal(await f.flow.preserveSemanticTask(f.event, [resume]), true);
  assert.equal(f.projection().tasks.length, 4);
});

it('binds every accepted QA clause to the durable job and restores after a new worker event', async () => {
  const f = fixture();
  const inventory = [{ index: 0, kind: 'file', goal: 'read total', requiredEvidence: [], requestedFilters: {}, dependsOn: [] },
    { index: 1, kind: 'general', goal: 'why sky blue', requiredEvidence: [], requestedFilters: {}, dependsOn: [] }];
  assert.equal(await f.flow.preserveSemanticTask(f.event, inventory), true);
  const binding = f.flow.boundConversations.get(f.event);
  Object.assign(binding.owner, { userId: 'user', membershipId: 'member', messagingChannelId: 'oa', chatKeyHash: 'chat' });
  f.flow.documentQa = { getById: async () => ({ id: 'job', companyId: 'company', userId: 'user', ownerMembershipId: 'member', ownerEpoch: 3,
    messagingChannelId: 'oa', chatKeyHash: 'chat', revision: 1,
    attachmentsJson: [{ attachmentId: 'file', contentHash: 'a'.repeat(64), requestedPages: [1, 2] }] }) };
  await f.flow.bindDocumentQaTask(f.event, 'job');
  assert.equal(f.projection().tasks[2].state, 'waiting_job');
  assert.deepEqual(f.projection().tasks[2].attachmentPageRefs, [{ attachmentId: 'file', contentHash: 'a'.repeat(64), pages: [1, 2] }]);
  const recovered = { webhookEventId: 'followup' }; f.flow.boundConversations.set(recovered, binding);
  assert.equal(f.flow.semanticTaskMappings.has(recovered), false);
  assert.deepEqual((await f.flow.restoreDocumentQaTask(recovered, 'job')).map((item: any) => [item.index, item.kind]), [[0, 'file'], [1, 'general']]);
  await f.flow.settleSemanticTask(recovered, [{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user', question: 'why sky blue' }]);
  assert.equal(f.projection().tasks[2].state, 'waiting_user');
  assert.deepEqual(f.projection().tasks[2].subrequests.map((item: any) => item.status), ['handled', 'needs_user']);
  assert.equal(f.projection().tasks[0].revision, 4);
});

it('extracts QA questions only from exact original source spans, without replacing them with a paraphrased goal', async () => {
  const f = fixture(), text = 'ยอดรวมเท่าไร และท้องฟ้าสีฟ้าเพราะอะไร';
  const event = { messageText: text, inputEvidence: { parts: [{ partId: 'part', rawText: text, rawSha256: 'a'.repeat(64) }] } };
  const clause = { index: 0, kind: 'file', goal: 'paraphrased total question', evidenceRefs: [{ partId: 'part', rawSha256: 'a'.repeat(64), startUtf16: 0, endUtf16: 12 }] };
  assert.deepEqual(f.flow.documentQaQuestions(event, [clause]), [{ subrequestIndex: 0, question: text.slice(0, 12) }]);
  assert.throws(() => f.flow.documentQaQuestions(event, [{ ...clause, evidenceRefs: [{ ...clause.evidenceRefs[0], rawSha256: 'b'.repeat(64) }] }]), /QA_QUESTION_EVIDENCE_MISSING/);
});

// NAT04/NAT12 real-model re-test (2026-09-29): typed cancel/review of the chat's one unconfirmed work.
it('reads a typed cancel or a no-save review only as those, never a new value or a negated cancel', () => {
  for (const text of ['เดี๋ยว ๆ ยกเลิกก่อน', 'ขอยกเลิกก่อน เดี๋ยวถามฝ่ายบัญชี', 'ไม่เอาแล้ว']) assert.equal(pendingWorkReply(text), 'cancel', text);
  for (const text of ['ขอเช็กยอดกับชื่อร้านก่อน ยังไม่ต้องบันทึก', 'อย่าเพิ่งยืนยันนะ']) assert.equal(pendingWorkReply(text), 'review', text);
  for (const text of ['ไม่ยกเลิกนะ', 'ยกเลิก 300 เป็น 350', 'เมื่อกี้เน็ตหลุด สรุปบันทึกไปยัง', 'ยอดขายวันนี้เท่าไหร่']) assert.equal(pendingWorkReply(text), null, text);
});

function pendingFixture(kind: 'edit' | 'claim') {
  const f = fixture(), sent: string[] = [], cards: any[] = [], calls: string[] = [], logs: string[] = [];
  const event = Object.assign(f.event, { messageText: 'เดี๋ยว ๆ ยกเลิกก่อน', lineUserId: 'line-user' });
  const edit = { previewId: 'preview-1', expenseId: 'expense-1', record: { vendorName: 'ค่าส่งของ', expenseDate: '2026-09-29', statusLabel: 'รอตรวจสอบ' },
    tool: 'expense.draft.set_line', diff: [{ label: 'บรรทัด 1 จำนวนเงิน', before: '300.00', after: '350.00', kind: 'money' }],
    totalsBefore: { grandTotalAmount: '300.0000' }, totalsAfter: { grandTotalAmount: '350.0000' }, warnings: [], expiresAt: '2026-09-29T10:00:00Z' };
  const preview = { actionId: 'action', previewRevision: 2, confirmationDigest: 'd'.repeat(64), after: { amount: '245.00', reason: 'ซื้อของใช้ในออฟฟิศ',
    lines: [{ lineNo: 1, description: 'ปากกา', incurredDate: '2026-09-24', amount: '245.00', purpose: 'ซื้อของใช้ในออฟฟิศ', linkedExpenseId: 'bill-1' }] } };
  Object.assign(f.flow, {
    config: { webBaseUrl: 'https://web.test' },
    draftUpdate: { pendingPreview: async () => kind === 'edit' ? edit : null,
      cancel: async (_ctx: any, _chat: string, id: string) => { calls.push(`edit-cancel:${id}`); return 'cancelled'; } },
    reimbursementDrafts: {
      active: async () => kind === 'claim' ? { id: 'action' } : null,
      get: async () => ({ status: 'preview', preview }),
      cancel: async ({ control }: any) => { calls.push(`claim-cancel:${control.actionId}:${control.previewRevision}`); return { status: 'cancelled', actionId: 'action' }; },
      cancelCollection: async () => { throw new Error('a preview is cancelled by its revision'); },
    },
    expenseRepo: { findById: async (_company: string, id: string) => id === 'bill-1' ? { vendorNameSnapshot: 'ร้านเครื่องเขียนสมใจ', vendorDocumentNumber: 'NAT-STN-001' } : null },
    finishReimbursementTask: async (_owner: any, _epoch: number, id: string, applied: boolean) => { calls.push(`finish:${id}:${applied}`); },
    // The reply's sentence, and — for a pending edit — the same sentence as its card of the locked design.
    deliverReply: async (_event: any, text: string, _quickReply: unknown, designed?: unknown) => { sent.push(text); cards.push(designed); },
    persistIntakeTurn: async () => undefined,
    updateEventLog: async (_id: string, status: string) => { logs.push(status); },
  });
  const ctx = { requestId: 'request', userId: 'user', companyId: 'company', membershipId: 'member', permissions: ['expense.update'], scopes: {} };
  return { ...f, event, ctx, sent, cards, calls, logs };
}

it('a typed cancel drops the pending edit, closes its waiting task and says what stays recorded', async () => {
  const f = pendingFixture('edit');
  assert.equal(await f.flow.handlePendingWorkControl(f.event, f.ctx), true);
  assert.deepEqual(f.calls, ['edit-cancel:preview-1']);
  assert.equal(f.projection().tasks[0].state, 'canceled', 'the one waiting write task is closed');
  assert.match(f.sent[0]!, /ยกเลิกการแก้ไขแล้ว/u); assert.match(f.sent[0]!, /ยอดรวม 300\.00 บาท/u);
  assert.match(f.sent[0]!, /ยังบันทึกเป็นร่างไว้/u, 'never claims that nothing was recorded');
  assert.deepEqual(f.logs, ['pending_work_cancelled']);
  // Design lock context 4 "ยกเลิกแล้ว": the same sentence on the locked card, the record's link as its button.
  const card = readLineSystemCard(f.cards[0]);
  assert.deepEqual(card.header, ['แก้ไขค่าใช้จ่าย', 'ยกเลิกแล้ว']);
  assert.match(card.prose.join('\n'), /ยกเลิกการแก้ไขแล้ว.*ยอดรวม 300\.00 บาท/su);
  assert.deepEqual(card.actions.map((action) => [action.label, action.uri]), [['ดูในเว็บ', 'https://web.test/companies/company/expenses/expense-1']]);
  assert.equal(f.cards[0].canonicalText, f.sent[0], 'the sentence is the card\'s canonical text and fallback');
});

it('a no-save review of a pending edit says it is still waiting; an edit that is gone says nothing was changed', async () => {
  const review = pendingFixture('edit'); review.event.messageText = 'อย่าเพิ่งยืนยันนะ';
  assert.equal(await review.flow.handlePendingWorkControl(review.event, review.ctx), true);
  assert.deepEqual(review.calls, [], 'a review writes nothing');
  assert.deepEqual(readLineSystemCard(review.cards[0]).header, ['แก้ไขค่าใช้จ่าย', 'รอยืนยัน']);
  assert.match(review.sent[0]!, /ยังไม่ได้แก้รายการค่ะ/u);
  const gone = pendingFixture('edit'); gone.flow.draftUpdate.cancel = async () => 'expired';
  assert.equal(await gone.flow.handlePendingWorkControl(gone.event, gone.ctx), true);
  assert.deepEqual(readLineSystemCard(gone.cards[0]).header, ['แก้ไขค่าใช้จ่าย', 'ยังไม่ได้แก้ไข']);
  assert.match(gone.sent[0]!, /ยังไม่ได้แก้ไขรายการ/u);
  assert.doesNotMatch(JSON.stringify(gone.cards[0]), /ยกเลิกแล้ว|แก้ไขแล้ว/u, 'never the header of a state that did not happen');
});

it('a no-save review restates the pending claim with its shop and writes nothing; a cancel drops it by its revision', async () => {
  const review = pendingFixture('claim'); review.event.messageText = 'ขอเช็กยอดกับชื่อร้านก่อน ยังไม่ต้องบันทึก';
  assert.equal(await review.flow.handlePendingWorkControl(review.event, review.ctx), true);
  assert.deepEqual(review.calls, []);
  assert.match(review.sent[0]!, /ร้านเครื่องเขียนสมใจ \(NAT-STN-001\)/u); assert.match(review.sent[0]!, /245\.00 บาท/u);
  assert.match(review.sent[0]!, /ยังไม่ได้บันทึกใบเบิก/u);
  const cancel = pendingFixture('claim');
  assert.equal(await cancel.flow.handlePendingWorkControl(cancel.event, cancel.ctx), true);
  assert.deepEqual(cancel.calls, ['claim-cancel:action:2', 'finish:action:false']);
  assert.match(cancel.sent[0]!, /ยกเลิกร่างใบเบิกนี้แล้ว/u);
  // A claim draft is not an expense edit: it keeps its sentence, with no edit card over it.
  assert.deepEqual([review.cards[0], cancel.cards[0]], [undefined, undefined]);
});

it('a typed cancel closes the one open text-note draft conversation and says the draft stays recorded (NAT-12)', async () => {
  const f = pendingFixture('edit'); f.flow.draftUpdate.pendingPreview = async () => null;
  const executed: any[] = [];
  f.flow.expenseDraftConversation = {
    routeContexts: async () => [{ expenseId: 'expense-9', label: 'ค่าส่งของ', status: 'OPEN', questions: [] }],
    execute: async (_ctx: any, input: any) => { executed.push(input); return { handled: true, status: 'CANCELLED', expenseId: 'expense-9',
      replyTexts: ['🧾 เก็บร่างค่าใช้จ่ายแล้วค่ะ\n\nยกเลิกการสนทนาร่างนี้แล้ว หลักฐานและร่างเดิมไม่ได้ถูกลบ'], acceptedFields: [] }; },
  };
  assert.equal(await f.flow.handlePendingWorkControl(f.event, f.ctx), true);
  assert.equal(executed[0].messageText, 'ยกเลิก');
  assert.equal(executed[0].captureHints.targetExpenseId, 'expense-9');
  assert.match(f.sent[0]!, /ยกเลิกการสนทนาร่างนี้แล้ว/u); assert.match(f.sent[0]!, /ร่างนี้ยังบันทึกไว้/u);
  assert.match(f.sent[0]!, /expenses\/expense-9/u);
  assert.deepEqual(f.logs, ['pending_work_cancelled']);
  // A draft that is merely paused is not the pending work the words cancel.
  const paused = pendingFixture('edit'); paused.flow.draftUpdate.pendingPreview = async () => null;
  paused.flow.expenseDraftConversation = { routeContexts: async () => [{ expenseId: 'expense-9', label: 'x', status: 'PAUSED', questions: [] }],
    execute: async () => { throw new Error('must not run'); } };
  assert.equal(await paused.flow.handlePendingWorkControl(paused.event, paused.ctx), false);
});

it('a correction of the one open text-note draft is answered through that draft, never a new record (NAT-12)', async () => {
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  const executed: any[] = [];
  flow.expenseDraftConversation = {
    routeContexts: async () => [{ expenseId: 'expense-9', label: 'ค่าส่งของ', status: 'OPEN', questions: [] }],
    soleItemRef: async () => 'I01',
    execute: async (_ctx: any, input: any) => { executed.push(input); return { handled: true, status: 'UPDATED', expenseId: 'expense-9',
      replyTexts: ['บันทึกแล้ว: ค่าส่งของ ยอดรวม 350 บาท'], acceptedFields: ['I01-PRICE'] }; },
  };
  const event = { webhookEventId: 'evt', lineUserId: 'line-user', messagingChannelId: 'oa', messageText: 'อันเมื่อกี้ไม่ใช่ 300 เป็น 350 นะ' };
  const result = await flow.correctOpenExpenseDraft(event, { companyId: 'company', userId: 'user' },
    { amount: { from: '300', to: '350' } }, event.messageText, [{ id: 'expense-9', label: 'ค่าส่งของ' }]);
  assert.equal(result?.status, 'UPDATED');
  assert.deepEqual(executed[0].captureHints, { targetExpenseId: 'expense-9',
    items: [{ itemRef: 'I01', totalAmount: '350', sourceText: event.messageText }] });
  // Another record named by the router, or a draft this chat did not capture, keeps the correction lane.
  assert.equal(await flow.correctOpenExpenseDraft(event, {}, { targetExpenseId: 'other', amount: { to: '350' } }, event.messageText,
    [{ id: 'expense-9', label: 'x' }, { id: 'other', label: 'y' }]), null);
  assert.equal(await flow.correctOpenExpenseDraft(event, {}, { amount: { to: '350' } }, event.messageText, [{ id: 'other', label: 'y' }]), null);
});

it('with nothing pending, or two pending things, the words stay an ordinary turn', async () => {
  const none = pendingFixture('edit'); none.flow.draftUpdate.pendingPreview = async () => null;
  assert.equal(await none.flow.handlePendingWorkControl(none.event, none.ctx), false);
  const both = pendingFixture('edit'); both.flow.reimbursementDrafts.active = async () => ({ id: 'action' });
  assert.equal(await both.flow.handlePendingWorkControl(both.event, both.ctx), false);
  assert.deepEqual([...none.sent, ...both.sent], []);
});

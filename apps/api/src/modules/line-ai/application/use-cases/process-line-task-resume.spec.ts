import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';

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

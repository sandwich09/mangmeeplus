import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineDeliveryPlan, deliveryHash, initialDeliveryBatchStates, parseDeliveryBatchStates, parseLineDeliveryPlan, splitLineDeliveryText, type DeliveryAuthorizationV2 } from './line-delivery-plan.logic';
const createdAt = '2026-09-27T00:00:00.000Z', expiresAt = '2026-09-27T00:59:00.000Z';
const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: 'event-1', revision: 0 }, destination: { channelId: 'oa-1', channel: 'line', channelKind: 'GROUP', lineTargetId: 'group-1', targetHash: 'target-hash', chatKeyHash: 'chat-hash' }, actorUserId: null, initiatorHash: 'actor-hash', admissionPolicyDigest: 'policy', sourceManifestDigest: 'manifest', approvedPublicSourceIds: [], issuedAt: createdAt, expiresAt };
function plan(texts: string[]) { return buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1', createdAt, expiresAt, readyAt: createdAt, firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: texts.map(text => ({ kind: 'answer', text, sourceProofIds: [], required: true })) }, businessResult: null, authorization, control: null }); }
test('DI07 canonical Thai, suffix negation, 13 items and 5001 units remain exact', () => {
  for (const texts of [['ก'.repeat(1300) + ' อย่าเพิ่งบันทึก'], Array.from({ length: 13 }, (_, i) => `รายการ ${i}`), ['ข'.repeat(5001)]]) {
    const p = plan(texts);
    assert.equal(p.batches.flatMap(b => b.primary.messages).map(m => m.type === 'text' ? m.text : '').join(''), texts.join(''));
    assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
  }
});
test('graphemes and URLs do not split; UTF-16 offsets reconstruct unchanged input', () => {
  const text = ('น้ำ🙂👨‍👩‍👧‍👦'.repeat(600)) + '\nhttps://example.com/' + 'a'.repeat(4000);
  const parts = splitLineDeliveryText(text);
  assert.equal(parts.map(p => p.text).join(''), text);
  assert.ok(parts.every(p => p.text.length <= 4800));
  assert.equal(parts.filter(p => p.text.includes('https://')).length, 1);
  assert.throws(() => splitLineDeliveryText('https://example.com/' + 'x'.repeat(5000)), /INDIVISIBLE/);
});
test('two batches are automatic; third exposes a bound continuation without losing text', () => {
  assert.equal(plan(Array.from({ length: 10 }, () => 'x')).batches.length, 2);
  const p = plan(Array.from({ length: 11 }, () => 'x'));
  assert.equal(p.batches.length, 3);
  const action = p.batches[1]!.primary.messages[4]!.quickReply!.items[0]!.action;
  assert.equal(action.type, 'postback');
  if (action.type === 'postback') assert.equal(action.data, `action=line_answer_continue&plan=${p.planId}&next=2`);
  assert.throws(() => plan(['x'.repeat(60001)]), /PLAN_TOO_LARGE/);
});
test('mutated wire, missing suffix, partial without limitation, and public private mixing fail closed', () => {
  const p = plan(['hello']);
  const changed = structuredClone(p); changed.batches[0]!.primary.messages[0] = { type: 'text', text: 'changed' };
  assert.equal(parseLineDeliveryPlan(changed), null);
  const lost = structuredClone(p); lost.batches[0]!.spans[0]!.end = 4;
  assert.equal(parseLineDeliveryPlan(lost), null);
  const partial = structuredClone(p); partial.answer.status = 'PARTIAL';
  assert.equal(parseLineDeliveryPlan(partial), null);
  const mixed = structuredClone(p); mixed.businessResult = { kind: 'EXPENSE_CAPTURE', operationKey: 'write', committedAt: createdAt, recordIds: ['private'], resultingRevisions: ['1'] };
  assert.equal(parseLineDeliveryPlan(mixed), null);
  assert.equal(deliveryHash(p), deliveryHash(JSON.parse(JSON.stringify(p))));
});
test('checkpoints accept only a monotonic prefix and exact frozen identity', () => {
  const p = plan(Array.from({ length: 6 }, () => 'x')), states = initialDeliveryBatchStates(p);
  assert.ok(parseDeliveryBatchStates(states, p));
  states[1]!.status = 'ACCEPTED'; states[1]!.acceptedAt = createdAt;
  assert.equal(parseDeliveryBatchStates(states, p), null);
  states[0]!.status = 'ACCEPTED'; states[0]!.acceptedAt = createdAt;
  assert.ok(parseDeliveryBatchStates(states, p));
});

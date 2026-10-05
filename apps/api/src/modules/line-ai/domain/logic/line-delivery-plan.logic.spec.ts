import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLineExternalBrowserLinks, withLineExternalBrowserText } from '@watchdog-bms/contracts';
import { buildLineDeliveryPlan, deliveryHash, initialDeliveryBatchStates, lineDeliveryRetryKey, parseDeliveryBatchStates, parseLineDeliveryPlan, splitLineDeliveryText, type DeliveryAuthorizationV2 } from './line-delivery-plan.logic';
import { asCompleteLineCard, buildLineBusinessAnswerMessage, inheritCompleteLineBusinessAnswerPresentation } from './line-business-card.logic';
import { buildPendingApprovalCard } from './line-staff-menu.logic';
const createdAt = '2026-09-27T00:00:00.000Z', expiresAt = '2026-09-27T00:59:00.000Z';
const authorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PUBLIC_GENERAL', admissionOwner: { kind: 'WEBHOOK', id: 'event-1', revision: 0 }, destination: { channelId: 'oa-1', channel: 'line', channelKind: 'GROUP', lineTargetId: 'group-1', targetHash: 'target-hash', chatKeyHash: 'chat-hash' }, actorUserId: null, initiatorHash: 'actor-hash', admissionPolicyDigest: 'policy', sourceManifestDigest: 'manifest', approvedPublicSourceIds: [], issuedAt: createdAt, expiresAt };
const privateAuthorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PRIVATE', issuedAt: createdAt, expiresAt,
  actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint', channelId: 'oa-1', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 1 }, proofs: [] };
function plan(texts: string[], preferredMessages?: Parameters<typeof buildLineDeliveryPlan>[0]['preferredMessages']) { return buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1', createdAt, expiresAt, readyAt: createdAt, firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: texts.map(text => ({ kind: 'answer', text, sourceProofIds: [], required: true })) }, businessResult: null, authorization, control: null, ...(preferredMessages ? { preferredMessages } : {}) }); }
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
test('freezes a bounded trusted Flex and exact same-slot text fallback', () => {
  const rendered = buildLineBusinessAnswerMessage({ requestId: 'request', replyText: 'ค่าใช้จ่ายเดือนนี้ 500 บาท', sourceRefs: [],
    sourceLabels: ['ค่าใช้จ่าย'], webLinks: [{ label: 'เปิดค่าใช้จ่าย', path: '/companies/company/expenses' }], intent: 'read_summary',
    agent: 'accounting', refused: false, toolsInvoked: ['expense.list_recent'], durationMs: 1, presentation: { kind: 'answer_cards',
      cards: [{ title: 'ค่าใช้จ่ายเดือนนี้', text: 'ค่าใช้จ่ายเดือนนี้ 500 บาท', sourceLabels: ['ค่าใช้จ่าย'],
        webLink: { label: 'เปิดค่าใช้จ่าย', path: '/companies/company/expenses' } }] } },
  'ค่าใช้จ่ายเดือนนี้ 500 บาท', 'https://app.example.com', 'company');
  if (rendered.type !== 'flex' || !rendered.canonicalText) throw new Error('expected complete Flex');
  const preferred = inheritCompleteLineBusinessAnswerPresentation(rendered, { ...rendered,
    quickReply: { items: [{ type: 'action' as const, action: { type: 'message' as const, label: 'ถามข้อมูล', text: 'ถามข้อมูล' } }] } });
  const text = rendered.canonicalText;
  const p = plan([text], [preferred]), batch = p.batches[0]!;
  assert.equal(batch.primary.messages[0]!.type, 'flex');
  assert.equal((batch.primary.messages[0] as any).canonicalText, undefined);
  // R-B1 exit 4: the card's web link is escaped in the frozen bytes; the proof read the original object.
  assert.deepEqual((batch.primary.messages[0] as any).contents, (withLineExternalBrowserLinks([preferred])[0] as any).contents);
  assert.match(JSON.stringify((batch.primary.messages[0] as any).contents), /companies\/company\/expenses\?openExternalBrowser=1/);
  assert.deepEqual(batch.fallback?.messages, [{ type: 'text', text: withLineExternalBrowserText(text, Number.POSITIVE_INFINITY), quickReply: preferred.quickReply }]);
  assert.notEqual(batch.primary.wireHash, batch.fallback?.wireHash);
  assert.notEqual(batch.primary.pushRetryKey, batch.fallback?.pushRetryKey);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
});
test('R-B1 exit 4: web links in item text are escaped once before the wire hash, idempotently and deterministically', () => {
  const link = 'https://app.example.com/companies/company/expenses';
  const p = plan([`ดูรายการ ${link}`]), primary = p.batches[0]!.primary.messages[0] as { type: 'text'; text: string };
  assert.equal(p.answer.items[0]!.text, `ดูรายการ ${link}?openExternalBrowser=1`);
  assert.equal(primary.text, `ดูรายการ ${link}?openExternalBrowser=1`);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
  assert.equal(deliveryHash(plan([`ดูรายการ ${link}`])), deliveryHash(p));
  const already = plan([`ดูรายการ ${link}?openExternalBrowser=1`]);
  assert.equal(already.answer.items[0]!.text, `ดูรายการ ${link}?openExternalBrowser=1`);
  assert.deepEqual(already.batches, p.batches);
  const kept = 'เปิด https://liff.line.me/1-a/start หรือ https://official.mangmeeplus.com/';
  assert.equal(plan([kept]).answer.items[0]!.text, kept);
});
test('R-B1 exit 4: a plan frozen before the escape existed still parses and keeps its bytes', () => {
  const link = 'https://app.example.com/companies/company/expenses';
  const old = structuredClone(plan([`ดูรายการ ${link}`]));
  const plainText = `ดูรายการ ${link}`;
  old.answer.items[0]!.text = plainText;
  const batch = old.batches[0]!;
  batch.primary.messages = [{ type: 'text', text: plainText }];
  batch.spans[0]!.end = plainText.length;
  batch.primary.wireHash = deliveryHash(['oa-1', 'target-hash', batch.primary.messages]);
  batch.primary.pushRetryKey = lineDeliveryRetryKey(old.planId, 0, 'primary', batch.primary.wireHash);
  const stored = JSON.parse(JSON.stringify(old));
  const parsed = parseLineDeliveryPlan(stored);
  assert.ok(parsed);
  assert.deepEqual(parsed, old);
  assert.doesNotMatch(JSON.stringify(parsed), /openExternalBrowser/);
});
test('R-B1 exit 4: the 60,000 item bound wins over the escape', () => {
  const text = 'x'.repeat(59_965) + ' https://app.example.com/a';
  const p = plan([text]);
  assert.equal(p.answer.items[0]!.text, text);
  assert.doesNotMatch(JSON.stringify(p.batches), /openExternalBrowser/);
});
test('unproved generic Flex with a truncated visible body uses the lossless text primary', () => {
  const text = 'ก'.repeat(2_000), preferred = { type: 'flex' as const, altText: 'คำตอบ', canonicalText: text,
    contents: { type: 'bubble', body: { type: 'text', text: text.slice(0, 1_200), wrap: true } } };
  const p = plan([text], [preferred]);
  assert.deepEqual(p.batches[0]!.primary.messages, [{ type: 'text', text }]);
  assert.equal(p.batches[0]!.fallback, null);
});
test('edited trusted Flex loses its proof and cannot hide canonical text', () => {
  const text = 'คำตอบครบถ้วน', rendered = buildLineBusinessAnswerMessage({ requestId: 'request', replyText: text, sourceRefs: [], sourceLabels: [],
    webLinks: [], intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['expense.list_recent'], durationMs: 1,
    presentation: { kind: 'answer_cards', cards: [{ text }] } }, text, undefined, 'company');
  if (rendered.type !== 'flex') throw new Error('expected complete Flex');
  const edited = inheritCompleteLineBusinessAnswerPresentation(rendered, { ...rendered,
    contents: { type: 'bubble', body: { type: 'text', text: 'ตัดคำตอบทิ้ง' } } });
  const p = plan([rendered.canonicalText!], [edited]);
  assert.deepEqual(p.batches[0]!.primary.messages, [{ type: 'text', text: rendered.canonicalText }]);
  assert.equal(p.batches[0]!.fallback, null);
});
test('a badge-only expense qualifier survives in the exact Flex rejection fallback', () => {
  const reply = 'รายการเจ้าหนี้ 500 บาท', rendered = buildLineBusinessAnswerMessage({ requestId: 'request', replyText: reply, sourceRefs: [],
    sourceLabels: [], webLinks: [], intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['expense.list_recent'], durationMs: 1,
    presentation: { kind: 'answer_cards', cards: [{ badge: 'ยังไม่จ่าย', text: reply }] } }, reply, undefined, 'company');
  if (rendered.type !== 'flex' || !rendered.canonicalText) throw new Error('expected complete Flex');
  const p = plan([rendered.canonicalText], [rendered]);
  assert.equal(p.batches[0]!.primary.messages[0]!.type, 'flex');
  assert.equal(p.batches[0]!.fallback!.messages[0]!.type, 'text');
  assert.match((p.batches[0]!.fallback!.messages[0] as { type: 'text'; text: string }).text, /ยังไม่จ่าย/);
});
test('uses lossless text primary when Flex fallback needs more than one slot', () => {
  const text = 'ก'.repeat(4_801), preferred = { type: 'flex' as const, altText: 'คำตอบยาว', canonicalText: text, contents: { type: 'bubble' } };
  const p = plan([text], [preferred]);
  assert.equal(p.batches[0]!.fallback, null);
  assert.ok(p.batches.flatMap(batch => batch.primary.messages).every(message => message.type === 'text'));
  assert.equal(p.batches.flatMap(batch => batch.primary.messages).map(message => message.type === 'text' ? message.text : '').join(''), text);
});
test('old text-only plans round-trip without a fallback or version change', () => {
  const p = plan(['คำตอบเดิม']);
  assert.equal(p.v, 2); assert.equal(p.batches[0]!.fallback, null);
  assert.deepEqual(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))), p);
});
test('UAT 2026-10-05: the pending-approval card is sent as a card and keeps its own text as the fallback', () => {
  const context = { displayName: 'ผู้อนุมัติ', roleLabel: 'เจ้าของกิจการ', branchScopeLabel: 'ทุกสาขา', permissions: ['reimbursement.approve'], entitledFeatureKeys: null, webBaseUrl: 'https://app.example.test', companyId: 'co-1', isOwner: true };
  for (const pending of [{ reimbursement: { total: 0, items: [] } }, { reimbursement: { total: 2, items: ['RB-202610-00001 · 650.00 บาท', 'RB-202610-00002 · 120.00 บาท'] } }]) {
    // What the owner received: without the proof a plan sends the card's text, raw link and all.
    const bare = buildPendingApprovalCard(context, pending);
    assert.equal(bare.type, 'flex');
    assert.equal(plan([(bare as { canonicalText: string }).canonicalText], [bare]).batches[0]!.primary.messages[0]!.type, 'text');
    const card = asCompleteLineCard(buildPendingApprovalCard(context, pending));
    const sent = plan([(card as { canonicalText: string }).canonicalText], [card]).batches[0]!;
    assert.equal(sent.primary.messages[0]!.type, 'flex');
    assert.deepEqual(sent.fallback!.messages.map(message => message.type), ['text']);
    assert.match((sent.fallback!.messages[0] as { text: string }).text, /คำขอเบิกเงิน: https:\/\/app\.example\.test\/companies\/co-1\/reimbursements\?tab=approvals/);
  }
});
test('multi-batch continuation stays before the exact terminal financial control', () => {
  const planId = deliveryHash(['line-delivery-v2', 'WEBHOOK', 'event-1']);
  const items = Array.from({ length: 10 }, (_, i) => ({ kind: 'answer' as const, text: `คำตอบ ${i + 1}`, sourceProofIds: [], required: true }));
  const controlMessage = { type: 'flex' as const, altText: 'ยืนยันการแก้ไข', contents: { type: 'bubble', footer: { type: 'box', contents: [
    { type: 'button', action: { type: 'postback', label: 'ยืนยัน', data: 'action=draft-update-confirm&previewId=preview-1' } },
    { type: 'button', action: { type: 'postback', label: 'ยกเลิก', data: 'action=draft-update-cancel&previewId=preview-1' } },
  ] } } };
  const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1', createdAt, expiresAt, readyAt: createdAt,
    firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', authorization: privateAuthorization, businessResult: null,
    answer: { status: 'COMPLETE', pendingSubrequestIds: [], items },
    control: { kind: 'EXPENSE_EDIT_CONFIRM', previewId: 'preview-1', previewRevision: 'revision', expiresAt, requiredItemIds: items.map((_item, i) => `${planId}:item:${i}`) }, controlMessage });
  assert.equal(p.batches.length, 3);
  assert.match((p.batches[1]!.primary.messages[4]!.quickReply!.items[0]!.action as any).data, /line_answer_continue/);
  assert.equal(p.batches[2]!.primary.messages[0]!.type, 'flex');
  assert.match(((p.batches[2]!.fallback!.messages[0]!.quickReply!.items[0]!.action as any).data), /draft-update-confirm/);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
});

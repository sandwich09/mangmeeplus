import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_STATUS_LABELS, SOURCE_DOCUMENT_TYPE_LABELS, withLineExternalBrowserLinks, withLineExternalBrowserText } from '@watchdog-bms/contracts';
import { validateLineDeliveryPlan, buildLineDeliveryPlan, lineDeliveryPlanId, deliveryHash, initialDeliveryBatchStates, lineDeliveryRetryKey, parseDeliveryBatchStates, parseLineDeliveryPlan, splitLineDeliveryText, type DeliveryAuthorizationV2 } from './line-delivery-plan.logic';
import { buildLineAssistantTextCardMessage, asCompleteLineCard, buildDesignedLineAnswerMessage, buildExpenseDraftReviewCard, buildKeptReceiptCard, buildLineBusinessAnswerMessage, buildLineSystemTextCardMessage, expenseDraftCardFactsFrom, inheritCompleteLineBusinessAnswerPresentation, lineAnswerCardHeader } from './line-business-card.logic';
import { receiptProgress } from './line-receipt-status.logic';
import { buildDraftUpdateOutcomeCard, buildDraftUpdatePreviewCard, draftUpdateCanonicalDiff } from './line-draft-update-card.logic';
import { isLineSystemCard, readLineSystemBubble } from './line-system-card.fixture';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
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
  const kept = 'เปิด https://liff.line.me/1-a/start หรือ https://mangmeeplus.com/';
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
  for (const pending of [{ reimbursement: { total: 0, items: [] } }, { reimbursement: { total: 2, items: [{ title: 'RB-202610-00001', detail: '650.00 บาท' }, { title: 'RB-202610-00002', detail: '120.00 บาท' }] } }]) {
    // What the owner received: without the proof a plan sends the card's text, raw link and all.
    const bare = buildPendingApprovalCard(context, pending);
    assert.equal(bare.type, 'flex');
    assert.equal(plan([(bare as { canonicalText: string }).canonicalText], [bare]).batches[0]!.primary.messages[0]!.type, 'text');
    const card = asCompleteLineCard(buildPendingApprovalCard(context, pending));
    const sent = plan([(card as { canonicalText: string }).canonicalText], [card]).batches[0]!;
    assert.equal(sent.primary.messages[0]!.type, 'flex');
    assert.deepEqual(sent.fallback!.messages.map(message => message.type), ['text']);
    assert.match((sent.fallback!.messages[0] as { text: string }).text, /ดูใบเบิกรออนุมัติในเว็บ: https:\/\/app\.example\.test\/companies\/co-1\/reimbursements\?tab=approvals/);
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

// ── Design lock 2026-10-04: the path a BOUND 1:1 chat really takes. The webhook hands the plan one
//    item per message (the item's text is the message's canonical text) and the message itself as the
//    preferred presentation. For every state of the locked design the plan must freeze THE CARD as the
//    primary wire and the canonical text as the same slot's fallback — never the text first. ──
const WEB = 'https://app.example.com';
/** What the webhook's v2 send does with a message list: `sendMessagesV2` in process-line-webhook.use-case.ts. */
function boundPlan(messages: LineReplyMessage[]) {
  return plan(messages.map(message => message.type === 'flex' ? message.canonicalText! : message.type === 'text' ? message.text : ''), messages);
}
function assertCardIsPrimary(message: LineReplyMessage | undefined, header: [string, string], name: string) {
  assert.ok(message && message.type === 'flex' && message.canonicalText, `${name}: a card that carries its canonical text`);
  assert.equal(isLineSystemCard(message), true, `${name}: a card of the locked design`);
  const p = boundPlan([message]), batch = p.batches[0]!;
  assert.equal(p.batches.length, 1, name);
  const wire = batch.primary.messages[0] as any;
  assert.equal(wire.type, 'flex', `${name}: the card is the primary, not its text`);
  assert.equal(wire.canonicalText, undefined, `${name}: the internal text never reaches LINE`);
  assert.deepEqual(readLineSystemBubble(wire.contents).header, header, name);
  // The same slot's fallback is the whole canonical text: what LINE gets if it refuses the card's body.
  assert.deepEqual(batch.fallback?.messages.map(m => m.type === 'text' ? m.text : null), [withLineExternalBrowserText(message.canonicalText, Number.POSITIVE_INFINITY)], name);
  assert.deepEqual(batch.spans, [{ itemId: p.answer.items[0]!.id, start: 0, end: p.answer.items[0]!.text.length, messageIndex: 0 }], `${name}: the card covers the whole item`);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))), `${name}: the plan survives storage and replay`);
  return wire;
}
const gatewayAnswer = (replyText: string, layout: Record<string, unknown> | undefined, link: { label: string; path: string } | undefined, question: string, source = 'แหล่งข้อมูล') =>
  buildLineBusinessAnswerMessage({ requestId: 'request', replyText, sourceRefs: [], sourceLabels: [source], webLinks: link ? [link] : [], intent: 'read_summary',
    agent: 'accounting', refused: false, toolsInvoked: ['tool'], durationMs: 1,
    presentation: { kind: 'answer_cards', cards: [{ text: replyText, ...(layout ? { layout: layout as any } : {}), sourceLabels: [source], ...(link ? { webLink: link } : {}) }] } },
  replyText, WEB, 'company', question);

test('bound path, context 1: the expense summary rows card is the plan primary, its sentence the fallback', () => {
  const sentence = 'ค่าใช้จ่าย: 85.00 บาท (7 รายการ)\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 1 รายการ\nช่วง: 1 สิงหาคม 2569 – 31 สิงหาคม 2569\nข้อมูล ณ 17 กันยายน 2569';
  const wire = assertCardIsPrimary(gatewayAnswer(sentence, { context: 'expense_summary', header: ['สรุปค่าใช้จ่าย', 'สิงหาคม 2569'],
    rows: [{ label: 'ยอดรวม', value: '85.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '7 รายการ' }], notes: ['ไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 1 รายการ'], linkLabel: 'ดูค่าใช้จ่ายในเว็บ' },
  { label: 'รายการค่าใช้จ่าย', path: '/companies/company/expenses' }, 'ดูค่าใช้จ่ายเดือนนี้', 'รายการค่าใช้จ่าย'), ['สรุปค่าใช้จ่าย', 'สิงหาคม 2569'], 'summary');
  // R-B1: the button's link is escaped out of LINE's in-app browser in the frozen bytes; pictures are not links and are untouched.
  assert.deepEqual(readLineSystemBubble(wire.contents).actions.map(action => action.uri), [`${WEB}/companies/company/expenses?openExternalBrowser=1`]);
  assert.doesNotMatch(JSON.stringify(wire.contents), /\.png\?openExternalBrowser/u);
});

test('bound path, context 2: the three open-work states are the plan primary; the claim button opens that claim', () => {
  const asOf = { label: 'ข้อมูล ณ', value: '17 กันยายน 2569' };
  const claim = assertCardIsPrimary(gatewayAnswer('มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ', { context: 'open_work', header: ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ'],
    rows: [{ label: 'เลขที่ใบเบิก', value: 'RB-202608-00002' }, { label: 'ต้องทำ', value: 'ตรวจสอบและอนุมัติใบเบิก' }, asOf], notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'เปิดใบเบิกเพื่ออนุมัติ' },
  { label: 'อนุมัติเบิกจ่าย: RB-202608-00002', path: '/companies/company/reimbursements/rb-1' }, 'มีงานค้างไหม', 'อนุมัติเบิกจ่าย: RB-202608-00002'), ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ'], 'claim found');
  assert.deepEqual(readLineSystemBubble(claim.contents).actions.map(action => [action.label, action.uri]),
    [['เปิดใบเบิกเพื่ออนุมัติ', `${WEB}/companies/company/reimbursements/rb-1?openExternalBrowser=1`]]);
  assertCardIsPrimary(gatewayAnswer('ตอนนี้ไม่มีแจ้งเตือนที่ยังเปิดอยู่ค่ะ', { context: 'open_work', header: ['การแจ้งเตือน', 'ไม่พบรายการ'], rows: [asOf],
    notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'ดูแจ้งเตือนในเว็บ' }, { label: 'รายการแจ้งเตือน', path: '/companies/company/notifications' }, 'มีแจ้งเตือนไหม', 'รายการแจ้งเตือน'),
  ['การแจ้งเตือน', 'ไม่พบรายการ'], 'no open alerts');
  assertCardIsPrimary(gatewayAnswer('ตอนนี้ไม่มีงานที่มอบหมายให้คุณค้างอยู่ค่ะ', { context: 'open_work', header: ['งานที่มอบหมาย', 'ไม่พบงานค้าง'], rows: [asOf],
    notes: ['ตรวจเฉพาะงานที่มอบหมายให้คุณและยังไม่เสร็จ'], linkLabel: 'ดูงานของฉันในเว็บ' }, { label: 'งานที่ได้รับมอบหมาย', path: '/companies/company/workflow' }, 'มีงานค้างไหม', 'งานที่ได้รับมอบหมาย'),
  ['งานที่มอบหมาย', 'ไม่พบงานค้าง'], 'no assigned tasks');
});

// Owner 2026-10-05 ("มีงานค้างอะไรบ้าง" on real LINE): an answer of several reads and several pages. With the
// gateway's rows it is one row card; without them one prose card. Either way the plan's primary is a card
// of the locked design with every page a named button, and the numbered sentences are the fallback.
test('bound path, an answer of several reads: one card is the plan primary, each page a named button', () => {
  const pages = [{ label: 'ใบรับรองแทนใบเสร็จ', path: '/companies/company/expenses/substitute-receipts' },
    { label: 'รายการเบิกจ่ายรออนุมัติ', path: '/companies/company/reimbursements' }, { label: 'สรุปปิดร้าน 5 ต.ค. 2569', path: '/companies/company/expenses' }];
  const replyText = '1. ใบรับรองแทนใบเสร็จ: ไม่มีค้างค่ะ\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ\n\n2. เบิกจ่ายรออนุมัติ: ไม่มีค้างค่ะ\n\n3. รอตรวจสอบ 21 รายการ';
  const layout = { context: 'open_work', header: ['งานค้าง', 'ณ 5 ต.ค. 2569'], rows: [{ label: 'รอตรวจสอบ', value: '21 รายการ' }, { label: 'ใบรับรองแทนใบเสร็จ', value: 'ไม่มีค้าง' }, { label: 'เบิกจ่ายรอคุณอนุมัติ', value: 'ไม่มีค้าง' }],
    notes: ['ตรวจเฉพาะงานที่รอคุณและรายการที่คุณมีสิทธิ์ดู'] };
  const answer = (rows: boolean) => buildLineBusinessAnswerMessage({ requestId: 'request', replyText, sourceRefs: [], sourceLabels: pages.map(page => page.label), webLinks: pages,
    intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: ['tool'], durationMs: 1,
    ...(rows ? { presentation: { kind: 'answer_cards' as const, cards: [{ text: replyText, layout: layout as any, sourceLabels: pages.map(page => page.label), webLink: pages[0]! }] } } : {}) },
  replyText, WEB, 'company', 'มีงานค้างอะไรบ้าง');
  for (const [rows, header] of [[true, ['งานค้าง', 'ณ 5 ต.ค. 2569']], [false, ['มีงานค้าง', 'อะไรบ้าง']]] as const) {
    const wire = assertCardIsPrimary(answer(rows), [...header] as [string, string], rows ? 'backlog rows' : 'backlog prose');
    const card = readLineSystemBubble(wire.contents);
    assert.deepEqual(card.actions.map(action => [action.label, action.uri]), pages.map(page => [page.label, `${WEB}${page.path}?openExternalBrowser=1`]));
    assert.equal(card.rows.length, rows ? 3 : 0);
    assert.doesNotMatch(card.texts.join('\n'), /ขอบเขต|แหล่งข้อมูล|เปิดดู|เปิดลิงก์/u);
  }
});

// Owner 2026-10-05 ("การ์ดหลุดด้วย"): a short reply of the system itself — an apology, a question, a notice —
// is sent in a bound chat as the card the webhook builds for it. The plan keeps it as the primary, its
// sentence as the fallback, and a quick reply rides both.
test('bound path, a short system reply: its card is the plan primary, its sentence the fallback, a quick reply rides both', () => {
  const sentence = 'ขอโทษค่ะ น้องมั่งมียังไม่แน่ใจว่าหมายถึงอะไร ช่วยพิมพ์อีกแบบได้ไหมคะ เช่น "เดือนนี้จ่ายไปเท่าไหร่" หรือ "แยกค่าใช้จ่ายตามหมวด"';
  const card = buildLineSystemTextCardMessage({ text: sentence, header: lineAnswerCardHeader('สิงหา ถึง ตค')!, webBaseUrl: WEB, companyId: 'company', textStyle: 'answer', icon: 'file' });
  const wire = assertCardIsPrimary(card, ['สิงหา', 'ถึง ตค'], 'apology');
  assert.deepEqual(readLineSystemBubble(wire.contents).prose, [sentence]);
  const quickReply = { items: [{ type: 'action' as const, action: { type: 'message' as const, label: 'ใช่', text: 'ใช่' } }] };
  const withChoices = inheritCompleteLineBusinessAnswerPresentation(card!, { ...card!, quickReply });
  const batch = boundPlan([withChoices]).batches[0]!;
  assert.equal(batch.primary.messages[0]!.type, 'flex');
  assert.deepEqual([batch.primary.messages[0]!.quickReply, batch.fallback?.messages[0]?.quickReply], [quickReply, quickReply]);
});

// Owner 2026-10-05: "this picture is a bill already kept" was still on the green card. In a bound chat the
// plan sends the row card itself; the reply as it always was is the same slot's fallback.
test('bound path, a photo that is a bill already kept: the row card is the plan primary, the reply its fallback', () => {
  const reply = ['📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ', 'ผู้ขาย – Starbucks Coffee', 'ยอดรวม – 170.00 บาท', 'สถานะ – บันทึกแบบร่างแล้ว รอคุณตรวจสอบและยืนยัน',
    `เปิดใบเสร็จเดิม: ${WEB}/companies/company/expenses/e1`].join('\n');
  const card = buildKeptReceiptCard(reply, { expenseId: 'e1', vendor: 'Starbucks Coffee', total: '170.00 บาท', progress: receiptProgress('NEEDS_REVIEW') }, WEB, 'company');
  const wire = assertCardIsPrimary(card, ['เอกสารที่ส่งมา', 'ตรงกับบิลที่เก็บไว้แล้ว'], 'kept receipt');
  const drawn = readLineSystemBubble(wire.contents);
  assert.deepEqual(drawn.rows.map(([label, , value]) => `${label}: ${value}`), ['ผู้ขาย: Starbucks Coffee', 'ยอดรวม: 170.00 บาท', 'สถานะ: บันทึกแบบร่างแล้ว']);
  assert.deepEqual(drawn.actions.map(action => [action.label, action.uri]), [['เปิดใบเสร็จเดิม', `${WEB}/companies/company/expenses/e1?openExternalBrowser=1`]]);
});

test('bound path, context 3: capability, small talk and an explained bill are each one prose card under the reader\'s question', () => {
  const general = (replyText: string, question: string) => buildDesignedLineAnswerMessage({ requestId: 'request', replyText, sourceRefs: [], sourceLabels: [], webLinks: [],
    intent: 'casual_conversation', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1 }, replyText, WEB, 'company', question);
  assertCardIsPrimary(general('น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์ของคุณได้ค่ะ เช่น\n• ค่าใช้จ่ายและใบเสร็จ\n• งานค้างและการแจ้งเตือน', 'ทำอะไรได้บ้าง'), ['ทำอะไร', 'ได้บ้าง'], 'capability');
  assertCardIsPrimary(general('เหนื่อยมานิดหน่อยสินะคะ พักหายใจแป๊บหนึ่งก็ได้นะคะ 😊', 'วันนี้เหนื่อยจัง'), ['วันนี้', 'เหนื่อยจัง'], 'small talk');
  const explain = 'บิล «BHC» 03/09/2569 เลขที่ A0042 ยอด 1,789.04 บาทค่ะ\nมาจาก สินค้า 1,520.00 + ค่าบริการ 152.00 = ยอดที่ใช้คิด VAT 1,672.00 แล้วบวก VAT 117.04 เป็น 1,789.04\nสถานะตอนนี้: รอตรวจสอบ';
  assertCardIsPrimary(gatewayAnswer(explain, undefined, { label: 'BHC', path: '/companies/company/expenses/e1' }, 'ทำไม service charge คิดแยกเป็นอีกรายการนึง ทำไมไม่รวมกัน ?', 'BHC'), ['ทำไม', 'service charge…'], 'explain');
});

test('bound path, context 4: the proposal covers its canonical diff once; applied, cancelled and needs-more are primaries', () => {
  const preview = { previewId: 'preview-1', recordType: 'expense' as const, expenseId: 'exp-1', record: { vendorName: 'BHC', expenseDate: '2026-09-03', statusLabel: 'รอตรวจสอบ' },
    tool: 'expense.draft.add_charge' as const, diff: [{ field: 'charge.SERVICE_CHARGE', label: 'ค่าบริการ', kind: 'money' as const, before: null, after: '152.00' }],
    totalsBefore: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '0.00', taxableAmount: '1520', vatAmount: '106.40', grandTotalAmount: '1626.40' },
    totalsAfter: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '152.00', taxableAmount: '1672', vatAmount: '117.04', grandTotalAmount: '1789.04' },
    warnings: [], expiresAt };
  const card = buildDraftUpdatePreviewCard(preview, WEB);
  assert.equal(isLineSystemCard(card), true);
  // The signed control presents the full diff itself; LINE rejection uses the exact text and actions.
  const planId = deliveryHash(['line-delivery-v2', 'WEBHOOK', 'event-1']);
  const items = [{ kind: 'answer' as const, text: draftUpdateCanonicalDiff(preview), sourceProofIds: [], required: true }];
  const build = (previewId: string) => buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1', createdAt, expiresAt, readyAt: createdAt,
    firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', authorization: privateAuthorization, businessResult: null, answer: { status: 'COMPLETE', pendingSubrequestIds: [], items },
    control: { kind: 'EXPENSE_EDIT_CONFIRM', previewId, previewRevision: 'revision', expiresAt, requiredItemIds: [`${planId}:item:0`] }, preferredMessages: [null], controlMessage: card });
  const p = build('preview-1');
  assert.deepEqual(p.batches[0]!.primary.messages.map(m => m.type), ['flex']);
  assert.equal((p.batches[0]!.fallback!.messages[0] as any).text, draftUpdateCanonicalDiff(preview));
  const control = readLineSystemBubble((p.batches[0]!.primary.messages[0] as any).contents);
  assert.deepEqual(control.header, ['แก้ไขค่าใช้จ่าย', 'รอยืนยัน']);
  assert.deepEqual(control.actions.map(action => action.data), ['action=draft-update-confirm&previewId=preview-1', 'action=draft-update-cancel&previewId=preview-1']);
  // If LINE refuses the card, the same two postbacks ride the fallback's quick reply.
  assert.deepEqual(p.batches[0]!.fallback!.messages[0]!.quickReply!.items.map(item => (item.action as any).data), ['action=draft-update-confirm&previewId=preview-1', 'action=draft-update-cancel&previewId=preview-1']);
  assert.throws(() => build('another-preview'), /PLAN_INVALID_CONTROL/);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
  // What became of the edit.
  assertCardIsPrimary(buildDraftUpdateOutcomeCard('applied', `✅ แก้ให้แล้วค่ะ: ค่าบริการ 152.00 · ยอดรวม 1,789.04\nเปิดดูรายการ: ${WEB}/companies/company/expenses/exp-1`, WEB, 'company'), ['แก้ไขค่าใช้จ่าย', 'แก้ไขแล้ว'], 'applied');
  assertCardIsPrimary(buildDraftUpdateOutcomeCard('cancelled', 'ยกเลิกแล้วค่ะ ยังไม่ได้แก้อะไรในรายการนะคะ', WEB, 'company'), ['แก้ไขค่าใช้จ่าย', 'ยกเลิกแล้ว'], 'cancelled');
  assertCardIsPrimary(buildDraftUpdateOutcomeCard('needs_input', 'บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ (เช่น "บรรทัด 2 เป็น 500")', WEB, 'company'), ['แก้ไขค่าใช้จ่าย', 'ขอข้อมูลเพิ่ม'], 'needs more information');
});

test('bound path, contexts 5 and 7: the record states and the payment states are the plan primary', () => {
  const link = { label: 'EXP-2026-0009', path: '/companies/company/expenses/e1' };
  for (const [title, pill, tone] of [['ยืนยันแล้ว', 'ยืนยันแล้ว', 'ok'], ['ถูกปฏิเสธ', 'ปฏิเสธ', 'closed'], ['ยกเลิกแล้ว', 'ยกเลิก', 'closed']] as const) {
    assertCardIsPrimary(gatewayAnswer(`ค่าใช้จ่าย: ร้านตัวอย่างอุปกรณ์ วันที่ 4 ตุลาคม 2569 ยอด 2,140.00 บาท\nสถานะเอกสาร: ${pill}`, { context: 'expense_record', header: ['รายการค่าใช้จ่าย', title],
      rows: [{ label: 'เลขรายการ', value: 'EXP-2026-0009' }, { label: 'ยอดรวม', value: '2,140.00 บาท', emphasis: 'total' }, { label: 'สถานะเอกสาร', value: pill, tone }], linkLabel: 'เปิดดูรายการในเว็บ' },
    link, 'รายการที่ 2 สถานะอะไร', 'EXP-2026-0009'), ['รายการค่าใช้จ่าย', title], `record ${title}`);
  }
  for (const [title, status, tone] of [['ชำระแล้ว', 'ชำระแล้ว', 'ok'], ['รอชำระเงิน', 'ยังไม่ชำระ', 'pending'], ['ชำระบางส่วน', 'ชำระบางส่วน', 'pending']] as const) {
    const wire = assertCardIsPrimary(gatewayAnswer(`การชำระเงิน: บริษัท ตัวอย่างอาหาร จำกัด ยอดสุทธิที่ต้องจ่าย 1,284.00 บาท\nสถานะชำระเงิน: ${status}`, { context: 'payment', header: ['การชำระเงิน', title],
      banner: { tone, text: `${status} · ยอดคงค้าง 0.00 บาท` }, rows: [{ label: 'ยอดสุทธิที่ต้องจ่าย', value: '1,284.00 บาท', emphasis: 'total' }, { label: 'สถานะชำระเงิน', value: status, tone }], linkLabel: 'เปิดดูรายการในเว็บ' },
    link, 'รายการนี้จ่ายหรือยัง', 'EXP-2026-0009'), ['การชำระเงิน', title], `payment ${status}`);
    assert.equal(readLineSystemBubble(wire.contents).banner, `${status} · ยอดคงค้าง 0.00 บาท`);
  }
});

test('bound path, context 6: the receipt review card is the plan primary and its reply the fallback, with the completion menu on both', () => {
  const reply = `🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)\n\n• ยอดรวม – 1,284.00\n\n✅ ตรวจสอบและยืนยันในเว็บแอป:\n${WEB}/companies/company/expenses/exp-1`;
  const facts = expenseDraftCardFactsFrom({ expenseId: 'exp-1', subject: 'ข้อมูลใบเสร็จ', vendor: 'บริษัท ตัวอย่างอาหาร จำกัด', date: '2 กันยายน 2569',
    documentType: 'ใบเสร็จรับเงิน', category: 'ค่าอาหารและเครื่องดื่ม', total: '1,284.00 บาท', vat: '84.00 บาท', status: 'รอตรวจสอบ' });
  const card = buildExpenseDraftReviewCard(reply, facts, WEB, 'company')!;
  assertCardIsPrimary(card, ['ข้อมูลใบเสร็จ', 'รอตรวจสอบ'], 'receipt review');
  // The webhook adds the completion menu by cloning the card; the proof must survive exactly that clone.
  const menu = { items: [{ type: 'action' as const, action: { type: 'message' as const, label: '📷 ถ่ายใบเสร็จ', text: 'ถ่ายใบเสร็จ' } }] };
  const withMenu = inheritCompleteLineBusinessAnswerPresentation(card, { ...card, quickReply: menu });
  const batch = boundPlan([withMenu]).batches[0]!;
  assert.equal(batch.primary.messages[0]!.type, 'flex');
  assert.deepEqual([batch.primary.messages[0]!.quickReply, batch.fallback!.messages[0]!.quickReply], [menu, menu]);
  // A copy that changed the card after it was built has no proof: the plan sends its text, never a card nobody vouched for.
  const edited = inheritCompleteLineBusinessAnswerPresentation(card, { ...card, altText: 'อื่น' });
  assert.equal(boundPlan([edited]).batches[0]!.primary.messages[0]!.type, 'text');
});

import { buildCounterpartyCard } from '../../application/line-counterparty.service';
test('Round 7A counterparty control preserves the diff before its signed confirm button', () => {
  const view = { token: '12345678-1234-1234-1234-123456789abc.' + 'a'.repeat(43), expiresAt,
    lines: ['ตรวจข้อมูลแล้วกดยืนยันค่ะ', 'ที่อยู่: ที่อยู่เดิม → ที่อยู่ใหม่'] };
  const message = buildCounterpartyCard(view);
  const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'counterparty-event', createdAt, readyAt: createdAt, expiresAt,
    firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', authorization: privateAuthorization,
    answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'decision_diff', text: view.lines.join('\n'), sourceProofIds: [], required: true }] },
    businessResult: null, control: { kind: 'COUNTERPARTY_CONFIRM', token: view.token, expiresAt, requiredItemIds: [deliveryHash(['line-delivery-v2', 'WEBHOOK', 'counterparty-event']) + ':item:0'] }, controlMessage: message });
  assert.ok(parseLineDeliveryPlan(p)); assert.match(JSON.stringify(p.batches), /counterparty_confirm/u);
  const states = initialDeliveryBatchStates(p); states[0]!.sentMessageIds = ['bot-message'];
  assert.ok(parseDeliveryBatchStates(states, p)); states[0]!.sentMessageIds = ['bad id']; assert.equal(parseDeliveryBatchStates(states, p), null);
});

test('Fix-up 20A: claim choices survive only with their exact revalidated options proof', async () => {
  const { buildReimbursementOptionsMessages } = await import('./line-reimbursement-draft-card.logic');
  const actionId = '550e8400-e29b-41d4-a716-446655440000', revision = 'a'.repeat(64);
  for (const collection of [{ lineChosen: true, receiptChosen: false, categoryChosen: false },
    { lineChosen: true, receiptChosen: true, categoryChosen: false }]) {
    const message = buildReimbursementOptionsMessages({ control: { actionId, revision }, collection,
      choices: [{ choiceId: 'b'.repeat(64), kind: 'CATEGORY', label: 'ค่าเดินทาง' }], pages: {} })[0]!;
    assert.equal(message.type, 'text'); if (message.type !== 'text') throw new Error('expected question');
    for (const [name, proof] of [['current', { actionId, controlRevision: revision }], ['missing', null],
      ['other-action', { actionId: 'other', controlRevision: revision }], ['old-revision', { actionId, controlRevision: 'c'.repeat(64) }]] as const) {
      const auth = { ...privateAuthorization, proofs: proof ? [{ id: 'options', kind: 'REIMBURSEMENT_OPTIONS', ...proof }] : [] };
      const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'claim-options', createdAt, expiresAt, readyAt: createdAt,
        firstDispatchDeadlineAt: expiresAt, authorization: auth, businessResult: null, control: null,
        answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'limitation', text: message.text, required: true, sourceProofIds: [] }] }, preferredMessages: [message] });
      assert.ok(parseLineDeliveryPlan(p));
      const sent = p.batches[0]!.primary.messages[0]!;
      assert.equal(!!sent.quickReply, name === 'current', name);
      if (name === 'current') {
        assert.deepEqual(sent.quickReply!.items.map(item => (item.action as any).data), message.quickReply!.items.map(item => (item.action as any).data));
        const tampered = structuredClone(p);
        tampered.authorization = { ...privateAuthorization, proofs: [] };
        assert.equal(parseLineDeliveryPlan(tampered), null, 'validator also rejects a frozen choice without its options proof');
      }
    }
  }
});

test('Fix-up 24: lifecycle next buttons survive primary and fallback only with the applied signed-action proof', async () => {
  const { buildExpenseActionCard } = await import('./line-expense-action-card.logic');
  const token = 'voucher-preview.' + 'a'.repeat(43);
  for (const [offerNext, applied] of [['VOUCHER_SUBMIT', true], ['VOUCHER_APPROVE', true], ['VOUCHER_PAY', true], ['VOUCHER_SUBMIT', false]] as const) {
    const message = buildExpenseActionCard({ token, previewId: 'voucher-preview', action: 'VOUCHER_CREATE', offerNext, summary: 'ตรวจใบเตรียมจ่ายค่ะ', expiresAt,
      record: { vendorName: 'Grab', amount: '350', currency: 'THB', date: '2026-09-27', status: 'ร่าง', nextStatus: 'รออนุมัติ' } }, 'สร้างใบเตรียมจ่ายแล้วค่ะ');
    const auth: DeliveryAuthorizationV2 = { ...privateAuthorization, proofs: [{ id: 'action', kind: 'EXPENSE_ACTION_PREVIEW', requestId: 'request', previewHash: 'a'.repeat(64), applied, token }] };
    const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: `next-${offerNext}-${applied}`, createdAt, expiresAt, readyAt: createdAt,
      firstDispatchDeadlineAt: expiresAt, authorization: auth, businessResult: null, control: null,
      answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text: message.type === 'flex' ? message.canonicalText! : '', required: true, sourceProofIds: [] }] }, preferredMessages: [message] });
    assert.ok(parseLineDeliveryPlan(p));
    for (const frozen of [p.batches[0]!.primary, p.batches[0]!.fallback]) if (frozen)
      assert.equal(JSON.stringify(frozen.messages).includes('expense_action_next'), applied);
  }
});

// Language is checked after both the durable plan and the actual LINE wire adapter.
// Names/descriptions remain source data; the fixture uses Latin names so fixed Thai UI copy cannot hide.
test('reply surface × th/en/mixed: primary and fallback delivered payloads follow the current message', async () => {
  const { lineReplyLanguage, lineControlLanguage } = await import('./line-language.logic');
  const cards = await import('./line-business-card.logic');
  const { buildExpenseActionCard } = await import('./line-expense-action-card.logic');
  const { buildReimbursementDraftMessages, buildReimbursementOptionsMessages } = await import('./line-reimbursement-draft-card.logic');
  const { buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, buildReceiptCapturePrompt, buildCapabilityCard, buildContactCard } = await import('./line-staff-menu.logic');
  const { lineWaitStages, lineWaitStageMessage, lineMediaGroupAckStage } = await import('./line-message-buffer.logic');
  const { formatRefusal } = await import('./line-ai-formatter.logic');
  const { linePaymentEvidenceReply } = await import('./line-payment-evidence-reply.logic');
  const { LineReplyAdapter } = await import('../../infrastructure/line-reply.adapter');
  const { lineMessagingCredentialsFixture } = await import('../../../../common/config/line-messaging-credentials.fixture');
  const { buildSubstituteReceiptActionCard } = await import('../../application/line-substitute-receipt-action.service');
  const { buildCounterpartyCard } = await import('../../application/line-counterparty.service');
  const { buildPackagePurchaseCard } = await import('../../application/line-package-purchase.service');
  const { formatCaptureAutoHandoffReply, CAPTURE_READ_FAILED_REPLY, CAPTURE_READ_PARTIAL_REPLY, CAPTURE_READ_PAUSED_REPLY, nonReceiptReply } = await import('./line-non-receipt-reply.logic');
  const { ProcessLineWebhookUseCase, formatPaypersReply, formatNextStepGuidanceReply, formatCorrectionGuidanceReply } = await import('../../application/use-cases/process-line-webhook.use-case');
  const { LINE_CHAT_ACTIONS } = await import('@watchdog-bms/contracts');
  const { productHelpAction } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/approved-product-help');
  const { ReimbursementListPendingApprovalsTool } = await import('../../application/use-cases/erp-reimbursement-tools.use-case');
  const scope = await import('../../../../../../ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic');
  const { formatPreparedSimpleRead } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter');
  const { formatLineExpenseDraftReply } = await import('../../../expenses/domain/logic/line-expense-draft-conversation.logic');
  const originalFetch = globalThis.fetch;
  const delivered: LineReplyMessage[][] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { delivered.push(JSON.parse(String(init?.body)).messages); return new Response('{}', { status: 200 }); }) as typeof fetch;
  const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
  try {
    for (const [form, question] of [['th', 'ช่วยตรวจค่าใช้จ่ายค่ะ'], ['en', 'Could you check my expenses?'], ['mixed', 'ช่วย check expenses ค่ะ']] as const) {
      const language = lineReplyLanguage(question), en = language === 'en', text = en ? 'Please review this expense.' : 'ตรวจรายละเอียดค่าใช้จ่ายได้เลยค่ะ';
      const context = { language, permissions: ['expense.read', 'expense.create', 'expense.receipt.upload'], roles: ['OWNER'], isOwner: true, entitledFeatureKeys: new Set(['expenses', 'expenses.upload']), displayName: 'Jane', roleLabel: 'Owner', branchScopeLabel: 'All branches', companyId: 'company', webBaseUrl: 'https://app.test' };
      const action = { action: 'CONFIRM' as const, token: 'preview.token', previewId: 'preview', expiresAt, summary: en ? 'Review before confirming.' : 'ตรวจข้อมูลก่อนยืนยันค่ะ', record: { vendorName: 'ABC', amount: '120.00', currency: 'THB', date: '2026-09-27', status: 'ร่าง', nextStatus: 'ยืนยันแล้ว' } };
      const draft = { previewId: '550e8400-e29b-41d4-a716-446655440000', recordType: 'expense' as const, expenseId: 'expense', record: { vendorName: 'ABC', expenseDate: '2026-09-27', statusLabel: 'ร่าง' }, tool: 'expense.draft.set_header', diff: [{ field: 'vendorName', label: 'ผู้ขาย', kind: 'text' as const, before: 'ABC', after: 'DEF' }], totalsBefore: { grandTotalAmount: '120' }, totalsAfter: { grandTotalAmount: '120' }, warnings: [], expiresAt } as any;
      const claim = { schemaVersion: 1, actionId: 'claim-action', operation: 'CREATE', previewRevision: 1, confirmationDigest: 'a'.repeat(64), expiresAt, warnings: [], diff: [],
        after: { requesterUserId: 'user', requesterDisplayName: 'Jane', currency: 'THB', reason: 'Travel', amount: '120.0000', incurredDate: '2026-09-27', categoryKey: 'travel', receiptRequirementStatus: 'REQUIRED', status: 'DRAFT', signatureImpact: 'NONE',
          lines: [{ lineRef: 'line', lineNo: 1, incurredDate: '2026-09-27', description: 'Taxi', amount: '120.0000', categoryKey: 'travel', categoryLabel: 'ค่าเดินทาง' }] } } as any;
      const staff = await import('./line-staff-menu.logic');
      const substitute = await import('../../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case');
      const fileStatus = await import('./line-file-attempt-answer.logic');
      const preferences = await import('./line-preference-command.logic');
      const progress = await import('./line-receipt-status.logic');
      const file = { ref: 'file', messageType: 'file' as const, fileNameSanitized: 'bill.pdf', stage: 'READ' as const, reasonCode: 'reading', outcome: 'STORED_READ_FAILED' as const, declaredFileSize: 200, measuredByteSize: 200, capability: {}, createdAt: new Date(createdAt) };
      const candidate = { id: 'expense', label: 'ใบเสร็จรับเงิน · 27 ก.ย. 2569 · 120.00', sourceDocumentType: 'RECEIPT', expenseDate: '2026-09-27', amount: '120.00', createdAt } as const;
      const event = { messageText: question }, flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
      flow.config = { webBaseUrl: context.webBaseUrl };
      flow.boundConversations = new WeakMap([[event, { owner: {}, epoch: 1 }]]);
      flow.reimbursementAdapter = { photoTarget: async () => ({ branchId: 'branch' }) };
      const claimPhoto = await flow.reimbursementDraftMessages({ status: 'applied', receipt: { requestId: 'claim', amount: '120', currency: 'THB', committedState: 'DRAFT' } }, { companyId: 'company', permissions: [] }, event);
      const helpSurfaces: Array<[string, LineReplyMessage[]]> = LINE_CHAT_ACTIONS.map(entry => {
        const help = productHelpAction({ actionId: entry.id, language, permissions: [entry.permission], featureKeys: null, companyId: 'company' })!;
        return [`how-to-${entry.id}`, [cards.buildLineBusinessAnswerMessage({ requestId: 'help', replyText: help.replyText, presentation: help.presentation,
          sourceRefs: [], sourceLabels: [], webLinks: [], toolsInvoked: [], intent: 'unknown', agent: 'general', refused: false, durationMs: 1 }, help.replyText, context.webBaseUrl, 'company', question, language)]];
      });
      const pendingSurfaces: Array<[string, LineReplyMessage[]]> = await Promise.all(['company', 'related', 'own'].map(async accessScope => {
        const tool = new ReimbursementListPendingApprovalsTool({ execute: async () => { throw new Error('reader is not an approver'); } } as any,
          { execute: async () => ({ total: 1, items: [{ requesterDisplayNameSnapshot: 'Jane', amount: '120', currency: 'THB', currentDesk: { kind: 'APPROVER', names: [] } }] }) } as any);
        const read = await tool.execute({ companyId: 'company', userId: 'user', permissions: [accessScope === 'company' ? 'reimbursement.read' : accessScope === 'related' ? 'reimbursement.read_related' : 'reimbursement.read_own'], locale: en ? 'en-GB' : 'th-TH', groundingText: question });
        const result = formatPreparedSimpleRead('reimbursement.list_pending_approvals::list', { agent: 'reimbursement', status: 'SUCCEEDED', summary: '', facts: [], suggestions: [], toolCalls: [], requiresHumanReview: false,
          toolData: [{ tool: 'reimbursement.list_pending_approvals', data: read.data }], asOf: createdAt } as any,
          { language, locale: en ? 'en-GB' : 'th-TH' });
        assert.equal(result.kind, 'answer');
        return [`pending-${accessScope}`, [{ type: 'text', text: result.kind === 'answer' ? result.replyText : '' }]] as [string, LineReplyMessage[]];
      }));
      const draftQuestion = formatLineExpenseDraftReply({ language, categories: [], state: { header: {}, items: [], status: 'OPEN',
        unresolvedQuestions: [{ field: 'expenseDate', prompt: 'จ่ายวันไหน?' }, { field: 'price', prompt: 'ยอดเท่าไร?' }] } as any });
      assert.doesNotMatch(draftQuestion, en ? /unit price|total/ : /ยอดเท่าไร/u, 'only the first missing field is asked');
      const surfaces: Array<[string, LineReplyMessage[], any?]> = [
        ...Object.entries(EXPENSE_STATUS_LABELS).map(([status, label]): [string, LineReplyMessage[]] => [`expense-status-${status}`, [buildExpenseActionCard({ ...action, record: { ...action.record, status: label } }, undefined, language)]]),
        ...Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).map(([type, label]): [string, LineReplyMessage[]] => [`document-type-${type}`, [cards.buildExpenseDraftCardMessage(text, cards.expenseDraftCardFactsFrom({ expenseId: 'expense', subject: 'ร่างค่าใช้จ่าย', documentType: label, status: 'ร่าง' }), context.webBaseUrl, 'company', language)]]),
        ['next-step', [{ type: 'text', text: formatNextStepGuidanceReply(context.webBaseUrl, 'company', candidate, language) }]],
        ['correction-guidance', [{ type: 'text', text: formatCorrectionGuidanceReply(context.webBaseUrl, 'company', [candidate], true, undefined, language) }]],
        ['company-context', [staff.buildCompanyContextMessage({ companyName: 'ABC', displayName: 'Jane', roleLabels: [], isOwner: true, openWebUrl: 'https://app.test/shop' }, language)]],
        ['company-picker', [staff.buildCompanyPickerMessage([{ companyId: 'company', companyName: 'ABC' }], undefined, 1, language)]],
        ['services', [staff.buildServiceEntitlementMessage(new Set(['expenses', 'reimbursement']), language)]],
        ['promotion', [staff.buildPromotionCard('owner', 'https://app.test/packages', language)]],
        ['package-review', [staff.buildPackageReviewCard('ABC', 'https://app.test/packages', language)]],
        ['approval-queue', [staff.buildPendingApprovalCard({ ...context, permissions: ['reimbursement.approve'], entitledFeatureKeys: null }, { reimbursement: { total: 1, items: [{ title: 'Claim', detail: 'Jane · 120.00 THB' }] } })]],
        ['profile-guard', [cards.buildProfileGuardNudgeCard(language)]],
        ['public-policy', [cards.buildPublicPolicyCardMessage({ topic: 'quota', title: 'สิทธิ์อ่าน', text: 'อ่านใบเสร็จค่ะ' }, language)]],
        ['file-attempt', [{ type: 'text', text: fileStatus.fileAttemptAnswer(file, undefined, language) }]],
        ['file-choice', [{ type: 'text', text: fileStatus.fileAttemptChoiceList([file], language) }]],
        ['file-delivery-failed', [{ type: 'text', text: fileStatus.FILE_ATTEMPT_DELIVERY_FAILED_REPLY('https://app.test/result', language) }]],
        ['receipt-progress', [{ type: 'text', text: progress.receiptProgressLabel('DRAFT', null, language) }]],
        ['substitute-scan', [{ type: 'text', text: substitute.substituteScanConfirmQuestion({ documentNumber: 'SUB-001', amountLabel: en ? '120.00 THB' : '120.00 บาท' }, language) }]],
        ['substitute-media', [{ type: 'text', text: substitute.substituteMediaQuestion(['PAYMENT_EVIDENCE', 'NO_RECORD'], language) }]],
        ['assistant', [cards.buildLineAssistantTextCardMessage(text, context.webBaseUrl, 'company', undefined, undefined, language)]],
        ['business', [cards.buildLineBusinessAnswerMessage({ requestId: 'r', replyText: text, sourceRefs: [{ module: 'expenses', entityType: 'expense', label: 'ค่าใช้จ่าย', permissionChecked: true, webPath: '/companies/company/expenses' }], sourceLabels: ['ค่าใช้จ่าย'], webLinks: [{ label: 'รายการค่าใช้จ่าย', path: '/companies/company/expenses' }], toolsInvoked: [], intent: 'unknown', agent: 'general', refused: false, durationMs: 1 }, text, context.webBaseUrl, 'company', question, language)]],
        ['preferences-list', [{ type: 'text', text: preferences.formatLinePreferences({ language: 'en', detail: 'short' }, language) }]],
        ['preferences-set', [{ type: 'text', text: preferences.linePreferenceChangedText({ kind: 'set', values: { language: 'en' } }, {}, language) }]],
        ['permission', [{ type: 'text', text: formatRefusal('forbidden', undefined, language) }]],
        ['timeout', [{ type: 'text', text: formatRefusal('ai_timeout', undefined, language) }]],
        ['ask-back', [cards.buildReimbursementPayerClarificationMessage(language)]],
        ['claim-handoff', [cards.buildReimbursementHandoffMessage(context.webBaseUrl, 'company', language)]],
        ['legal', [cards.buildLegalAcceptanceRequiredMessage(context.webBaseUrl, 'company', language)]],
        ['signup', [cards.buildSignupDoorCard(undefined, context.webBaseUrl, language)]],
        ['signup-status', [cards.buildSignupStatusCard('ABC', true, language)]],
        ['package', [cards.buildPackageRequiredMessage({ companyId: 'company', lockReason: 'no_package', webBaseUrl: context.webBaseUrl, language })]],
        ['budget', [cards.buildAiBudgetExceededMessage(false, { budgetScope: 'CHAT' }, true, language)]],
        ['quota', [cards.buildReceiptQuotaExceededMessage(en ? 'Allowance used.' : 'ใช้โควตาครบแล้วค่ะ', true, language)]],
        ['capture', [cards.buildExpenseDraftCardMessage(formatPaypersReply(context.webBaseUrl, 'company', 'expense', { language, sourceDocumentType: 'RECEIPT', compact: true, fields: { vendorName: 'ABC', grandTotalAmount: '120.00', expenseDate: '2026-09-27' } }), cards.expenseDraftCardFactsFrom({ expenseId: 'expense', subject: 'ร่างค่าใช้จ่าย', vendor: 'ABC', total: '120.00', status: 'ร่าง' }), context.webBaseUrl, 'company', language)]],
        ['expense-confirm', [buildExpenseActionCard(action, undefined, language)], { kind: 'EXPENSE_ACTION_CONFIRM', token: action.token, expiresAt }],
        ['voucher-confirm', [buildExpenseActionCard({ ...action, action: 'VOUCHER_CREATE' }, undefined, language)], { kind: 'EXPENSE_ACTION_CONFIRM', token: action.token, expiresAt }],
        ['edit-confirm', [buildDraftUpdatePreviewCard(draft, context.webBaseUrl, language)], { kind: 'EXPENSE_EDIT_CONFIRM', previewId: draft.previewId, previewRevision: '1', expiresAt }],
        ['claim-confirm', buildReimbursementDraftMessages({ status: 'preview', preview: claim } as any, context.webBaseUrl, 'company', [], undefined, language), { kind: 'REIMBURSEMENT_DRAFT_CONFIRM', actionId: claim.actionId, previewRevision: 1, confirmationDigest: claim.confirmationDigest, expiresAt }],
        ['claim-missing', buildReimbursementDraftMessages({ status: 'needs_fields', fieldPaths: ['reason', 'lines.0.amount'] } as any, context.webBaseUrl, 'company', [], undefined, language)],
        ['expense-first-question', [{ type: 'text', text: draftQuestion }]],
        ['claim-photo-after-save', claimPhoto],
        ['claim-photo-category', buildReimbursementOptionsMessages({ choices: [{ kind: 'CATEGORY', label: 'ค่าเดินทาง', choiceId: 'travel' }], pages: {}, awaitingPhoto: true, collection: { lineChosen: true, receiptChosen: true, categoryChosen: false }, control: { actionId: 'claim-action', revision: '1' } }, context.webBaseUrl, language)],
        ['claim-no-receipt-reason', buildReimbursementOptionsMessages({ choices: [], pages: {}, reasonQuestion: 'ไม่มีใบเสร็จเพราะอะไรคะ', collection: { lineChosen: true, receiptChosen: true, categoryChosen: true } }, context.webBaseUrl, language)],
        ['limit-owner', [{ type: 'text', text: scope.permissionLimitReplyText(language, en ? 'approve claims' : 'อนุมัติใบเบิก', ['expense.read_own']) }]],
        ['limit-package', [{ type: 'text', text: scope.featureLimitReplyText('wht_pnd53', language) }]],
        ['limit-unsold', [{ type: 'text', text: scope.unsoldModuleReplyText({ featureKey: null, topicLabelTh: 'เงินเดือน', topicLabelEn: 'payroll' }, language) }]],
        ...helpSurfaces, ...pendingSurfaces,
        ['claim-options', buildReimbursementOptionsMessages({ choices: [], pages: {}, collection: { lineChosen: true, receiptChosen: false, categoryChosen: false }, control: { actionId: 'claim-action', revision: '1' } }, context.webBaseUrl, language)],
        ['payment-evidence', [linePaymentEvidenceReply({ kind: 'ASK', slipId: 'slip', candidates: [{ id: 'expense', vendorName: 'ABC', amount: '120.00', documentDay: '2026-09-27' }] } as any, 0, language)!]],
        ['counterparty-confirm', [buildCounterpartyCard({ token: action.token, expiresAt, lines: [text] }, language)], { kind: 'COUNTERPARTY_CONFIRM', token: action.token, expiresAt }],
        ['package-confirm', [buildPackagePurchaseCard({ token: action.token, expiresAt, lines: [text] }, language)], { kind: 'PACKAGE_PURCHASE_CONFIRM', token: action.token, expiresAt }],
        ['substitute-web', [buildSubstituteReceiptActionCard({ token: '', expiresAt, label: en ? 'Sign on web' : 'เปิดลงนามในเว็บ', summary: text, webPath: 'https://app.test/companies/company/expenses/substitute-receipts', webOnly: true }, text, false, language)]],
        ['file-success', [{ type: 'text', text: formatCaptureAutoHandoffReply({ language, link: 'https://app.test/companies/company/expenses/expense', amount: '120.00', vendorName: 'ABC', expenseDate: '2026-09-27' }).text }]],
        ['file-failed', [{ type: 'text', text: CAPTURE_READ_FAILED_REPLY('https://app.test/companies/company/expenses/expense', language) }]],
        ['file-partial', [{ type: 'text', text: CAPTURE_READ_PARTIAL_REPLY('https://app.test/companies/company/expenses/expense', language) }]],
        ['file-paused', [{ type: 'text', text: CAPTURE_READ_PAUSED_REPLY('https://app.test/companies/company/expenses/expense', 'credits', language) }]],
        ['non-receipt', [{ type: 'text', text: nonReceiptReply('NR07', { language }) }]],
        ['menu', [buildStaffMainMenu(context)]], ['query-menu', [buildStaffQueryMenu(context)]], ['receipt-prompt', [buildReceiptCapturePrompt(context)]],
        ['capabilities', [buildCapabilityCard(language)]], ['contact', [buildContactCard(language)]],
        ['completion', [{ type: 'text', text, quickReply: buildStaffCompletionQuickReply(context, language) }]],
        ['waiting', lineWaitStages({ kind: 'text', language, messageText: question, seed: 'test', loadingEnabled: false, latestAcceptedAt: 0, now: 0 }).map(stage => lineWaitStageMessage(stage, context.webBaseUrl))],
        ['media-ack', [lineWaitStageMessage(lineMediaGroupAckStage(['image'], language), context.webBaseUrl)]],
      ];
      for (const [surface, messages, controlBase] of surfaces) {
        const id = `${form}-${surface}`;
        const auth = { ...privateAuthorization, proofs: [{ id: 'capture', kind: 'CAPTURE_RESULT', recordIds: ['slip', 'expense'] }, { id: 'options', kind: 'REIMBURSEMENT_OPTIONS', actionId: 'claim-action', controlRevision: '1' }] };
        const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: id, createdAt, expiresAt, readyAt: createdAt, firstDispatchDeadlineAt: expiresAt, authorization: auth, language,
          businessResult: null, control: controlBase ? { ...controlBase, requiredItemIds: messages.map((_m, i) => `${lineDeliveryPlanId('WEBHOOK', id)}:item:${i}`) } : null,
          answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: messages.map(m => ({ kind: 'answer', text: m.type === 'text' ? m.text : m.type === 'flex' ? m.canonicalText ?? m.altText : '', required: true, sourceProofIds: [] })) },
          preferredMessages: messages, ...(controlBase ? { controlMessage: messages.at(-1) } : {}) });
        for (const batch of p.batches) for (const frozen of [batch.primary, batch.fallback]) if (frozen) {
          assert.equal(await adapter.sendReply('test-token', frozen.messages), 'ok', id);
          const payload = delivered.at(-1)!;
          const visible: string[] = [];
          const walk = (value: any): void => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (['text', 'label', 'altText', 'displayText'].includes(key) && typeof child === 'string') visible.push(child); else if (typeof child === 'object') walk(child); } };
          walk(payload);
          assert.ok(visible.length, id);
          if (en) {
            if (id === 'en-limit-unsold') assert.ok(visible.some(text => text.includes('This task is unavailable here, type ‘เมนูหลัก’ to see the work you can use.')), id);
            assert.doesNotMatch(visible.join('\n').replaceAll(id === 'en-limit-unsold' ? 'เมนูหลัก' : '\0', ''), /[\u0E00-\u0E7F]/u, id);
          }
          else assert.match(visible.join('\n'), /[\u0E00-\u0E7F]/u, id);
          assert.ok(!JSON.stringify(payload).includes('canonicalText'), id);
          for (const msg of payload) for (const item of msg.quickReply?.items ?? []) if (item.action.type === 'postback' && en) assert.equal(lineControlLanguage(item.action.data).language, 'en', id);
        }
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy package ask-backs, holds and refusals use the current language', async () => {
  const { LinePackagePurchaseService } = await import('../../application/line-package-purchase.service');
  const { ForbiddenException } = await import('@nestjs/common');
  const { lineReplyLanguage } = await import('./line-language.logic');
  for (const [question, expected] of [['Please help me choose a package', 'en'], ['ช่วยเลือกแพ็กเกจค่ะ', 'th'], ['ช่วย choose package ค่ะ', 'th']] as const) {
    for (const scenario of ['selection', 'unavailable', 'busy', 'existing', 'forbidden'] as const) {
      const language = lineReplyLanguage(question);
      const service = new LinePackagePurchaseService({ client: { aiConversation: { findFirst: async () => scenario === 'unavailable' ? null : { id: 'conversation', lifecycleEpoch: 1 } } } } as any,
        { assertOwner: async () => { if (scenario === 'forbidden') throw new ForbiddenException(); }, status: async () => ({ ...(scenario === 'existing' ? { attemptId: 'attempt' } : {}), interval: 'month', availablePurchaseModes: ['CARD_AUTO', 'PROMPTPAY_ONCE'] }), catalog: async () => ({ offers: [] }), resume: async () => ({ checkoutUrl: null }) } as any,
        { available: true, load: async () => null, save: async () => scenario !== 'busy' } as any,
        { aiGatewayInternalSecret: 'test-secret' } as any);
      const result = await service.prepare({ companyId: 'company', userId: 'user', membershipId: 'member' } as any, 'chat', question, language);
      if (expected === 'en') assert.doesNotMatch(result.reply, /[\u0E00-\u0E7F]/u, scenario); else assert.match(result.reply, /[\u0E00-\u0E7F]/u, scenario);
    }
  }
});

test('Exam G2: formatter, primary and fallback never print record ids; URI and signed-control targets remain exact', async () => {
  const { lineCustomerText } = await import('./line-language.logic');
  const { lineMessagePreview } = await import('./line-message-preview.logic');
  const cuid = 'cmvc8kuzi05m0uqk1sw21svk5', uuid = '550e8400-e29b-41d4-a716-446655440000';
  const uri = `https://app.example.com/companies/${cuid}/expenses/${uuid}`;
  for (const language of ['th', 'en'] as const) {
    const text = `${language === 'en' ? 'Review this expense' : 'ตรวจรายการนี้ค่ะ'} ${cuid} ${uuid}\n${uri}`;
    assert.doesNotMatch(lineCustomerText(text), new RegExp(`${cuid}|${uuid}`));
    assert.doesNotMatch(lineMessagePreview(text), new RegExp(`${cuid}|${uuid}`));
    const card = buildLineAssistantTextCardMessage(text, 'https://app.example.com', cuid, undefined, undefined, language);
    const p = plan([text], [card]);
    validateLineDeliveryPlan(p);
    for (const frozen of [p.batches[0]!.primary, p.batches[0]!.fallback]) {
      assert.ok(frozen);
      const visible: string[] = [], targets: string[] = [];
      const visit = (value: any): void => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && ['text', 'altText', 'label', 'displayText'].includes(key)) visible.push(child);
        else if (key === 'uri' && typeof child === 'string') targets.push(child); else if (typeof child === 'object') visit(child);
      } };
      visit(frozen.messages);
      assert.doesNotMatch(visible.join('\n'), new RegExp(`${cuid}|${uuid}`));
      assert.ok(targets.some(target => target.includes(cuid) && target.includes(uuid)), 'both representations keep the functional record link behind its label');
    }
  }
});


test('U5 every LINE visible field strips internal plan codes and em dashes', async () => {
  const { lineDeliveryWireMessages } = await import('./line-delivery-plan.logic');
  for (const code of ['STARTER', 'BASIC', 'PRO', 'ENTERPRISE']) {
    const text = `แพ็กเกจ (${code}) — ใช้ได้ค่ะ`;
    const wire = lineDeliveryWireMessages([{ type: 'text', text }, { type: 'flex', altText: text, contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text }] } } }]);
    assert.doesNotMatch(JSON.stringify(wire), /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
  }
});

test('wire formatting preserves message commands and opaque targets while cleaning display fields', async () => {
  const { lineDeliveryWireMessages } = await import('./line-delivery-plan.logic');
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const command = `/company ${id}`;
  const postback = `action=company-select&companyId=${id}`;
  const uri = `https://app.example.com/l/${id}`;
  const messages: LineReplyMessage[] = [{
    type: 'flex', altText: id, canonicalText: 'internal recovery text',
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: id },
      { type: 'button', action: { type: 'message', label: id, text: command } },
      { type: 'button', action: { type: 'postback', label: id, data: postback, displayText: id } },
      { type: 'button', action: { type: 'uri', label: id, uri } },
    ] } },
    quickReply: { items: [{ type: 'action', action: { type: 'message', label: id, text: command } }] },
  }, { type: 'text', text: command }];
  const original = structuredClone(messages);
  const wire = lineDeliveryWireMessages(messages);
  const card = wire[0] as any, [body, message, control, link] = card.contents.body.contents;
  assert.equal(card.altText, 'ไม่ระบุ');
  assert.equal(card.canonicalText, undefined);
  assert.equal(body.text, 'ไม่ระบุ');
  assert.deepEqual(message.action, { type: 'message', label: 'ไม่ระบุ', text: command });
  assert.deepEqual(control.action, { type: 'postback', label: 'ไม่ระบุ', data: postback, displayText: 'ไม่ระบุ' });
  assert.deepEqual(link.action, { type: 'uri', label: 'ไม่ระบุ', uri });
  assert.equal(card.quickReply.items[0].action.text, command);
  assert.equal((wire[1] as any).text, '/company ไม่ระบุ', 'ordinary visible text is still sanitized');
  assert.deepEqual(lineDeliveryWireMessages(wire), wire, 'replay formatting is idempotent');
  assert.deepEqual(messages, original, 'stored source messages are unchanged');
});

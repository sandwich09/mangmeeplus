import { EXPENSE_ACTIONS, type ExpenseActionPreview } from '../../application/line-expense-action.service';
import { TEAM_ACTION_LABELS } from '../../application/line-team-action.service';
import { buildExpenseActionCard } from './line-expense-action-card.logic';
import { buildSubstituteReceiptActionCard } from '../../application/line-substitute-receipt-action.service';
import { buildPackagePurchaseCard } from '../../application/line-package-purchase.service';
import { buildCounterpartyCard } from '../../application/line-counterparty.service';
import { buildLineDeliveryPlan, deliveryHash, lineDeliveryPlanId, parseLineDeliveryPlan, validateLineDeliveryPlan, type DeliveryAuthorizationV2, type DeliveryControlV2 } from './line-delivery-plan.logic';
import { asCompleteLineCard, buildExpenseDraftReviewCard, buildLineSystemTextCardMessage, inheritCompleteLineBusinessAnswerPresentation } from './line-business-card.logic';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { linePaymentEvidenceReply, linePaymentEvidencePostbackCommand, parseLinePaymentEvidenceControl } from './line-payment-evidence-reply.logic';
import { linePostbackCommandText, buildStaffCompletionQuickReply } from './line-staff-menu.logic';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BusinessDocumentClassification } from '@watchdog-bms/contracts';
import {
  CAPTURE_READ_FAILED_REPLY,
  CAPTURE_READ_PARTIAL_REPLY,
  CAPTURE_READ_PAUSED_REPLY,
  capturePausedReasonTh,
  classifyNonReceiptCase,
  formatCaptureReadFinishedReply,
  NON_RECEIPT_PERSISTING_CASES,
  nonReceiptReply,
} from './line-non-receipt-reply.logic';

const LINK = 'https://app.example.com/companies/c1/expenses/capture/g1';

/** The retired AI-money wording, assembled at runtime: spelled out here it would trip the repo-wide
 *  guard that exists to keep it out of source (spec §3, W-01). */
const retiredAiMoneyWords = ['\u0e07\u0e1a', '\u0e42\u0e04\u0e27\u0e15\u0e32'].map((word) => `${word} AI`);
const usesRetiredAiMoneyWording = (text: string): boolean => retiredAiMoneyWords.some((word) => text.includes(word));


function classification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT', documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'DELIVERY_NOTE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'ORDERED', evidenceRoles: [],
    confidence: 0.9, evidenceSignals: [], amountSignals: [], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
    ...overrides,
  } as BusinessDocumentClassification;
}

describe('§18.4 NR01–NR09 reply table', () => {
  // The whole point of §18.4: a courier document is named for what it IS, and the two shapes that
  // share `DELIVERY_NOTE` are told apart by their signals, not by a per-courier enum.
  for (const [name, kind, signal, expectedCase, expectedText] of [
    ['NR01 parcel label', 'DELIVERY_NOTE', 'PARCEL_LABEL_SIGNAL', 'NR01',
      'ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ'],
    ['NR02 deposit slip', 'DELIVERY_NOTE', 'DEPOSIT_SLIP_SIGNAL', 'NR02',
      'ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ'],
    ['NR03 delivery note without a signal', 'DELIVERY_NOTE', null, 'NR03',
      'ใบนี้เป็นใบส่งของค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR03 quotation', 'QUOTATION', null, 'NR03',
      'ใบนี้เป็นใบเสนอราคาค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR03 purchase order', 'PURCHASE_ORDER', null, 'NR03',
      'ใบนี้เป็นใบสั่งซื้อค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR05 transfer slip', 'TRANSFER_SLIP', null, 'NR05_SLIP',
      'พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร'],
    ['NR05 marketplace order', 'MARKETPLACE_ORDER', null, 'NR05_ORDER',
      'พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน'],
    ['NR07 non-business image', 'NON_FINANCIAL_IMAGE', null, 'NR07',
      'ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ'],
    ['NR08 unsure', 'NEEDS_REVIEW', null, 'NR08', 'ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ'],
  ] as const) {
    it(`${name} maps to ${expectedCase} with the §18.4 sentence`, () => {
      const value = classification({
        documentKind: kind as BusinessDocumentClassification['documentKind'],
        ...(signal ? { missingRequiredSignals: [signal as never] } : {}),
      });
      assert.equal(classifyNonReceiptCase(value), expectedCase);
      assert.equal(nonReceiptReply(expectedCase, { classification: value }), expectedText);
    });
  }

  it('NR04 prints the amount only when the reader read one', () => {
    const invoice = classification({ documentKind: 'SUPPLIER_INVOICE_OR_BILL', documentFamily: 'EXPENSE_EVIDENCE' });
    assert.equal(classifyNonReceiptCase(invoice), 'NR04');
    assert.equal(
      nonReceiptReply('NR04', { classification: invoice, amountLabel: '1,250.00' }),
      'ใบนี้เป็นใบแจ้งหนี้ ยอด 1,250.00 บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก',
    );
    assert.equal(
      nonReceiptReply('NR04', { classification: invoice }),
      'ใบนี้เป็นใบแจ้งหนี้ค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก',
    );
  });

  it('NR06 stays with the check-bill continuation, and multi/unreadable keep their own copy', () => {
    assert.equal(classifyNonReceiptCase(classification({ documentKind: 'ORDER_OR_CHECK_BILL' })), 'NR06');
    assert.equal(classifyNonReceiptCase(classification({ contentKind: 'MULTI_DOCUMENT' })), null);
    assert.equal(classifyNonReceiptCase(classification({ contentKind: 'UNREADABLE' })), null);
    assert.equal(classifyNonReceiptCase(null), null);
  });

  it('only NR01–NR03 and NR08 may offer the Web CTA, and only with a real link', () => {
    assert.deepEqual([...NON_RECEIPT_PERSISTING_CASES], ['NR01', 'NR02', 'NR03', 'NR08']);
    for (const nr of NON_RECEIPT_PERSISTING_CASES) {
      const withLink = nonReceiptReply(nr, { classification: classification(), captureLink: LINK });
      assert.match(withLink, /ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: https:\/\//, `${nr} offers the CTA when the bytes are kept`);
      const without = nonReceiptReply(nr, { classification: classification() });
      assert.ok(!/กรอกข้อมูลต่อ/.test(without), `${nr} says nothing about a link it does not have`);
    }
    // §18.4: a non-business image is never persisted, so it can never carry the CTA.
    assert.ok(!/กรอกข้อมูลต่อ/.test(nonReceiptReply('NR07', { captureLink: LINK })));
  });

  it('NR09 / §17.6: the three read outcomes each name their own state and never each other', () => {
    assert.equal(CAPTURE_READ_FAILED_REPLY(LINK), `อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${LINK}`);
    assert.equal(CAPTURE_READ_PARTIAL_REPLY(LINK), `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${LINK}`);
    // Wave-2 credit wording, unchanged: one sentence for every ceiling that stops a document read.
    assert.match(CAPTURE_READ_PAUSED_REPLY(LINK, 'ai_credit'), /เครดิตสำหรับการอ่านเอกสารไม่พอ/);
    assert.ok(!usesRetiredAiMoneyWording(CAPTURE_READ_PAUSED_REPLY(LINK, 'ai_credit')), 'the retired budget words never appear');
    assert.equal(capturePausedReasonTh('page_limit'), 'เอกสารมีจำนวนหน้ามากกว่าที่ระบบอ่านอัตโนมัติได้');
    assert.equal(capturePausedReasonTh(undefined), 'ยังอ่านไม่ครบทุกหน้า');
  });

  it('the DONE summary names what was found, and says so differently for several documents', () => {
    assert.equal(
      formatCaptureReadFinishedReply({ link: LINK, documentCount: 1, issuerName: 'ร้านกาแฟดี', documentTotal: '250.00' }),
      `📄 อ่านเอกสารแล้วค่ะ พบ ร้านกาแฟดี ยอด 250.00 — ตรวจและสร้างรายการค่าใช้จ่ายในเว็บ: ${LINK}`,
    );
    assert.equal(
      formatCaptureReadFinishedReply({ link: LINK, documentCount: 3 }),
      `📄 อ่านเอกสารแล้วค่ะ พบ 3 ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ: ${LINK}`,
    );
    // No issuer and no total read: the sentence still stands, with nothing invented.
    assert.match(formatCaptureReadFinishedReply({ link: LINK, documentCount: 1 }), /พบเอกสาร 1 ฉบับ/);
  });
});


describe('payment evidence replies and postbacks', () => {
  it('offers undo for the exact link, with no customer-visible ids', () => {
    const message = linePaymentEvidenceReply({ kind: 'LINKED', slipId: 'private-slip', receiptId: 'private-receipt', operationId: 'link-operation' });
    assert.equal(message?.type, 'text');
    if (message?.type !== 'text') throw new Error('expected text');
    assert.equal(message.text, 'แนบสลิปเป็นหลักฐานการจ่ายของใบเสร็จแล้วค่ะ');
    const action = message.quickReply!.items[0]!.action;
    assert.equal(action.type, 'postback');
    if (action.type !== 'postback') throw new Error('expected postback');
    assert.doesNotMatch(action.displayText!, /private-|link-operation/);
    const command = linePostbackCommandText(action.data);
    assert.ok(command);
    assert.deepEqual(parseLinePaymentEvidenceControl(command), { operation: 'undo', slipId: 'private-slip', operationId: 'link-operation' });
    assert.equal(linePaymentEvidencePostbackCommand(action.data + '&slipId=forged'), null);
    assert.equal(linePaymentEvidencePostbackCommand('action=payment-evidence&operation=undo&slipId=x'), null);
  });
  it('labels each ambiguous receipt by vendor, amount and date, plus a new-item choice', () => {
    const receipt = { companyId: 'co', chatKeyHash: 'chat', createdAt: new Date(), amount: '500.8000', currency: 'THB',
      documentDay: '2026-10-13', status: 'DRAFT', vendorName: 'ร้านอาหาร', hasPaymentEvidence: false };
    const message = linePaymentEvidenceReply({ kind: 'ASK', slipId: 'slip', candidates: [{ ...receipt, id: 'first' }, { ...receipt, id: 'second' }] });
    if (message?.type !== 'flex') throw new Error('expected choice card');
    assert.ok(message.canonicalText?.startsWith('สลิปนี้เป็นหลักฐานการจ่ายของรายการไหนคะ'));
    const buttons = (message.contents.body as any).contents.filter((item: any) => item.type === 'button');
    assert.equal(buttons.length, 3);
    assert.match(buttons[0].action.label, /ร้านอาหาร 500.80 13 ต.ค. 2569/);
    assert.equal(buttons[2].action.label, 'เป็นรายการใหม่');
    assert.deepEqual(parseLinePaymentEvidenceControl(linePostbackCommandText(buttons[1].action.data)!), { operation: 'link', slipId: 'slip', receiptId: 'second' });
  });
});

it('pages receipt choices four at a time so every displayed record fits the existing delivery proof bound', () => {
  const receipt = { companyId: 'co', chatKeyHash: 'chat', createdAt: new Date(), amount: '500.80', currency: 'THB',
    documentDay: '2026-10-13', status: 'DRAFT', vendorName: 'ร้านอาหาร', hasPaymentEvidence: false };
  const result = { kind: 'ASK' as const, slipId: 'slip', candidates: Array.from({ length: 6 }, (_, index) => ({ ...receipt, id: `receipt-${index}` })) };
  const first = linePaymentEvidenceReply(result), second = linePaymentEvidenceReply(result, 1);
  if (first?.type !== 'flex' || second?.type !== 'flex') throw new Error('expected choices');
  assert.match(JSON.stringify(first.contents), /receipt-3/); assert.doesNotMatch(JSON.stringify(first.contents), /receipt-4/);
  assert.match(JSON.stringify(first.contents), /รายการถัดไป/);
  assert.match(JSON.stringify(second.contents), /receipt-5/); assert.doesNotMatch(JSON.stringify(second.contents), /receipt-0/);
  const action = (first.contents.body as any).contents.at(-1).action;
  assert.deepEqual(parseLinePaymentEvidenceControl(linePostbackCommandText(action.data)!), { operation: 'page', slipId: 'slip', page: '1' });
});

it('payment evidence undo and receipt choices survive v2 primary/fallback only with exact private record proofs', () => {
  const createdAt = '2026-09-27T00:00:00.000Z', expiresAt = '2026-09-27T00:59:00.000Z';
  const privateAuthorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PRIVATE', issuedAt: createdAt, expiresAt,
    actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint',
      channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 1 }, proofs: [] };

  const make = (message: LineReplyMessage, records: string[]) => buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1',
    createdAt, expiresAt, readyAt: createdAt, firstDispatchDeadlineAt: '2026-09-27T00:00:40.000Z', businessResult: null, control: null,
    authorization: { ...privateAuthorization, proofs: [{ id: 'receipt', kind: 'EXPENSE_REVISION', records: records.map(id => ({ id, revision: 'version' })) }] },
    answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', required: true, sourceProofIds: ['receipt'],
      text: message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText! : '' }] },
    preferredMessages: [message.type === 'flex' ? asCompleteLineCard(message) : message] });
  const attached = linePaymentEvidenceReply({ kind: 'LINKED', slipId: 'slip', receiptId: 'receipt', operationId: 'operation' })!;
  const undo = make(attached, ['slip', 'receipt']);
  assert.match(JSON.stringify(undo.batches[0]!.primary.messages), /operation=undo/);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(undo))));
  assert.doesNotMatch(JSON.stringify(make(attached, ['another']).batches), /operation=undo/);
  const receipt = { companyId: 'co', chatKeyHash: 'chat', createdAt: new Date(), amount: '500.80', currency: 'THB',
    documentDay: '2026-10-13', status: 'DRAFT', vendorName: 'ร้านอาหาร', hasPaymentEvidence: false };
  const choices = linePaymentEvidenceReply({ kind: 'ASK', slipId: 'slip', candidates: [{ ...receipt, id: 'first' }, { ...receipt, id: 'second' }] })!;
  const selection = make(choices, ['slip', 'first', 'second']);
  assert.equal(selection.batches[0]!.primary.messages[0]!.type, 'flex');
  assert.match(JSON.stringify(selection.batches[0]!.primary.messages), /receiptId=first/);
  assert.match(JSON.stringify(selection.batches[0]!.fallback!.messages), /receiptId=second/);
  assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(selection))));
  assert.doesNotMatch(JSON.stringify(make(choices, ['slip', 'first']).batches), /receiptId=/);
});

describe('D1 delivery-plan control cards', () => {
  const createdAt = '2026-09-27T00:00:00.000Z', expiresAt = '2026-09-27T00:59:00.000Z';
  const privateAuthorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PRIVATE', issuedAt: createdAt, expiresAt,
    actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint',
      channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 1 }, proofs: [] };
  for (const kind of ['expense action', 'payment', 'substitute', 'counterparty', 'team', 'package'] as const) {
    it(`D1: ${kind} is one Flex covering its answer, with exact text/actions only in fallback`, () => {
      const token = `signed-${kind}`;
      const preview = { previewId: 'preview', token, expiresAt, summary: 'ตรวจข้อมูลก่อนยืนยันค่ะ',
        action: kind === 'team' ? 'EMPLOYEE_CREATE' as const : kind === 'payment' ? 'RECORD_PAYMENT' as const : 'CONFIRM' as const,
        record: { vendorName: 'ผู้รับเงิน', amount: '500.00', currency: 'THB', date: '2026-09-27', status: 'รอตรวจ', nextStatus: 'ยืนยัน' } };
      const message = kind === 'counterparty' ? buildCounterpartyCard({ token, expiresAt, lines: ['ตรวจข้อมูลก่อนยืนยันค่ะ', 'ที่อยู่: เดิม → ใหม่'] })
        : kind === 'package' ? buildPackagePurchaseCard({ token, expiresAt, lines: ['ตรวจแพ็กเกจก่อนยืนยันค่ะ', 'ราคา 999 บาท'] })
          : kind === 'substitute' ? buildSubstituteReceiptActionCard({ token, expiresAt, label: 'ยืนยัน', summary: 'ตรวจใบรับรองก่อนยืนยันค่ะ', webPath: 'https://app.example.com/receipt' })
            : buildExpenseActionCard(preview);
      if (message.type !== 'flex' || !message.canonicalText) throw new Error('expected canonical Flex');
      const text = message.canonicalText;
      const planId = deliveryHash(['line-delivery-v2', 'WEBHOOK', 'event-1']);
      const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId: 'event-1', createdAt, readyAt: createdAt, expiresAt,
        firstDispatchDeadlineAt: expiresAt, authorization: privateAuthorization, businessResult: null,
        answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [text, 'คำตอบอีกเรื่องค่ะ'].map(text => ({ kind: 'answer', text, required: true, sourceProofIds: [] })) },
        preferredMessages: [null, null], controlMessage: message,
        control: { kind: kind === 'counterparty' ? 'COUNTERPARTY_CONFIRM' : kind === 'package' ? 'PACKAGE_PURCHASE_CONFIRM' : 'EXPENSE_ACTION_CONFIRM',
          token, expiresAt, requiredItemIds: [`${planId}:item:0`, `${planId}:item:1`] } });
      const batch = p.batches[0]!;
      assert.deepEqual(batch.primary.messages.map(message => message.type), ['text', 'flex']);
      assert.equal((batch.primary.messages[0] as any).text, 'คำตอบอีกเรื่องค่ะ');
      assert.equal((batch.primary.messages[1] as any).altText, text);
      assert.equal((batch.fallback!.messages[1] as any).text, text);
      assert.equal(batch.fallback!.messages[1]!.quickReply!.items.length, 2);
      assert.ok(batch.fallback!.messages[1]!.quickReply!.items.every(item => new URLSearchParams((item.action as any).data).get('token') === token));
      assert.equal(batch.spans.find(span => span.itemId.endsWith(':item:0'))!.messageIndex, 1);
      assert.notEqual(batch.primary.pushRetryKey, batch.fallback!.pushRetryKey);
      assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))));
      const changed = structuredClone(p); changed.control = { ...changed.control!, token: 'wrong' } as any;
      assert.equal(parseLineDeliveryPlan(changed), null, 'signed control matching is still required');
    });
  }
});

it('Fix-up 9 R1: every LINE card uses the real builder and validator, once, with completion menus', () => {
  const WEB = 'https://app.example.com';
  const createdAt = '2026-10-16T00:00:00.000Z', expiresAt = '2026-10-16T00:10:00.000Z';
  const privateAuthorization: DeliveryAuthorizationV2 = { v: 2, kind: 'PRIVATE', issuedAt: createdAt, expiresAt,
    actor: { userId: 'user', companyId: 'company', membershipId: 'member', requestId: 'request', accessFingerprint: 'fingerprint',
      channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation', ownerEpoch: 1 }, proofs: [] };
  const token = 'sub_2191d48d-704a-4b1e-a800-6b02661001bb.' + 'a'.repeat(43);
  const menu = buildStaffCompletionQuickReply({ permissions: ['expense.read', 'expense.create'], entitledFeatureKeys: null, isOwner: true });
  type Row = { name: string; card: LineReplyMessage; controlKind?: 'EXPENSE_ACTION_CONFIRM' | 'COUNTERPARTY_CONFIRM' | 'PACKAGE_PURCHASE_CONFIRM'; proofs?: Array<{ id: string; kind: string; [key: string]: unknown }> };
  const preview: ExpenseActionPreview = { previewId: 'preview', token, action: 'CONFIRM', expiresAt, summary: 'ตรวจรายการก่อนยืนยันค่ะ',
    record: { vendorName: 'ร้านตัวอย่าง', amount: '500', currency: 'THB', date: '2026-10-10', status: 'รอตรวจ', nextStatus: 'ยืนยันแล้ว' } };
  const rows: Row[] = [...EXPENSE_ACTIONS, ...Object.keys(TEAM_ACTION_LABELS) as Array<keyof typeof TEAM_ACTION_LABELS>].map(action => ({
    name: action, card: buildExpenseActionCard({ ...preview, action, evidenceReview: action === 'CONFIRM' }), controlKind: 'EXPENSE_ACTION_CONFIRM',
  }));
  rows.push({ name: 'เตรียมใบรับรอง', card: buildSubstituteReceiptActionCard({ token, expiresAt, label: 'เตรียมใบรับรอง',
    summary: 'ตรวจข้อมูลแล้วกดเตรียมใบรับรองค่ะ', webPath: WEB + '/companies/company/expenses/substitute-receipts/new' }), controlKind: 'EXPENSE_ACTION_CONFIRM' });
  for (const label of ['เปิดลงนามในเว็บ', 'เปิดอนุมัติในเว็บ']) rows.push({ name: label,
    card: buildSubstituteReceiptActionCard({ token, expiresAt, label, webOnly: true, summary: 'เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อลงนามและอนุมัติ',
      webPath: WEB + '/companies/company/expenses/substitute-receipts/evidence' }) });
  rows.push({ name: 'substitute issued', card: buildSubstituteReceiptActionCard({ token, expiresAt, label: 'ออกใบรับรองแล้ว', summary: 'ออกใบรับรองแล้วค่ะ', webPath: WEB + '/companies/company/expenses/substitute-receipts/evidence' }, undefined, true) },
    { name: 'Fix-up 10 counterparty after capability help', card: buildCounterpartyCard({ token, expiresAt,
      lines: ['ตรวจคู่ค้าที่จะเพิ่มแล้วกดยืนยันค่ะ', 'ชื่อคู่ค้า: บริษัท ทดสอบ จำกัด', 'เลขผู้เสียภาษี: 0105558001234'] }), controlKind: 'COUNTERPARTY_CONFIRM' },
    { name: 'Fix-up 10 signed receipt confirmation', card: buildExpenseDraftReviewCard('อ่านใบเสร็จแล้วค่ะ', {
      expenseId: 'receipt', subject: 'ข้อมูลใบเสร็จ', rows: [{ label: 'ยอดรวม', value: '500 บาท' }], notes: ['ยังไม่ยืนยันรายการค่ะ'],
    }, WEB, 'company', { ...preview, evidenceReview: true })!, controlKind: 'EXPENSE_ACTION_CONFIRM' },
    { name: 'package', card: buildPackagePurchaseCard({ token, expiresAt, lines: ['ตรวจแพ็กเกจก่อนสร้างลิงก์จ่ายค่ะ'] }), controlKind: 'PACKAGE_PURCHASE_CONFIRM' },
    { name: 'package checkout', card: buildPackagePurchaseCard({ token, expiresAt, lines: ['ลิงก์จ่ายพร้อมแล้วค่ะ'], payment: { checkoutUrl: 'https://checkout.example.test/pay' } as any }) },
    { name: 'payment and 50 ทวิ next actions', card: buildExpenseActionCard({ ...preview, offerPayment: true, offerWht: true }, 'ยืนยันแล้วค่ะ'),
      proofs: [{ id: 'applied', kind: 'EXPENSE_ACTION_PREVIEW', token, applied: true }] },
    { name: 'issued 50 ทวิ', card: buildExpenseActionCard({ ...preview, action: 'WHT_CERTIFICATE_ISSUE', certificates: [{ number: 'WHT-1', uri: WEB + '/companies/company/tax/certificate' }] }, 'ออกหนังสือรับรองแล้วค่ะ') });
  for (const [name, text, choices] of [
    ['evidence choice', 'เลือกหลักฐานที่ใช้กับรายการนี้ได้เลยค่ะ', ['แนบใบเสร็จ', 'จัดทำใบรับรองแทนใบเสร็จ', 'ใช้หลักฐานอื่นที่มี']],
    ['PDF purpose', 'ต้องการให้อ่านไฟล์นี้เพื่อตอบคำถาม หรือใช้เป็นหลักฐานบันทึกค่าใช้จ่ายคะ', ['ใช้เป็นหลักฐานบันทึกค่าใช้จ่าย', 'ถามจากไฟล์']],
  ] as const) {
    const card = buildLineSystemTextCardMessage({ text, header: { lines: ['เอกสารที่ส่งมา', 'ขอข้อมูลเพิ่ม'] }, webBaseUrl: WEB, companyId: 'company' })!;
    rows.push({ name, card: inheritCompleteLineBusinessAnswerPresentation(card, { ...card,
      quickReply: { items: choices.map(text => ({ type: 'action' as const, action: { type: 'message' as const, label: text, text } })) } }) });
  }
  const linked = linePaymentEvidenceReply({ kind: 'LINKED', slipId: 'slip', receiptId: 'receipt', operationId: 'operation' })!;
  rows.push({ name: 'payment-evidence undo', card: linked, proofs: [{ id: 'records', kind: 'EXPENSE_REVISION', records: [{ id: 'slip' }, { id: 'receipt' }] }] },
    { name: 'payment-evidence choice', card: asCompleteLineCard(linePaymentEvidenceReply({ kind: 'ASK', slipId: 'slip', candidates: [{ id: 'receipt', companyId: 'company', chatKeyHash: 'chat', createdAt: new Date(createdAt), currency: 'THB', status: 'DRAFT', hasPaymentEvidence: false, vendorName: 'ร้านตัวอย่าง', amount: '500.00', documentDay: '2026-10-10' }] })!),
      proofs: [{ id: 'records', kind: 'EXPENSE_REVISION', records: [{ id: 'slip' }, { id: 'receipt' }] }] });
  for (const row of rows) {
    // Completed substitute/photo replies add this menu before sendMessagesV2. It must not replace
    // the financial postbacks in the fallback (the exact b1/b4 regression).
    const card = row.controlKind ? inheritCompleteLineBusinessAnswerPresentation(row.card, { ...row.card, quickReply: menu }) : row.card;
    const text = card.type === 'flex' ? card.canonicalText! : card.type === 'text' ? card.text : '';
    const producerId = `card-${row.name}`, planId = lineDeliveryPlanId('WEBHOOK', producerId);
    const control: DeliveryControlV2 | null = row.controlKind ? { kind: row.controlKind, token, expiresAt, requiredItemIds: [`${planId}:item:0`] } : null;
    const p = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId, createdAt, readyAt: createdAt, expiresAt, firstDispatchDeadlineAt: expiresAt,
      authorization: { ...privateAuthorization, proofs: row.proofs ?? [] }, businessResult: null, control,
      answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text, required: true, sourceProofIds: [] }] },
      preferredMessages: [row.controlKind ? null : card], ...(control ? { controlMessage: card } : {}) });
    assert.doesNotThrow(() => validateLineDeliveryPlan(p), row.name);
    const sent = p.batches.flatMap(batch => batch.primary.messages);
    assert.equal(sent.length, 1, row.name);
    assert.equal(sent[0]!.type, card.type, row.name);
    if (sent[0]!.type === 'flex') assert.equal((sent[0]!.contents as any).type, 'bubble', row.name);
    assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(p))), row.name);
    if (row.name === 'เปิดลงนามในเว็บ' || row.name === 'เปิดอนุมัติในเว็บ') {
      assert.equal(p.control, null);
      assert.doesNotMatch(JSON.stringify(p.batches), /expense_action_confirm|expense_action_cancel|postback/);
      const primary: any = sent[0];
      assert.deepEqual(primary.contents.footer.contents[0].action, { type: 'uri', label: row.name,
        uri: WEB + '/companies/company/expenses/substitute-receipts/evidence?openExternalBrowser=1' });
    }
    if (row.controlKind) {
      const fallback = p.batches[0]!.fallback!.messages[0]!;
      assert.equal(fallback.type, 'text', row.name);
      assert.ok(fallback.quickReply!.items.some(item => item.action.type === 'postback' && item.action.data.includes(token)), row.name);
    }
  }
});

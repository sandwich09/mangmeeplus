import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseCategorySummary } from '@watchdog-bms/contracts';
import {
  applyLineExpenseDraftAnswer,
  buildInitialLineExpenseDraftContinuation,
  formatLineExpenseDraftReply,
  isDeterministicLineExpenseDraftInput,
  isLineExpenseDraftStartEligible,
  lineExpenseDraftControl,
  materializedLineExpenseDraftItems,
  splitLineExpenseDraftReply,
  transitionLineExpenseDraft,
} from './line-expense-draft-conversation.logic';

const categories: ExpenseCategorySummary[] = [
  { id: 'cat-office', companyId: 'c1', name: 'อุปกรณ์สำนักงาน', accountHintKey: 'expense.office', defaultInputTaxCode: null, status: 'ACTIVE', sortOrder: 1 },
  { id: 'cat-computer', companyId: 'c1', name: 'อุปกรณ์คอมพิวเตอร์', accountHintKey: 'asset.computer', defaultInputTaxCode: null, status: 'ACTIVE', sortOrder: 2 },
];

function initial() {
  return buildInitialLineExpenseDraftContinuation({
    workflowId: 'wf-1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
    targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18',
    messageText: 'ซื้อกระดาษ A4 กับโน้ตบุ๊กมาใช้ที่ออฟฟิศ โน้ตบุ๊ก 1 เครื่อง 25,000 บาท',
    webhookEventId: 'evt-1', categories, now: '2026-08-18T01:00:00.000Z',
    hints: {
      confidence: 0.98, businessPurpose: 'ใช้ที่ออฟฟิศ', items: [
        { sourceText: 'กระดาษ A4', description: 'กระดาษ A4', expenseCategoryId: 'cat-office', accountingClass: 'OPEX', itemBehavior: 'NON_STOCK' },
        { sourceText: 'โน้ตบุ๊ก 1 เครื่อง 25,000 บาท', description: 'โน้ตบุ๊ก', quantity: '1', unit: 'เครื่อง', totalAmount: '25000', expenseCategoryId: 'cat-computer', accountingClass: 'ASSET', itemBehavior: 'NON_STOCK' },
      ],
    },
  });
}

describe('LINE expense draft conversation logic', () => {
  it('preserves every item and asks every document/item gap together without inventing paper numbers', () => {
    const state = initial();
    assert.equal(state.items.length, 2);
    assert.equal(state.items[0]?.description, 'กระดาษ A4');
    assert.equal(state.items[0]?.quantity, undefined);
    assert.equal(state.items[0]?.unitPrice, undefined);
    assert.equal(state.items[1]?.quantity, '1');
    assert.equal(state.items[1]?.totalAmount, '25000');
    assert.equal(state.items[1]?.advisorySource, 'AI_GATEWAY');
    assert.equal(state.items[1]?.advisoryRuleVersion, 'line-expense-draft-v1');
    assert.ok(state.provenance['D-PURPOSE']);
    assert.ok(state.provenance['I02-QTY']);
    assert.ok(state.provenance['I02-PRICE']);
    assert.deepEqual(state.unresolvedQuestions.map((question) => question.id), [
      'D-DATE', 'D-VENDOR', 'I01-QTY', 'I01-PRICE', 'I01-CATEGORY', 'I02-CATEGORY',
    ]);
    const reply = formatLineExpenseDraftReply({ state, categories });
    assert.match(reply, /กระดาษ A4 — \? — \?/u);
    assert.match(reply, /I01-QTY/u);
    assert.match(reply, /I02-CATEGORY/u);
  });

  it('accepts several numbered answers, keeps the full snapshot, and leaves only real gaps', () => {
    const state = initial();
    assert.equal(state.items[1]?.suggestedCategoryId, 'cat-computer');
    const answer = applyLineExpenseDraftAnswer({
      state, categories, now: '2026-08-18T02:00:00.000Z', webhookEventId: 'evt-2',
      messageText: 'D-DATE 18/08/2026, D-VENDOR ร้าน ABC, I01-QTY 5 รีม, I01-PRICE 650 รวม, I01-CATEGORY อุปกรณ์สำนักงาน, I02-CATEGORY ตามที่แนะนำ',
    });
    assert.equal(answer.state.header.expenseDate, '2026-08-18');
    assert.equal(answer.state.header.vendorName, 'ร้าน ABC');
    assert.equal(answer.state.items[0]?.quantity, '5');
    assert.equal(answer.state.items[0]?.totalAmount, '650');
    assert.equal(answer.state.items[0]?.expenseCategoryId, 'cat-office');
    assert.ok(answer.acceptedFields.includes('I02-CATEGORY'), JSON.stringify(answer.acceptedFields));
    assert.equal(answer.state.items[1]?.expenseCategoryId, 'cat-computer');
    assert.deepEqual(answer.state.unresolvedQuestions, []);
    assert.match(formatLineExpenseDraftReply({ state: answer.state, categories, acceptedFields: answer.acceptedFields }), /1\) กระดาษ A4/u);
    assert.equal(materializedLineExpenseDraftItems(answer.state).length, 2);
    // Expense §5.1: everything this lane collects is goods, and it SAYS so. An absent chargeKind
    // tells `updateExpenseDraft` to keep whatever that row already had, which is not what a
    // freshly collected item means.
    assert.deepEqual(materializedLineExpenseDraftItems(answer.state).map((item) => item.chargeKind), [null, null]);
  });

  it('accepts the suggested category from segment text with a colon separator (สระอำ must survive normalization)', () => {
    const state = initial();
    const answer = applyLineExpenseDraftAnswer({
      state, categories, now: '2026-08-18T02:00:00.000Z', webhookEventId: 'evt-nfc-1',
      messageText: 'I02-CATEGORY: ตามที่แนะนำ',
    });
    assert.ok(answer.acceptedFields.includes('I02-CATEGORY'), JSON.stringify(answer.acceptedFields));
    assert.equal(answer.state.items[1]?.expenseCategoryId, 'cat-computer');
    assert.ok(!answer.rejectedCandidates.some((candidate) => candidate.field === 'I02-CATEGORY'), JSON.stringify(answer.rejectedCandidates));
  });

  it('accepts the suggested category in plain segment form through the segment path', () => {
    const state = initial();
    const answer = applyLineExpenseDraftAnswer({
      state, categories, now: '2026-08-18T02:00:00.000Z', webhookEventId: 'evt-nfc-2',
      messageText: 'I02-CATEGORY ตามที่แนะนำ',
    });
    assert.ok(answer.acceptedFields.includes('I02-CATEGORY'), JSON.stringify(answer.acceptedFields));
    assert.equal(answer.state.items[1]?.expenseCategoryId, 'cat-computer');
  });

  it('recognizes resume commands that contain สระอำ (ทำต่อ / ทำรายการต่อ)', () => {
    assert.equal(lineExpenseDraftControl('ทำต่อ'), 'resume');
    assert.equal(lineExpenseDraftControl('ทำรายการต่อ'), 'resume');
    assert.equal(lineExpenseDraftControl('ต่อ'), 'resume');
  });

  it('keeps invalid or ungrounded model facts and unconfirmed categories out of state', () => {
    const state = initial();
    const answer = applyLineExpenseDraftAnswer({
      state, categories, messageText: 'กระดาษ A4 ห้ารีม วันที่ 18/08/2026',
      hints: {
        expenseDate: '2026-08-17',
        items: [{ itemRef: 'I01', quantity: '999', unit: 'กล่อง', unitPrice: '888', expenseCategoryId: 'cat-office' }],
      },
    });
    assert.equal(answer.state.items[0]?.quantity, undefined);
    assert.equal(answer.state.items[0]?.unit, undefined);
    assert.equal(answer.state.items[0]?.unitPrice, undefined);
    assert.equal(answer.state.items[0]?.expenseCategoryId, undefined);
    assert.equal(answer.state.header.expenseDate, undefined);
    assert.deepEqual(answer.rejectedCandidates, [
      { field: 'D-DATE', reason: 'NOT_GROUNDED_OR_INVALID' },
      { field: 'I01-QTY', reason: 'NOT_GROUNDED_OR_INVALID' },
      { field: 'I01-PRICE', reason: 'NOT_GROUNDED_OR_INVALID' },
      { field: 'I01-CATEGORY', reason: 'UNKNOWN_OR_UNCONFIRMED_CATEGORY' },
    ]);
  });

  it('does not borrow another item number as evidence for an incomplete item', () => {
    const state = buildInitialLineExpenseDraftContinuation({
      workflowId: 'wf-cross-item', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
      targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18', categories,
      messageText: 'ซื้อกระดาษ A4 กับโน้ตบุ๊ก 1 เครื่อง 25000 บาท',
      hints: { confidence: 0.98, items: [
        { sourceText: 'กระดาษ A4', description: 'กระดาษ A4', quantity: '1', totalAmount: '25000' },
        { sourceText: 'โน้ตบุ๊ก 1 เครื่อง 25000 บาท', description: 'โน้ตบุ๊ก', quantity: '1', totalAmount: '25000' },
      ] },
    });
    assert.equal(state.items[0]?.quantity, undefined);
    assert.equal(state.items[0]?.totalAmount, undefined);
    assert.equal(state.items[1]?.quantity, '1');
    assert.equal(state.items[1]?.totalAmount, '25000');
  });

  it('replaces the old price representation so the accepted correction is what materializes', () => {
    const state = initial();
    state.items[0]!.quantity = '5';
    state.items[0]!.unitPrice = '100';
    const answer = applyLineExpenseDraftAnswer({ state, categories, messageText: 'I01-PRICE 650 รวม' });
    assert.equal(answer.state.items[0]?.unitPrice, undefined);
    assert.equal(answer.state.items[0]?.totalAmount, '650');
    assert.equal(materializedLineExpenseDraftItems(answer.state)[0]?.unitPrice, '130');
  });

  it('rejects a hallucinated item ref and a negated category instead of mutating another item', () => {
    const state = initial();
    const answer = applyLineExpenseDraftAnswer({
      state,
      categories,
      messageText: 'I99 กระดาษ A4 999 บาท และ I01-CATEGORY ไม่ใช่อุปกรณ์สำนักงาน',
      hints: {
        items: [
          { itemRef: 'I99', description: 'กระดาษ A4', totalAmount: '999' },
          { itemRef: 'I01', expenseCategoryId: 'cat-office' },
        ],
      },
    });
    assert.equal(answer.state.items.length, 2);
    assert.equal(answer.state.items[0]?.expenseCategoryId, undefined);
    assert.ok(answer.rejectedCandidates.some((candidate) => candidate.field === 'I99' && candidate.reason === 'UNKNOWN_ITEM'));
    assert.ok(answer.rejectedCandidates.some((candidate) => candidate.field === 'I01-CATEGORY'));
  });

  it('keeps pause, end-input, cancel, and resume as distinct non-financial states', () => {
    const state = initial();
    assert.equal(transitionLineExpenseDraft(state, 'pause').status, 'PAUSED');
    const ended = transitionLineExpenseDraft(state, 'end');
    assert.equal(ended.status, 'INPUT_ENDED_INCOMPLETE');
    assert.equal(transitionLineExpenseDraft(state, 'cancel').status, 'CANCELLED');
    const resumed = transitionLineExpenseDraft(ended, 'resume');
    assert.equal(resumed.status, 'OPEN');
    assert.equal(resumed.inputEndedAt, undefined);
    assert.match(formatLineExpenseDraftReply({ state: ended, categories }), /ข้อมูลที่ยังไม่ครบ: D-DATE/u);
  });

  it('accepts a stable D-ITEMS answer without AI and creates one ref per named item', () => {
    const state = { ...initial(), items: [], unresolvedQuestions: [] };
    const answer = applyLineExpenseDraftAnswer({
      state,
      categories,
      messageText: 'D-ITEMS กระดาษ A4 กับ โน้ตบุ๊ก',
    });
    assert.deepEqual(answer.state.items.map((item) => [item.itemRef, item.description]), [
      ['I01', 'กระดาษ A4'],
      ['I02', 'โน้ตบุ๊ก'],
    ]);
    assert.ok(answer.state.unresolvedQuestions.some((question) => question.id === 'I01-QTY'));
    assert.ok(answer.state.unresolvedQuestions.some((question) => question.id === 'I02-QTY'));
  });

  it('only opens an incomplete draft from a high-confidence expense statement', () => {
    assert.equal(isLineExpenseDraftStartEligible('ซื้อกระดาษมาใช้ที่ออฟฟิศ', { confidence: 0.9, description: 'กระดาษ' }), true);
    assert.equal(isLineExpenseDraftStartEligible('จ่ายอะไรไปแล้วหรือยัง', { confidence: 0.9 }), false);
    assert.equal(isLineExpenseDraftStartEligible('ยอด 590 บาท', { confidence: 0.9, amount: '590' }), false);
    assert.equal(isLineExpenseDraftStartEligible('ซื้อกระดาษ', { confidence: 0.4, description: 'กระดาษ' }), false);
    assert.equal(isLineExpenseDraftStartEligible('รับเงินค่าสินค้าจากลูกค้า 590 บาท', { confidence: 0.9, description: 'ค่าสินค้า' }), false);
  });

  it('does not guess when one answer names two non-negated categories', () => {
    const state = initial();
    const answer = applyLineExpenseDraftAnswer({
      state,
      categories,
      messageText: 'I01-CATEGORY เปลี่ยนจากอุปกรณ์สำนักงานเป็นอุปกรณ์คอมพิวเตอร์',
    });
    assert.equal(answer.state.items[0]?.expenseCategoryId, undefined);
    assert.deepEqual(answer.rejectedCandidates, [
      { field: 'I01-CATEGORY', reason: 'UNKNOWN_OR_UNCONFIRMED_CATEGORY' },
    ]);
  });

  it('recognises control/question-id input without treating arbitrary chat as an answer', () => {
    assert.equal(isDeterministicLineExpenseDraftInput('พัก'), true);
    assert.equal(isDeterministicLineExpenseDraftInput('I01-QTY 5 รีม'), true);
    assert.equal(isDeterministicLineExpenseDraftInput('ร่าง 1'), true);
    assert.equal(isDeterministicLineExpenseDraftInput('รายการ 1'), false);
    assert.equal(isDeterministicLineExpenseDraftInput('ยอดขายวันนี้เท่าไร'), false);
  });

  it('splits a long reply without dropping content', () => {
    const text = Array.from({ length: 100 }, (_, index) => `บรรทัด ${index} ${'x'.repeat(40)}`).join('\n');
    const parts = splitLineExpenseDraftReply(text, 300);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(''), text);
    assert.ok(parts.every((part) => part.length <= 300));
  });

  it('hard-splits a single oversized line within the LINE limit without dropping content', () => {
    const text = 'ก'.repeat(901);
    const parts = splitLineExpenseDraftReply(text, 300);
    assert.deepEqual(parts.map((part) => part.length), [300, 300, 300, 1]);
    assert.equal(parts.join(''), text);
  });
});

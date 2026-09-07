import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExpenseSourceDraftInput, bindSourceDraftLines, sourceDraftState, projectExpenseSourceDraft } from './expense-source-draft.logic';
import { buildInitialLineExpenseDraftContinuation, collectLineExpenseDraftQuestions, formatLineExpenseDraftReply, lineExpenseDraftControl, parseLineExpenseDraftContinuation, splitLineExpenseDraftReply } from './line-expense-draft-conversation.logic';

const categories = [{ id: 'cat', companyId: 'co', status: 'ACTIVE', name: 'สำนักงาน', accountHintKey: 'office' }] as any;
const base = { workflowId: 'wf', companyId: 'co', userId: 'u', expenseId: 'ex', chatKeyHash: 'chat', targetRevision: '2026-09-01T00:00:00.000Z', provisionalExpenseDate: '2026-09-01', categories };
const empty = () => buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'กระดาษ', hints: { items: [{ sourceText: 'กระดาษ', description: 'กระดาษ' }] } });

describe('shared receipt source facts (T10/T14–T18)', () => {
  it('retains all40 items and all missing questions within five LINE messages;41 is explicit rejection', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ sourceText: `สินค้า${index + 1}${'ก'.repeat(110)}`, description: `สินค้า${index + 1}${'ก'.repeat(110)}` }));
    const state = buildInitialLineExpenseDraftContinuation({ ...base, messageText: items.map((item) => item.sourceText).join(' '), hints: { items } });
    assert.equal(state.items.length, 40);
    assert.equal(state.unresolvedQuestions.length, 123);
    assert.equal(parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(state)))?.items.length, 40);
    const text = formatLineExpenseDraftReply({ state, categories });
    const messages = splitLineExpenseDraftReply(text);
    assert.ok(messages.length <= 5, `${messages.length} messages`);
    assert.equal(messages.join(''), text);
    for (const question of state.unresolvedQuestions) assert.ok(text.includes(question.id), question.id);
    assert.throws(() => buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'x', hints: { items: [...items, items[0]!] } }), /at most 40/);
  });

  it('never turns a summary financial1/100 into missing OCR item facts on initial bind or stale refresh', () => {
    const expense = { id: 'ex', companyId: 'co', createdByUserId: 'u', captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW',
      expenseDate: new Date(base.targetRevision), updatedAt: new Date(base.targetRevision), reviewedAt: null, vendorNameSnapshot: null, note: 'LINE receipt upload',
      sourceChannelMetadataJson: null, aiVerificationSummaryJson: { chargeReconciliationStatus: 'SUMMARY_LINE', recognizedFields: { lines: [{ description: 'กระดาษ' }] } },
      lines: [{ id: 'summary', description: 'กระดาษ', quantity: '1', unitPrice: '100', expenseCategoryId: null, reviewStatus: 'REVIEWED' }] } as any;
    const bound = bindSourceDraftLines(empty(), expense, true);
    assert.equal(bound.items[0]!.quantity, undefined); assert.equal(bound.items[0]!.unitPrice, undefined);
    assert.equal(bound.items[0]!.lineId, undefined); assert.equal(bound.items[0]!.reviewRequired, true);
    const projection = projectExpenseSourceDraft(sourceDraftState(expense, categories)!, true);
    assert.equal(projection.header.expenseDate, null);
    assert.equal(projection.items[0]!.quantity, null); assert.equal(projection.items[0]!.unitPrice, null);
    assert.ok(projection.missingFields.some((question) => question.field === 'quantity'));
    const completeSource = empty(); completeSource.items[0]!.quantity = '2'; completeSource.items[0]!.unitPrice = '50';
    const mismatched = bindSourceDraftLines(completeSource, expense);
    assert.equal(mismatched.items[0]!.quantity, '2'); assert.equal(mismatched.items[0]!.unitPrice, '50');
    assert.equal(mismatched.items[0]!.lineId, undefined); assert.equal(mismatched.items[0]!.reviewRequired, true);
  });

  it('keeps null unknown and free zero across patch/reload, preserves omitted fields, and rejects foreign or malformed input', () => {
    const first = applyExpenseSourceDraftInput(empty(), { vendorName: 'ร้าน ก', items: [{ itemRef: 'I01', unitPrice: '0', quantity: null }] }, categories);
    const reloaded = parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(first.state)))!;
    const second = applyExpenseSourceDraftInput(reloaded, { businessPurpose: 'ใช้สำนักงาน', items: [{ itemRef: 'I01', expenseCategoryId: 'cat' }] }, categories);
    assert.equal(second.state.header.vendorName, 'ร้าน ก'); assert.equal(second.state.items[0]!.unitPrice, '0');
    assert.equal(second.state.items[0]!.quantity, undefined); assert.equal(second.state.items.length, 1);
    const cleared = applyExpenseSourceDraftInput(second.state, { vendorName: null, items: [{ itemRef: 'I01', unitPrice: '' }] }, categories);
    assert.equal(cleared.state.header.vendorName, undefined); assert.equal(cleared.state.items[0]!.unitPrice, undefined);
    for (const input of [null, { taxCode: 'I7' }, { items: [{ itemRef: 'I99' }] }, { items: [{ itemRef: 'I01' }, { itemRef: 'I01' }] },
      { items: [{ itemRef: 'I01', quantity: '0' }] }, { items: [{ itemRef: 'I01', unitPrice: 'NaN' }] }, { items: [{ itemRef: 'I01', unitPrice: 'Infinity' }] },
      { items: [{ itemRef: 'I01', expenseCategoryId: 'foreign' }] }, { expenseDate: '2026-02-30' }]) assert.throws(() => applyExpenseSourceDraftInput(empty(), input as any, categories), JSON.stringify(input));
  });

  it('recognizes ordinary Thai save-for-later words without any final mutation', () => {
    for (const phrase of ['บันทึกไปก่อน', 'บันทึกไว้ก่อน', 'เดี๋ยวไปแก้ในเว็บ', 'พักไว้ก่อน']) assert.equal(lineExpenseDraftControl(phrase), 'pause');
    const state = empty(); state.items[0]!.quantity = '1'; state.items[0]!.unitPrice = '0'; state.items[0]!.expenseCategoryId = 'cat';
    state.header = { ...state.header, expenseDate: '2026-09-01', vendorName: 'ร้าน ก', businessPurpose: 'ใช้สำนักงาน' };
    assert.equal(collectLineExpenseDraftQuestions(state, categories).length, 0);
  });
});

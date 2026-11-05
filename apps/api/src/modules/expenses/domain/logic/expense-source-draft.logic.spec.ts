import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExpenseSourceDraftInput, assertExpenseSourceDraftComplete, bindSourceDraftLines, sourceDraftState, projectExpenseSourceDraft } from './expense-source-draft.logic';
import { buildInitialLineExpenseDraftContinuation, collectLineExpenseDraftQuestions, formatLineExpenseDraftReply, lineExpenseDraftControl, parseLineExpenseDraftContinuation, splitLineExpenseDraftReply } from './line-expense-draft-conversation.logic';

const categories = [{ id: 'cat', companyId: 'co', status: 'ACTIVE', name: 'สำนักงาน', accountHintKey: 'office' }] as any;
const base = { workflowId: 'wf', companyId: 'co', userId: 'u', expenseId: 'ex', chatKeyHash: 'chat', targetRevision: '2026-09-01T00:00:00.000Z', provisionalExpenseDate: '2026-09-01', categories };
const empty = () => buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'กระดาษ', hints: { items: [{ sourceText: 'กระดาษ', description: 'กระดาษ' }] } });

describe('shared receipt source facts (T10/T14–T18)', () => {
  it('round trips a certificate-length purpose through source review and retains the limit', () => {
    const purpose = 'ก'.repeat(500);
    const changed = applyExpenseSourceDraftInput(empty(), { businessPurpose: purpose }, categories);
    const reloaded = parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(changed.state)))!;
    assert.equal(reloaded.header.businessPurpose, purpose);
    const fromStored = sourceDraftState({ id: 'ex', companyId: 'co', createdByUserId: 'u', captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW',
      expenseDate: new Date(base.targetRevision), updatedAt: new Date(base.targetRevision), reviewedAt: null,
      vendorNameSnapshot: 'ร้าน ก', note: `วัตถุประสงค์: ${purpose}`, sourceChannelMetadataJson: null, aiVerificationSummaryJson: null, lines: [] } as any, categories);
    assert.equal(fromStored?.header.businessPurpose, purpose);
    assert.throws(() => applyExpenseSourceDraftInput(reloaded, { businessPurpose: `${purpose}ก` }, categories));
  });
  it('enforces the date guard on web receipts too, without blocking real assumed or legacy dates', () => {
    for (const dateStatus of ['unverified', 'implausible']) assert.throws(() => assertExpenseSourceDraftComplete(null,
      { captureSource: 'WEB_UPLOAD', aiVerificationSummaryJson: { dateStatus } } as any),
    (error: any) => error?.getResponse?.()?.code === 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED');
    for (const summary of [null, {}, { dateStatus: 'verified' }, { dateStatus: 'assumed' }]) assert.doesNotThrow(() =>
      assertExpenseSourceDraftComplete(null, { captureSource: 'WEB_UPLOAD', aiVerificationSummaryJson: summary } as any));
  });
  it('retains all40 items and gaps while asking one question;41 is explicit rejection', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ sourceText: `สินค้า${index + 1}${'ก'.repeat(110)}`, description: `สินค้า${index + 1}${'ก'.repeat(110)}` }));
    const state = buildInitialLineExpenseDraftContinuation({ ...base, messageText: items.map((item) => item.sourceText).join(' '), hints: { items } });
    assert.equal(state.items.length, 40);
    assert.equal(state.unresolvedQuestions.length, 81);
    assert.equal(parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(state)))?.items.length, 40);
    const text = formatLineExpenseDraftReply({ state, categories });
    const messages = splitLineExpenseDraftReply(text);
    assert.ok(messages.length <= 5, `${messages.length} messages`);
    assert.equal(messages.join(''), text);
    assert.equal(state.items.filter(item => item.description).length, 40);
    assert.doesNotMatch(text, /D-[A-Z]|I\d{2}-/u);
    assert.match(text, /วันไหนคะ/u);
    assert.doesNotMatch(text, /ตอบรวมในข้อความเดียว|ซื้อจากร้าน/u);
    assert.throws(() => buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'x', hints: { items: Array.from({ length: 201 }, () => items[0]!) } }), /at most 200/);
  });

  it('never turns a summary financial1/100 into missing OCR item facts on initial bind or stale refresh', () => {
    const expense = { id: 'ex', companyId: 'co', createdByUserId: 'u', captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW',
      expenseDate: new Date(base.targetRevision), updatedAt: new Date(base.targetRevision), reviewedAt: null, vendorNameSnapshot: null, note: 'LINE receipt upload',
      sourceChannelMetadataJson: null, aiVerificationSummaryJson: { chargeReconciliation: { status: 'SUMMARY_LINE' }, recognizedFields: { lines: [{ description: 'กระดาษ' }] } },
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

  it('binds fractional reconciled OCR lines using the persisted nested reconciliation contract', () => {
    const state = buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'TOMATO SOUP 0.63 243.75',
      hints: { items: [{ sourceText: 'TOMATO SOUP 0.63 243.75', description: 'TOMATO SOUP', quantity: '0.63', totalAmount: '243.75' }] } });
    const expense = { lines: [{ id: 'line-soup', description: 'TOMATO SOUP', quantity: '0.63', unitPrice: '386.9048', expenseCategoryId: 'cat', chargeKind: null }],
      aiVerificationSummaryJson: { chargeReconciliation: { status: 'RECONCILED_ITEM_LINES' } } } as any;
    const bound = bindSourceDraftLines(state, expense);
    assert.equal(bound.items[0]!.lineId, 'line-soup');
    assert.equal(bound.items[0]!.expenseCategoryId, 'cat');
    assert.equal(bound.items[0]!.reviewRequired, undefined);
    assert.equal(bound.items[0]!.unitPrice, '386.9048');
    assert.equal(bindSourceDraftLines(state, { ...expense, aiVerificationSummaryJson: { chargeReconciliation: { status: 'SUMMARY_LINE' } } }).items[0]!.lineId, undefined);
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
    assert.throws(() => applyExpenseSourceDraftInput(empty(), { businessPurpose: 'ประชุม · ลูกค้า' }, categories),
      (error: any) => error?.getResponse?.()?.code === 'EXPENSE_PURPOSE_TEXT_INVALID');
  });

  it('recognizes ordinary Thai save-for-later words without any final mutation', () => {
    for (const phrase of ['บันทึกไปก่อน', 'บันทึกไว้ก่อน', 'เดี๋ยวไปแก้ในเว็บ', 'พักไว้ก่อน']) assert.equal(lineExpenseDraftControl(phrase), 'pause');
    const state = empty(); state.items[0]!.quantity = '1'; state.items[0]!.unitPrice = '0'; state.items[0]!.expenseCategoryId = 'cat';
    state.header = { ...state.header, expenseDate: '2026-09-01', vendorName: 'ร้าน ก', businessPurpose: 'ใช้สำนักงาน' };
    assert.equal(collectLineExpenseDraftQuestions(state, categories).length, 0);
  });

  it('treats purpose as optional and removes a legacy exact-revision D-PURPOSE question on read', () => {
    const state = empty();
    state.header = { ...state.header, expenseDate: '2026-09-01', vendorName: 'ร้าน ก' };
    state.items[0]!.quantity = '1'; state.items[0]!.unitPrice = '10'; state.items[0]!.expenseCategoryId = 'cat';
    state.status = 'INPUT_ENDED_INCOMPLETE';
    state.unresolvedQuestions = [{ id: 'D-PURPOSE', scope: 'DOCUMENT', field: 'businessPurpose', prompt: 'legacy' }];
    const expense = { id: 'ex', companyId: 'co', createdByUserId: 'u', captureSource: 'LINE_UPLOAD', status: 'NEEDS_REVIEW',
      expenseDate: new Date(base.targetRevision), updatedAt: new Date(base.targetRevision), reviewedAt: null, vendorNameSnapshot: 'ร้าน ก', note: 'LINE receipt upload',
      sourceChannelMetadataJson: { lineExpenseDraftContinuation: state }, aiVerificationSummaryJson: null, lines: [] } as any;
    const current = sourceDraftState(expense, categories)!;
    assert.equal(current.header.businessPurpose, undefined);
    assert.equal(current.status, 'INPUT_ENDED_COMPLETE');
    assert.deepEqual(current.unresolvedQuestions, []);
  });
});

it('typed source drafts keep 41 and 200 items, reject 201, and survive source editing and reload', () => {
  for (const count of [41, 200]) {
    const items = Array.from({ length: count }, (_, i) => ({ sourceText: `สินค้า${i + 1}`, description: `สินค้า${i + 1}` }));
    const state = buildInitialLineExpenseDraftContinuation({ ...base, messageText: items.map(item => item.sourceText).join(' '), hints: { items } });
    assert.equal(state.items.length, count);
    const edited = applyExpenseSourceDraftInput(state, { items: state.items.map(item => ({ itemRef: item.itemRef, quantity: '1', totalAmount: '1' })) }, categories);
    assert.equal(parseLineExpenseDraftContinuation(JSON.parse(JSON.stringify(edited.state)))?.items.length, count);
  }
  assert.throws(() => buildInitialLineExpenseDraftContinuation({ ...base, messageText: 'สินค้า',
    hints: { items: Array.from({ length: 201 }, () => ({ sourceText: 'สินค้า', description: 'สินค้า' })) } }), /at most 200/);
});

it('typed draft replies show 30 priced rows plus the remaining count at 31 and 200', () => {
  for (const count of [31, 200]) {
    const state = empty();
    state.items = Array.from({ length: count }, (_, i) => ({ ...state.items[0]!, itemRef: `I${i + 1}`, description: `สินค้า${i + 1}`, quantity: '1', totalAmount: '1' }));
    const reply = formatLineExpenseDraftReply({ state, categories });
    assert.equal((reply.match(/รายการ: สินค้า/g) || []).length, 30);
    assert.match(reply, new RegExp(`และอีก ${count - 30} รายการ`));
  }
});

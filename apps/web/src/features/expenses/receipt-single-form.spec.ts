import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewValues, removeExpenseReviewLine, buildExpenseDraftReviewPayload, expenseSourceDraftViewState, type ExpenseDetail } from './expenses.model';
import { expenseSourceDraftMissingLabels } from './expense-source-draft.model';

const source = {
  status: 'PAUSED' as const, canEdit: true,
  header: { expenseDate: '2026-09-07', vendorName: 'ร้านตัวอย่าง', businessPurpose: null },
  items: [
    { itemRef: 'I01', lineId: 'line-one', description: 'น้ำดื่ม', quantity: '2', unitPrice: '20', totalAmount: null, expenseCategoryId: 'category' },
    { itemRef: 'I02', lineId: null, description: 'น้ำดื่ม', quantity: '1', unitPrice: '15', totalAmount: null, expenseCategoryId: 'category' },
  ],
  missingFields: [{ id: 'D-PURPOSE', scope: 'DOCUMENT' as const, field: 'businessPurpose', prompt: 'D-PURPOSE ใช้ทำอะไร' }],
};
const detail = {
  status: 'DRAFT', expenseDate: '2026-09-07', vendorNameSnapshot: 'ร้านตัวอย่าง', vatMode: 'NO_VAT',
  note: 'LINE receipt upload · วัตถุประสงค์: เดิม', sourceDraft: source,
  lines: [{ id: 'line-one', description: 'น้ำดื่ม', quantity: '2', unitPrice: '20', discountAmount: '5', vatRate: '0',
    vatTreatment: 'NON_VAT', whtRate: null, expenseCategoryId: 'category', accountHintKey: 'private', taxCategory: null }],
} as unknown as ExpenseDetail;

test('readable receipt uses the original review editor; unknown source facts use only the partial editor', () => {
  assert.equal(expenseSourceDraftViewState(detail, true).sourceOnly, false);
  assert.equal(expenseSourceDraftViewState(detail, false).sourceOnly, true);
  const partial = { ...detail, sourceDraft: { ...source, missingFields: [{ id: 'I02-PRICE', scope: 'ITEM' as const, itemRef: 'I02', field: 'price', prompt: 'ราคา?' }] } };
  assert.equal(expenseSourceDraftViewState(partial, true).sourceOnly, true);
});

test('one form includes same-named staged items once, preserves stored money and saves purpose with capture provenance', () => {
  const values = reviewValues(detail);
  assert.equal(values.lines.length, 2);
  assert.deepEqual(values.lines.map((line) => line.sourceItemRef), ['I01', 'I02']);
  assert.equal(values.lines[0]!.id, 'line-one');
  assert.equal(values.lines[0]!.discountAmount, '5');
  assert.equal(values.lines[1]!.unitPrice, '15');
  values.businessPurpose = 'ใช้รับรองลูกค้า';
  const payload = buildExpenseDraftReviewPayload(values);
  assert.equal(payload.note, 'LINE receipt upload · วัตถุประสงค์: ใช้รับรองลูกค้า');
  assert.deepEqual(payload.lines?.map((line) => line.sourceItemRef), ['I01', 'I02']);
  assert.equal(payload.lines?.[0]?.vatTreatment, 'NON_VAT');
});

test('review and unknown field prompts never leak technical IDs or server prompts', () => {
  const labels = expenseSourceDraftMissingLabels({ ...source, missingFields: [
    { id: 'I01-REVIEW', itemRef: 'I01', scope: 'ITEM', field: 'review', prompt: 'I01 ตรวจรายการนี้ในเว็บก่อน' },
    { id: 'PRIVATE', scope: 'DOCUMENT', field: 'future-field', prompt: 'expense.meals PRIVATE' },
  ] }, 'th');
  assert.deepEqual(labels, ['รายการที่ 1: ตรวจรายละเอียดรายการก่อนยืนยัน', 'ตรวจข้อมูลรายการนี้']);
});

 test('removing a staged-only row is explicit in the same review save', () => {
  const values = removeExpenseReviewLine(reviewValues(detail), 1);
  const payload = buildExpenseDraftReviewPayload(values);
  assert.deepEqual(payload.removedSourceItemRefs, ['I02']);
  assert.deepEqual(payload.lines?.map((line) => line.sourceItemRef), ['I01']);
});

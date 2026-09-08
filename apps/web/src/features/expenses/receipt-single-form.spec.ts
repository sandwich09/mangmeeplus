import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewValues, removeExpenseReviewLine, buildExpenseDraftReviewPayload, expenseSourceDraftViewState, type ExpenseDetail } from './expenses.model';

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

test('review authority always uses the ordinary financial form; upload-only authority keeps the source editor', () => {
  assert.equal(expenseSourceDraftViewState(detail, true).sourceOnly, false);
  assert.equal(expenseSourceDraftViewState(detail, false).sourceOnly, true);
  const partial = { ...detail, sourceDraft: { ...source, missingFields: [{ id: 'I02-PRICE', scope: 'ITEM' as const, itemRef: 'I02', field: 'price', prompt: 'ราคา?' }] } };
  assert.equal(expenseSourceDraftViewState(partial, true).sourceOnly, false);
});

test('one form includes same-named staged items once, preserves stored money and saves purpose with capture provenance', () => {
  const values = reviewValues(detail);
  assert.equal(values.lines.length, 2);
  assert.deepEqual(values.lines.map((line) => line.sourceItemRef), ['I01', 'I02']);
  assert.equal(values.lines[0]!.id, 'line-one');
  assert.equal(values.lines[0]!.discountAmount, '5');
  assert.equal(values.lines[1]!.unitPrice, '15');
  values.businessPurpose = 'ใช้รับรองลูกค้า';
  const payload = buildExpenseDraftReviewPayload(values, { sourceDraft: source, originalLines: detail.lines });
  assert.equal(payload.note, 'LINE receipt upload · วัตถุประสงค์: ใช้รับรองลูกค้า');
  assert.deepEqual(payload.lines?.map((line) => line.sourceItemRef), ['I01', 'I02']);
  assert.equal(payload.lines?.[0]?.vatTreatment, 'NON_VAT');
  assert.equal(payload.sourceDraft?.businessPurpose, 'ใช้รับรองลูกค้า');
});

test('removing a staged-only row is explicit in the same review save', () => {
  const values = removeExpenseReviewLine(reviewValues(detail), 1);
  const payload = buildExpenseDraftReviewPayload(values);
  assert.deepEqual(payload.removedSourceItemRefs, ['I02']);
  assert.deepEqual(payload.lines?.map((line) => line.sourceItemRef), ['I01']);
});

test('partial source save with no financial rows omits tax inputs', () => {
  const emptySource = {
    ...source,
    items: [{ ...source.items[0]!, lineId: null, quantity: null, unitPrice: null }],
    missingFields: [
      { id: 'I01-QTY', scope: 'ITEM' as const, itemRef: 'I01', field: 'quantity', prompt: 'qty' },
      { id: 'I01-PRICE', scope: 'ITEM' as const, itemRef: 'I01', field: 'price', prompt: 'price' },
    ],
  };
  const emptyDetail = { ...detail, lines: [], sourceDraft: emptySource, vatCaptureSnapshotJson: null, whtInputJson: null } as unknown as ExpenseDetail;
  const original = reviewValues(emptyDetail);
  const payload = buildExpenseDraftReviewPayload(original, { sourceDraft: emptySource, originalLines: [], partial: true });
  assert.equal('lines' in payload, false);
  assert.equal('vatSource' in payload, false);
  assert.equal('whtInput' in payload, false);
  const edited = { ...original, vatSource: { inputType: 'AMOUNT' as const, vatAmount: '3.60' } };
  const editedPayload = buildExpenseDraftReviewPayload(edited, { sourceDraft: emptySource, originalLines: [], partial: true });
  assert.equal('vatSource' in editedPayload, false, 'the UI blocks this save; omission preserves stored tax state');
});

test('Drtb keeps stored money, VAT, and category while source date and unknown numbers stay blank', () => {
  const drtbSource = {
    ...source,
    header: { expenseDate: null, vendorName: 'Drtb', businessPurpose: null },
    items: [
      { itemRef: 'I01', lineId: null, description: 'AMERICANO', quantity: null, unitPrice: null, totalAmount: '55', expenseCategoryId: null },
      { itemRef: 'I02', lineId: null, description: 'น้ำดื่ม', quantity: null, unitPrice: null, totalAmount: null, expenseCategoryId: null },
    ],
    missingFields: [
      { id: 'D-DATE', scope: 'DOCUMENT' as const, field: 'expenseDate', prompt: 'date' },
      { id: 'I01-QTY', scope: 'ITEM' as const, itemRef: 'I01', field: 'quantity', prompt: 'qty' },
      { id: 'I01-PRICE', scope: 'ITEM' as const, itemRef: 'I01', field: 'price', prompt: 'price' },
      { id: 'I01-CATEGORY', scope: 'ITEM' as const, itemRef: 'I01', field: 'expenseCategoryId', prompt: 'category' },
      { id: 'I02-QTY', scope: 'ITEM' as const, itemRef: 'I02', field: 'quantity', prompt: 'qty' },
      { id: 'I02-PRICE', scope: 'ITEM' as const, itemRef: 'I02', field: 'price', prompt: 'price' },
    ],
  };
  const drtb = {
    ...detail,
    expenseDate: '2026-09-08',
    vendorNameSnapshot: 'Drtb',
    vendorDocumentNumber: 'DRTB-1',
    vatMode: 'VAT_EXCLUDED',
    sourceDraft: drtbSource,
    vatCaptureSnapshotJson: {
      version: 1,
      source: { inputType: 'AMOUNT', vatRatePercent: null, vatAmount: '3.6000', taxableAmount: null, grossAmount: '55', capturedAt: '2026-09-08T00:00:00.000Z' },
    },
    lines: [{ ...detail.lines[0]!, id: 'line-coffee', description: 'AMERICANO', quantity: '1', unitPrice: '51.40',
      discountAmount: '0', vatRate: '0.07', expenseCategoryId: 'coffee-category' }],
  } as unknown as ExpenseDetail;

  const values = reviewValues(drtb);
  assert.equal(values.expenseDate, '');
  assert.deepEqual(values.lines.map(({ quantity, unitPrice, expenseCategoryId }) => ({ quantity, unitPrice, expenseCategoryId })), [
    { quantity: '', unitPrice: '', expenseCategoryId: 'coffee-category' },
    { quantity: '', unitPrice: '', expenseCategoryId: null },
  ]);
  assert.deepEqual(values.vatSource, { inputType: 'AMOUNT', vatAmount: '3.60' });

  values.businessPurpose = 'ประชุมลูกค้า';
  values.lines[1]!.quantity = '5';
  const payload = buildExpenseDraftReviewPayload(values, { sourceDraft: drtbSource, originalLines: drtb.lines, partial: true });
  assert.equal('expenseDate' in payload, false);
  assert.equal(payload.sourceDraft?.expenseDate, null);
  assert.deepEqual(payload.lines?.map(({ id, quantity, unitPrice, expenseCategoryId }) => ({ id, quantity, unitPrice, expenseCategoryId })), [
    { id: 'line-coffee', quantity: '1', unitPrice: '51.40', expenseCategoryId: 'coffee-category' },
  ]);
  assert.deepEqual(payload.sourceDraft?.items, [
    { itemRef: 'I01', description: 'AMERICANO', quantity: null, unitPrice: null, expenseCategoryId: 'coffee-category' },
    { itemRef: 'I02', description: 'น้ำดื่ม', quantity: '5', unitPrice: null, expenseCategoryId: null },
  ]);

  const knownSource = {
    ...drtbSource,
    items: [{ ...drtbSource.items[0]!, quantity: '1' }],
    missingFields: drtbSource.missingFields.filter((field) => field.itemRef !== 'I01'
      || !['quantity', 'price'].includes(field.field)),
  };
  const knownValues = reviewValues({ ...drtb, sourceDraft: knownSource } as ExpenseDetail);
  assert.equal(knownValues.lines[0]!.unitPrice, '51.40', 'source gross total does not overwrite stored pre-VAT money');
});

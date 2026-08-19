import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatGroundedReceiptFollowUp, isGroundedReceiptFollowUp } from './process-line-webhook.use-case';

function expenseWithLines(lines: unknown[]) {
  return {
    id: 'expense-1', sourceDocumentType: 'RECEIPT', grandTotalAmount: '125.00', currency: 'THB',
    expenseCategoryId: null, accountHintKey: null, taxEvidenceStatus: 'NEEDS_REVIEW',
    aiVerificationSummaryJson: { recognizedFields: { lines }, missingFields: [] },
  } as any;
}

describe('LINE grounded receipt item follow-up', () => {
  it('recognizes low-tech references to the current bill as a document question', () => {
    for (const question of [
      'บิลนี้จ่ายค่าสินค้าอะไร', 'ใบนี้ซื้ออะไรบ้าง', 'เอกสารนี้มีรายการอะไร',
    ]) assert.equal(isGroundedReceiptFollowUp(question), true, question);
  });

  it('answers only the printed line items and links to the selected expense record', () => {
    const reply = formatGroundedReceiptFollowUp('https://app.test', 'company-1', expenseWithLines([
      { description: 'กระดาษ A4', quantity: '2', amount: '100.00', evidenceSignal: 'กระดาษ A4 2 100' },
      { description: 'ปากกา', quantity: '1', amount: '25.00', evidenceSignal: 'ปากกา 1 25' },
    ]), undefined, 'บิลนี้จ่ายค่าสินค้าอะไร');
    assert.match(reply, /กระดาษ A4 × 2 – 100\.00/);
    assert.match(reply, /ปากกา × 1 – 25\.00/);
    assert.match(reply, /\/companies\/company-1\/expenses\/expense-1/);
    assert.equal(reply.includes('สต็อก'), false, 'a bill item question is not inventory');
  });

  it('states honestly when no printed item rows were readable', () => {
    const reply = formatGroundedReceiptFollowUp(undefined, 'company-1', expenseWithLines([]), undefined, 'บิลนี้ซื้ออะไร');
    assert.match(reply, /ยังอ่านรายการสินค้า.*ไม่ได้ชัดเจน/);
  });
});

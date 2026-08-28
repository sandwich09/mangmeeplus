import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./AccountingPages.tsx', import.meta.url), 'utf8');

test('sales surface localizes posting status and names the customer journey', () => {
  assert.match(source, /title="เอกสารขายและรับชำระ"/);
  assert.match(source, /POSTING_STATUS_LABELS\[doc\.postingStatus\] \?\? doc\.postingStatus/);
  assert.match(source, /เครดิตคงเหลือ \{money\(payment\.unappliedAmount\)\}/);
});

test('quotation submitter sees the separation-of-duties reason and cannot approve', () => {
  assert.match(source, /detail\?\.submittedByUserId === viewerUserId/);
  assert.match(source, /disabled=\{busy \|\| isOwnApprovalRequest\}/);
  assert.match(source, /ผู้ส่งขออนุมัติไม่สามารถอนุมัติใบเสนอราคาของตนเองได้/);
  assert.match(source, /detail\.documentType === 'QUOTATION' \? detail\.status === 'APPROVED'/);
});

test('rejected quotations expose the reason and revision path before resubmission', () => {
  assert.match(source, /detail\?\.documentType === 'QUOTATION' && detail\.status === 'REJECTED'/);
  assert.match(source, /detail\.status === 'DRAFT' \|\| isRejectedQuotation/);
  assert.match(source, /เหตุผลปฏิเสธ: \{detail\.approvalNote/);
  assert.match(source, /แก้ไขใบเสนอราคาที่ถูกปฏิเสธ/);
});

test('converted documents expose their quotation source through the existing detail navigation', () => {
  assert.match(source, /detail\.sourceDocumentId \?\? detail\.convertedFromDocumentId/);
  assert.match(source, /onClick=\{\(\) => onChanged\(sourceDocumentId\)\}/);
  assert.match(source, /เปิดเอกสารต้นทาง/);
});

test('receipt UI uses the existing fully-paid invoice route instead of orphan receipt creation', () => {
  const rootForm = source.slice(source.indexOf('function CreateDocumentForm'), source.indexOf('function DocumentDetailPanel'));
  assert.ok(!rootForm.includes("'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE'"));
  assert.ok(source.includes('สร้างใบเสร็จจากยอดรับชำระ'));
  assert.ok(source.includes("detail.paymentStatus === 'PAID' && Number(detail.outstandingAmount) === 0"));
  assert.ok(source.includes("canDocumentAction(permissions, 'RECEIPT', 'create')"));
  assert.ok(source.includes("documentType: 'RECEIPT',"));
  assert.ok(source.includes('sourceDocumentId: detail.id,'));
});

test('anonymous customer copy does not label deferred income as a cash sale', () => {
  const income = readFileSync(new URL('./RecordIncomePage.tsx', import.meta.url), 'utf8');
  assert.ok(!income.includes('ลูกค้าทั่วไป (ขายเงินสด)'));
  assert.ok(!income.includes('ไม่เลือก = ขายเงินสด'));
});

test('all three paginated sales lists expose next pages instead of hiding records after the first twenty', () => {
  for (const [start, end] of [
    ['function DocumentList', 'function CreateDocumentForm'],
    ['function CounterpartyListPage', 'function PaymentListPage'],
    ['function PaymentListPage', 'export function AccountingHubPage'],
  ]) {
    const list = source.slice(source.indexOf(start), source.indexOf(end));
    assert.ok(list.includes('page })') || list.includes('page, pageSize: 20 }'));
    assert.ok(list.includes('<Pagination page={page} totalPages={totalPages} onPageChange={setPage}'));
    assert.ok(list.includes('setPage(1)'));
  }
});

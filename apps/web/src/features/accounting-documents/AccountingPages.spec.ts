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

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { INPUT_VAT_REVIEWER_CONDITIONS, EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage, UPLOAD_FILE_TYPE_MISMATCH_MESSAGE, UPLOAD_HEIC_CONVERSION_MESSAGE } from './expenses.js';

test('expense correction and upload wording says what happened and the next action without polite filler', () => {
  assert.equal(EXPENSE_CORRECTION_WORDS.reopenDescription, 'เอกสารจะกลับไปตรวจสอบด้วยเลขเอกสารเดิม ตรวจข้อมูลก่อนยืนยันอีกครั้ง');
  assert.equal(EXPENSE_CORRECTION_WORDS.reopened, 'เปิดเอกสารให้แก้ไขแล้ว ตรวจยอดก่อนยืนยันอีกครั้ง');
  assert.equal(EXPENSE_CORRECTION_WORDS.paymentCancelled, 'ยกเลิกรายการจ่ายแล้ว ตรวจยอดค้างจ่ายก่อนบันทึกรายการใหม่');
  assert.equal(expenseCorrectionBlockerMessage('payment_voided', 'reopen'), 'รายการจ่ายนี้ยกเลิกแล้ว โหลดหน้าใหม่');
  for (const word of [...Object.values(EXPENSE_CORRECTION_WORDS), UPLOAD_FILE_TYPE_MISMATCH_MESSAGE, UPLOAD_HEIC_CONVERSION_MESSAGE]) assert.doesNotMatch(word, /กรุณา|ดำเนินการ/);
  assert.doesNotMatch(readFileSync(new URL('./expenses.ts', import.meta.url), 'utf8'), /กรุณา/);
});

test('VAT reviewer conditions are one data list with stable codes and Thai labels', () => {
  assert.deepEqual(INPUT_VAT_REVIEWER_CONDITIONS, [
    { code: 'BUSINESS_USE', label: 'ซื้อเพื่อใช้ในกิจการ' },
    { code: 'NOT_PROHIBITED', label: 'ไม่ใช่ภาษีซื้อต้องห้าม เช่น ค่ารับรอง' },
    { code: 'ISSUER_ENTITLED', label: 'ผู้ออกใบมีสิทธิออกใบกำกับภาษี' },
  ]);
});

import { INPUT_VAT_RIGHT_LABEL, TAX_EVIDENCE_LABEL, INPUT_VAT_RIGHT_LABELS, TAX_EVIDENCE_STATUS_LABELS, TAX_EVIDENCE_BADGE_LABELS } from './expenses.js';
test('keeps evidence and input VAT right distinct in fields and named badges', () => {
  assert.equal(INPUT_VAT_RIGHT_LABEL, 'ใช้ VAT ตอนยื่นภาษี'); assert.equal(TAX_EVIDENCE_LABEL, 'หลักฐานรายจ่าย');
  assert.deepEqual(INPUT_VAT_RIGHT_LABELS, { NEEDS_REVIEW: 'รอตรวจสอบ', CLAIMABLE: 'ใช้ได้ตามเงื่อนไข', NON_CLAIMABLE: 'ใช้ไม่ได้' });
  assert.deepEqual(TAX_EVIDENCE_STATUS_LABELS, { USABLE_FOR_TAX: 'ใช้ได้', SUPPORTING_ONLY: 'ใช้ได้เมื่อมีหลักฐานอื่นประกอบ', NOT_TAX_EVIDENCE: 'ใช้ไม่ได้', NEEDS_REVIEW: 'รอตรวจ' });
  assert.deepEqual(Object.values(TAX_EVIDENCE_BADGE_LABELS), ['หลักฐานรายจ่ายใช้ได้', 'หลักฐานรายจ่ายต้องมีเอกสารอื่นประกอบ', 'ไม่ใช่หลักฐานรายจ่าย', 'หลักฐานรายจ่ายรอตรวจ']);
});

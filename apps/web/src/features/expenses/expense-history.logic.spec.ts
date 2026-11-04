import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseHistoryActionLabel, expenseHistoryActorLabel } from './expense-history.logic';

describe('expense history rows', () => {
  it('PWS-HISTORY-WORDS uses plain labels for voiding an expense and saving a VAT answer', () => {
    assert.equal(expenseHistoryActionLabel('expense.void'), 'ยกเลิกเอกสารรายจ่าย');
    assert.equal(expenseHistoryActionLabel('expense.input_vat.decide'), 'บันทึกคำตอบเรื่อง VAT');
  });

  it('uses concise labels for upload and expense edits across web and LINE', () => {
    for (const action of ['expense.upload.complete', 'expense.line_upload.receive', 'expense.upload_intent.create']) {
      assert.equal(expenseHistoryActionLabel(action), 'อัปโหลดไฟล์', action);
    }
    for (const action of ['expense.review.update', 'expense.update', 'expense.line_draft.answer', 'expense.line_ai.draft_update']) {
      assert.equal(expenseHistoryActionLabel(action), 'แก้ไขรายการจ่าย', action);
    }
    assert.equal(expenseHistoryActionLabel('expense.line_ai.draft_preview'), 'ดูตัวอย่างรายการจ่าย');
  });

  it('keeps unknown actions safe and names actors whose display name is missing', () => {
    assert.equal(expenseHistoryActionLabel('internal.payload.secret'), 'กิจกรรมในรายการจ่าย');
    assert.equal(expenseHistoryActorLabel('SYSTEM', null), 'ระบบ');
    assert.equal(expenseHistoryActorLabel('USER', null), 'ผู้ใช้ที่ไม่ทราบชื่อ');
    assert.equal(expenseHistoryActorLabel('USER', '  Mali  '), 'Mali');
  });
});

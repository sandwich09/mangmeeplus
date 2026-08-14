import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodCloseCheckCopy } from './ledger.logic.js';

describe('period close check presentation', () => {
  it('maps every stable check key to actionable Thai copy', () => {
    for (const checkKey of [
      'no_draft_journals',
      'trial_balance_balanced',
      'source_postings_complete',
      'no_source_posting_errors',
      'chart_conflict_remediation_clear',
      'chart_semantics_valid',
      'suspense_balance_zero',
      'tax_account_mapping_valid',
      'transaction_tax_reconciliation_clear',
      'reimbursement_postings_complete',
    ]) {
      const copy = periodCloseCheckCopy({ checkKey, status: 'FAILED', count: 2, amount: '10.00' });
      assert.notEqual(copy.label, 'การตรวจสอบก่อนปิดงวด', checkKey);
      assert.equal(copy.statusLabel, 'ไม่ผ่าน', checkKey);
      assert.match(copy.message, /กรุณา/, checkKey);
    }
  });

  it('never renders an unknown check message from the server', () => {
    assert.deepEqual(
      periodCloseCheckCopy({ checkKey: 'database_secret_check', status: 'FAILED' }),
      {
        label: 'การตรวจสอบก่อนปิดงวด',
        statusLabel: 'ไม่ผ่าน',
        message: 'รายการนี้ยังไม่พร้อมสำหรับการปิดงวด กรุณาติดต่อผู้ดูแลระบบ',
      },
    );
  });

  it('uses reviewed passed copy instead of the response message', () => {
    assert.deepEqual(periodCloseCheckCopy({ checkKey: 'source_postings_complete', status: 'PASSED' }), {
      label: 'การลงบัญชีเอกสารต้นทาง',
      statusLabel: 'ผ่าน',
      message: 'เอกสารที่เสร็จสิ้นลงบัญชีครบแล้ว',
    });
  });
});

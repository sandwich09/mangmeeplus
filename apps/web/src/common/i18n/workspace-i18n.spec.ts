import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, getDefaultLocale } from './workspace-i18n.logic';

describe('workspace-i18n', () => {
  it('qualifies check-bill evidence and requires separate actual cash proof without denying the underlying expense', () => {
    assert.match(t('expenses.check_bill_description', 'th'), /เอกสารนี้ใช้เป็นหลักฐานยืนยันค่าใช้จ่ายโดยลำพังไม่ได้/);
    assert.doesNotMatch(t('expenses.check_bill_description', 'th'), /ส่งตรวจหรือบันทึกบัญชีไม่ได้/);
    assert.match(t('expenses.check_bill_description', 'en'), /document alone cannot substantiate/);
    assert.match(t('expenses.check_bill_new_draft_note', 'th'), /รายการเดิม.*ไม่สร้างรายการซ้ำ.*หลักฐานการชำระเงินจริง.*เงินสด/);
    assert.match(t('expenses.check_bill_new_draft_note', 'en'), /same expense.*No duplicate.*actual payment.*cash/);
    assert.match(t('expenses.substitute_wizard.payment_evidence_required', 'th'), /เช็กบิล.*ทุกวิธีชำระ.*เงินสด.*รายการทั่วไป/);
    assert.match(t('expenses.substitute_wizard.payment_evidence_required', 'en'), /Check bills.*every payment method.*cash.*Ordinary expenses/);
  });
  it('names username consistently in the login label and required-field message in both locales', () => {
    assert.equal(t('auth.login.identifier', 'th'), 'ชื่อผู้ใช้');
    assert.equal(t('auth.login.error.identifier_required', 'th'), 'กรุณากรอกชื่อผู้ใช้');
    assert.equal(t('auth.login.identifier', 'en'), 'Username');
    assert.equal(t('auth.login.error.identifier_required', 'en'), 'Enter your username.');
  });

  it('returns Thai string for th locale', () => {
    assert.strictEqual(t('dashboard.title', 'th'), 'แดชบอร์ด');
  });

  it('returns English string for en locale', () => {
    assert.strictEqual(t('dashboard.title', 'en'), 'Dashboard');
  });

  it('getDefaultLocale returns th', () => {
    assert.strictEqual(getDefaultLocale(), 'th');
  });

  // WEB-05: the receipt upload form writes `expenseDate`, so the label must name the date printed
  // on the paper. It used to read "วันที่อัพโหลดใบเสร็จ", which invited today's date instead.
  it('names the receipt date field after the date on the receipt, with an example', () => {
    assert.strictEqual(t('expenses.upload_receipt_date', 'th'), 'วันที่ในใบเสร็จ');
    assert.doesNotMatch(t('expenses.upload_receipt_date', 'th'), /อัพโหลด|อัปโหลด/);
    assert.match(t('expenses.upload_receipt_date_hint', 'th'), /ไม่ใช่วันนี้/);
  });

  it('falls back to key for unknown key (cast as any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(t('not.a.real.key' as any, 'th'), 'not.a.real.key');
  });
});

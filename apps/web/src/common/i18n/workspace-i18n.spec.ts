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
  // P10: the same box has always accepted the email as well, and an owner arriving from the claim
  // email has only ever been told their email. The label and the required-field message name both.
  it('names both accepted identifiers in the login label and required-field message, in both locales', () => {
    assert.equal(t('auth.login.identifier', 'th'), 'ชื่อผู้ใช้ หรือ อีเมล');
    assert.equal(t('auth.login.error.identifier_required', 'th'), 'กรุณากรอกชื่อผู้ใช้ หรืออีเมล');
    assert.equal(t('auth.login.identifier', 'en'), 'Username or email');
    assert.equal(t('auth.login.error.identifier_required', 'en'), 'Enter your username or email.');
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
    assert.match(t('expenses.upload_receipt_date_hint', 'th'), /เว้นว่างให้ AI อ่าน/);
  });

  it('falls back to key for unknown key (cast as any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(t('not.a.real.key' as any, 'th'), 'not.a.real.key');
  });
});

/**
 * Remediation spec §9.2 (web) / B-03. The upload and review screens must say WHY the AI did not read
 * the document, in words that never turn a money decision into an outage, never call a shortfall
 * "used up", and never promise an automatic retry. Both locales, or half the users get a key name.
 */
describe('AI money refusal copy on the expense screens', () => {
  for (const locale of ['th', 'en'] as const) {
    it(`explains each money reason without mixing them up (${locale})`, () => {
      const keys = [
        'expenses.extract_ai_budget_exceeded',
        'expenses.extract_ai_budget_ocr_exceeded',
        'expenses.extract_ai_budget_insufficient',
        'expenses.extract_ai_budget_unavailable',
        'expenses.extract_ai_budget_busy',
      ] as const;
      const texts = keys.map((key) => t(key, locale));
      for (const [index, text] of texts.entries()) {
        assert.notEqual(text, keys[index], `${keys[index]} is missing from the ${locale} dictionary`);
        // The file is kept and manual entry stays open on every one of them.
        assert.match(text, locale === 'th' ? /เอกสารถูกเก็บแล้ว/ : /it is saved/);
        assert.equal(/satang|สตางค์|บาท|THB/.test(text), false, `${keys[index]} must not name money`);
      }
      assert.equal(new Set(texts).size, texts.length, 'each reason reads differently');
      // A shortfall is never "used up", and an unreadable meter never claims the budget is full.
      assert.equal(/used up|ใช้ครบ|เต็ม/.test(t('expenses.extract_ai_budget_insufficient', locale)), false);
      assert.equal(/used up|ใช้ครบ|เต็ม/.test(t('expenses.extract_ai_budget_unavailable', locale)), false);
      // …and none of them borrows the OCR read-count wording, which is a different ceiling.
      assert.equal(t('expenses.extract_ai_budget_exceeded', locale) === t('expenses.extract_ocr_limit', locale), false);
    });
  }
});

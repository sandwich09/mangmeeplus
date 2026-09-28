/**
 * RV28/G09: the package page used to keep its own code → Thai list, and any code missing from it
 * read "ยังยืนยันผลรายการไม่ได้…" whatever had actually happened. The list below is read from the
 * API source, so a new `billingError('X')` without Thai fails here before a customer sees it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BILLING_GENERIC_ERROR, billingResendText, errorText } from './billing-error-text';

const BILLING_MODULE = join(__dirname, '../../../../api/src/modules/billing');

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

const billingCodes = [...new Set(sourceFiles(BILLING_MODULE).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/billingError\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g)].map((match) => match[1]!)))].sort();

describe('package page error text', () => {
  it('finds the billing codes at all, so a moved path fails loudly instead of passing empty', () => {
    assert.ok(billingCodes.length > 50, `only ${billingCodes.length} codes found — check BILLING_MODULE`);
  });

  it('answers every billingError code with its own Thai, never the generic sentence or a code', () => {
    const unexplained = billingCodes.filter((code) => {
      const text = errorText({ code, status: 409 });
      return text === BILLING_GENERIC_ERROR || /[A-Z_]{4,}/.test(text);
    });
    assert.deepEqual(unexplained, []);
  });

  it('answers the recipient-code and resend codes in Thai', () => {
    for (const code of ['BILLING_RESEND_LIMIT', 'BILLING_RESEND_UNAVAILABLE', 'BILLING_RECIPIENT_BOUNCED', 'BILLING_RECIPIENT_UNAVAILABLE',
      'BILLING_RECIPIENT_UNCHANGED', 'BILLING_RECIPIENT_PROOF_INVALID', 'EMAIL_OTP_TARGET_INVALID', 'EMAIL_OTP_RATE_LIMITED',
      'EMAIL_DELIVERY_UNAVAILABLE', 'EMAIL_OTP_INVALID', 'EMAIL_OTP_EXPIRED', 'EMAIL_OTP_ATTEMPTS_EXCEEDED', 'EMAIL_OTP_NOT_FOUND',
      'EMAIL_REAUTH_REQUIRED', 'EMAIL_STATE_CHANGED']) {
      const text = errorText({ code, status: code.endsWith('_LIMIT') || code === 'EMAIL_OTP_RATE_LIMITED' ? 429 : 409 });
      assert.notEqual(text, BILLING_GENERIC_ERROR, code);
      assert.notEqual(text, 'กรุณารอสักครู่แล้วลองใหม่', code);
    }
  });

  it('keeps the status answers and the generic throttle sentence', () => {
    assert.equal(errorText({ status: 401 }), 'กรุณาเข้าสู่ระบบอีกครั้ง');
    assert.match(errorText({ status: 403, code: 'BILLING_QUOTE_STALE' }), /ยังไม่มีสิทธิ์/);
    assert.equal(errorText({ status: 429 }), 'กรุณารอสักครู่แล้วลองใหม่');
    assert.equal(errorText({ status: 429, code: 'BILLING_RATE_LIMIT' }), 'กรุณารอสักครู่แล้วลองใหม่');
  });

  it('never passes an unmapped API sentence through (F14)', () => {
    assert.equal(errorText({ status: 503, code: 'BILLING_PROVIDER_UNAVAILABLE', message: 'temporary provider outage' }), BILLING_GENERIC_ERROR);
    assert.equal(errorText(new Error('Unexpected provider URL')), BILLING_GENERIC_ERROR);
  });

  it('says what the QR-member refusal means and drops the dead legacy mapping', () => {
    assert.match(errorText({ code: 'BILLING_PLAN_CHANGE_REQUIRED' }), /บิล QR/);
    assert.equal(errorText({ code: 'BILLING_LEGACY_REVIEW_REQUIRED' }), BILLING_GENERIC_ERROR);
    assert.match(errorText({ code: 'BILLING_REPEAT_NOT_READY' }), /ระหว่างรอบ/);
  });
});

describe('resend result copy', () => {
  it('says the receipt went again only when Stripe resent it', () => {
    assert.equal(billingResendText({ invoiceSent: true, receiptUpdated: true, recipientEmail: 'a@example.test', remainingToday: 2 }),
      'ส่งเอกสารไปที่ a@example.test แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก 2 ครั้ง');
    assert.match(billingResendText({ invoiceSent: true, receiptUpdated: false, recipientEmail: 'a@example.test', remainingToday: 0 }),
      /^ส่งใบแจ้งหนี้ไปที่ a@example\.test แล้ว ใบเสร็จไม่ส่งซ้ำ.* วันนี้ส่งซ้ำได้อีก 0 ครั้ง$/);
  });
});

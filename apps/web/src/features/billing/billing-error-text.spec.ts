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
    assert.equal(errorText({ status: 409, code: 'BILLING_SOMETHING_NEW', message: 'raw server sentence' }), BILLING_GENERIC_ERROR);
    assert.equal(errorText(new Error('Unexpected provider URL')), BILLING_GENERIC_ERROR);
  });

  // Review 2026-09-29: a dropped connection or a 5xx read as "cannot confirm — contact the team with
  // the reference", which sent owners to the phone for an outage. Those are the shared retry sentences.
  it('answers a network failure and a 5xx with the shared retry sentences, never the team-and-reference one', () => {
    const outage = errorText({ status: 503, code: 'BILLING_PROVIDER_UNAVAILABLE', message: 'temporary provider outage' });
    assert.match(outage, /ยังไม่พร้อมใช้งาน/);
    assert.match(errorText({ status: 500, message: 'Internal server error' }), /ระบบขัดข้องชั่วคราว/);
    assert.match(errorText({ status: 502 }), /เชื่อมต่อระบบไม่ได้ชั่วคราว/);
    assert.match(errorText({ kind: 'network_error', message: 'Network request failed.' }), /ตรวจอินเทอร์เน็ต/);
    for (const text of [outage, errorText({ status: 500 }), errorText({ kind: 'network_error' })]) {
      assert.notEqual(text, BILLING_GENERIC_ERROR);
      assert.doesNotMatch(text, /เลขอ้างอิง/);
    }
    // A code the page knows still wins over the bare status.
    assert.equal(errorText({ status: 503, code: 'BILLING_CHECKOUT_PENDING' }), 'ระบบกำลังตรวจรายการจ่ายเงินเดิมกับผู้ให้บริการรับเงิน รอสักครู่แล้วกดลองอีกครั้ง');
  });

  it('says what the QR-member refusal means and drops the dead legacy mapping', () => {
    assert.match(errorText({ code: 'BILLING_PLAN_CHANGE_REQUIRED' }), /บิล QR/);
    assert.equal(errorText({ code: 'BILLING_LEGACY_REVIEW_REQUIRED' }), BILLING_GENERIC_ERROR);
    assert.match(errorText({ code: 'BILLING_REPEAT_NOT_READY' }), /ระหว่างรอบ/);
  });

  // The promotion codes have no page-specific copy: the purchase page and the admin screens read the same shared sentence.
  it('answers the promotion campaign codes with their exact Thai', () => {
    for (const [code, text] of [
      ['PROMOTION_UNAVAILABLE', 'โปรโมชั่นนี้ใช้ไม่ได้แล้ว กรุณาตรวจสอบรายการใหม่'],
      ['PROMOTION_UPGRADE_DEFERRED', 'แพ็กเกจนี้อยู่ในช่วงสิทธิ์โปรโมชั่น อัปเกรดได้หลังสิทธิ์ที่ซื้อไว้สิ้นสุด'],
      ['CONTROL_PROMOTION_INVALID', 'ข้อมูลแคมเปญยังไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่'],
      ['CONTROL_PROMOTION_NOT_FOUND', 'ไม่พบแคมเปญนี้ กรุณาโหลดรายการแคมเปญใหม่'],
      ['CONTROL_PROMOTION_ENDED', 'แคมเปญนี้จบแล้ว แก้ไขหรือเปิดใหม่ไม่ได้ กรุณาสร้างแคมเปญใหม่'],
      ['CONTROL_PROMOTION_OVERLAP', 'มีแคมเปญอื่นของแพ็กเกจและรอบเดียวกันในช่วงเวลานี้แล้ว'],
      ['CONTROL_PROMOTION_CAP_BELOW_USED', 'ลดจำนวนสิทธิ์ต่ำกว่าที่มีผู้จองหรือใช้ไปแล้วไม่ได้'],
      ['CONTROL_PROMOTION_CATALOG_STALE', 'ราคาหรือโควตาของแพ็กเกจเปลี่ยนแล้ว กรุณาตรวจสอบตัวอย่างและเผยแพร่แคมเปญใหม่'],
    ] as const) {
      assert.equal(errorText({ code, status: 409 }), text, code);
    }
  });
});

describe('resend result copy', () => {
  it('says the receipt went again only when Stripe resent it', () => {
    assert.equal(billingResendText({ invoiceSent: true, receiptUpdated: true, recipientEmail: 'a@example.test', remainingToday: 2 }),
      'ส่งเอกสารไปที่ a@example.test แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก 2 ครั้ง');
    assert.match(billingResendText({ invoiceSent: true, receiptUpdated: false, recipientEmail: 'a@example.test', remainingToday: 0 }),
      /^ส่งใบแจ้งหนี้ไปที่ a@example\.test แล้ว ใบเสร็จไม่ส่งซ้ำ.* วันนี้ส่งซ้ำได้อีก 0 ครั้ง$/);
  });

  // The recipient panel has no resend button above this text (only the documents page does), so it
  // must not point at one.
  it('points the recipient panel at payment history instead of a button it does not have', () => {
    const result = { invoiceSent: true, receiptUpdated: false, recipientEmail: 'a@example.test', remainingToday: 3 } as const;
    const documents = billingResendText(result), recipient = billingResendText(result, 'recipient');
    assert.match(documents, /เปิดได้จากปุ่มด้านบน/);
    assert.doesNotMatch(recipient, /ปุ่มด้านบน/);
    assert.match(recipient, /ประวัติการจ่ายเงิน/);
    assert.match(recipient, /^ส่งใบแจ้งหนี้ไปที่ a@example\.test แล้ว.* วันนี้ส่งซ้ำได้อีก 3 ครั้ง$/);
  });
});

/**
 * RV28/G09: the package page used to keep its own code → Thai list, and any code missing from it
 * read "ยังยืนยันผลรายการไม่ได้…" whatever had actually happened. The list below is read from the
 * API source, so a new `billingError('X')` without Thai fails here before a customer sees it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateApiError } from '@/common/api/api-error-message';
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
    assert.equal(errorText({ status: 401 }), 'ยังยืนยันการเข้าสู่ระบบไม่ได้ เข้าสู่ระบบอีกครั้ง');
    assert.match(errorText({ status: 403, code: 'BILLING_QUOTE_STALE' }), /ยังเปิดรายการนี้ไม่ได้/);
    assert.equal(errorText({ status: 429 }), 'ทำรายการถี่เกินไป รอสักครู่แล้วลองอีกครั้ง');
    assert.equal(errorText({ status: 429, code: 'BILLING_RATE_LIMIT' }), 'ทำรายการถี่เกินไป รอสักครู่แล้วลองรายการเดิมอีกครั้ง');
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

  it('gives plan-change guidance that applies to both QR and card purchases and drops the dead legacy mapping', () => {
    assert.equal(errorText({ code: 'BILLING_PLAN_CHANGE_REQUIRED' }), 'ยังซื้อหรือเปลี่ยนแพ็กเกจด้วยรายการนี้ไม่ได้ ตรวจการต่ออายุก่อนเลือกแพ็กเกจอีกครั้ง');
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

const customerBillingCodes = [
  'BILLING_RECIPIENT_UPDATE_REQUIRED', 'BILLING_EMAIL_CHANGED', 'BILLING_EMAIL_VERIFICATION_REQUIRED',
  'BILLING_EMAIL_UPDATE_PENDING', 'BILLING_RESEND_LIMIT', 'BILLING_RESEND_UNAVAILABLE',
  'BILLING_RECIPIENT_UNAVAILABLE', 'BILLING_RECIPIENT_UNCHANGED', 'BILLING_RECIPIENT_PROOF_INVALID',
  'BILLING_RECIPIENT_BOUNCED', 'BILLING_RATE_LIMIT', 'BILLING_NOT_CONFIGURED',
  'BILLING_PLAN_CHANGE_REQUIRED', 'BILLING_COMPANY_SALES_CLOSED', 'BILLING_SALES_CLOSED',
  'BILLING_QUOTE_STALE', 'BILLING_CAP_SELECTION_REQUIRED', 'BILLING_CHECKOUT_PENDING',
  'BILLING_PURCHASE_PENDING', 'BILLING_COLLECTION_PENDING', 'BILLING_COLLECTION_CLOSED',
  'BILLING_COLLECTION_REVIEW', 'BILLING_CONSENT_REQUIRED', 'BILLING_DOCUMENT_BINDING',
  'BILLING_EXISTING_SUBSCRIPTION', 'BILLING_IDEMPOTENCY_CONFLICT', 'BILLING_IDEMPOTENCY_REQUIRED',
  'BILLING_MAPPING_MISMATCH', 'BILLING_MODE_CHANGE_PENDING', 'BILLING_OFFER_UNAVAILABLE',
  'BILLING_PACKAGE_STATE_INVALID', 'BILLING_PLAN_CHANGE_PENDING', 'BILLING_PRICE_MISMATCH',
  'BILLING_REPEAT_REVIEW', 'BILLING_TAX_MISMATCH', 'BILLING_UPGRADE_BOUNDARY',
  'BILLING_UPGRADE_GIFT_ONLY', 'BILLING_UPGRADE_REVIEW', 'BILLING_CHECKOUT_NOT_STARTED',
  'BILLING_CHECKOUT_INVOICE_MISMATCH', 'BILLING_INVOICE_MISMATCH', 'BILLING_CADENCE_PENDING_CHANGE',
  'BILLING_REPEAT_NOT_READY', 'BILLING_RESTART_REVIEW', 'BILLING_DOCUMENT_PENDING',
  'BILLING_PORTAL_UNAVAILABLE', 'BILLING_PORTAL_CONFIG_MISMATCH', 'BILLING_COMPANY_HELD',
  'BILLING_SOURCE_REVIEW_REQUIRED', 'BILLING_ENTITLEMENT_REVIEW_REQUIRED', 'BILLING_REFUND_PENDING',
  'BILLING_NOT_READY', 'BILLING_DEAL_EXPIRED', 'BILLING_DEAL_NOT_FOUND',
  'BILLING_DEAL_SNAPSHOT_MISMATCH', 'BILLING_MODE_NOT_READY', 'BILLING_COMPANY_PROFILE_REQUIRED',
  'BILLING_INPUT_INVALID',
] as const;
it('PAY-3 customer billing refusals use the shared plain Thai without page overrides', () => {
  for (const code of customerBillingCodes) {
    const text = errorText({ code, status: 409 });
    assert.doesNotMatch(text, /กรุณา|ดำเนินการ|ชำระ|บริษัท|ลองใหม่|[A-Z_]{4,}/, code);
    assert.notEqual(text, BILLING_GENERIC_ERROR, code);
    if (code !== 'BILLING_CHECKOUT_PENDING') assert.equal(text, translateApiError(code), code);
  }
});

it('PAY-3 admin-only billing sentences stay unchanged', () => {
  for (const [code, text] of [
    ["BILLING_SCAN_NOT_COMPLETE", "ยอดเงินของเดือนนี้ยังอ่านไม่ครบ"],
    ["BILLING_SOURCE_REVIEW", "ข้อมูลการชำระต้องตรวจสอบ"],
    ["BILLING_RECIPIENT_BUSY", "บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อน"],
    ["BILLING_RECIPIENT_NO_CUSTOMER", "บริษัทนี้ยังไม่มีบัญชีลูกค้ากับผู้ให้บริการรับชำระเงิน จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน"],
    ["BILLING_RECIPIENT_INVALID", "รูปแบบอีเมลไม่ถูกต้อง"],
    ["BILLING_LOOKUP_TOO_SHORT", "เลขอ้างอิงต้องมีอย่างน้อย 8 ตัวอักษร"],
    ["BILLING_LOOKUP_AMBIGUOUS", "เลขอ้างอิงนี้ตรงหลายรายการ ให้ใช้เลขใบแจ้งหนี้หรือรหัสเต็ม"],
    ["BILLING_LOOKUP_EVENT_TICKET_UNUSED", "ส่วนลดจากงานนี้ยังไม่ได้ใช้กับร้านใด จึงยังไม่มีร้านให้เปิดดู"],
    ["BILLING_END_PACKAGE_NOT_CURRENT", "รายการนี้ไม่ใช่การชำระของแพ็กเกจที่ร้านใช้งานอยู่ตอนนี้ จึงยุติแพ็กเกจจากรายการนี้ไม่ได้"],
    ["BILLING_END_PACKAGE_AUTO_RENEW", "ร้านนี้ยังเปิดต่ออายุอัตโนมัติอยู่ กรุณายกเลิกการต่ออายุก่อน แล้วจึงยุติแพ็กเกจ"],
    ["BILLING_END_PACKAGE_PENDING", "ร้านนี้มีรายการชำระเงินหรือแพ็กเกจล่วงหน้าที่ยังดำเนินการอยู่ ตรวจรายการนั้นให้เสร็จก่อน"],
    ["BILLING_END_PACKAGE_NOT_REFUNDED", "รายการนี้ยังคืนเงินไม่ครบเต็มจำนวน ยุติแพ็กเกจได้หลังคืนเงินครบแล้ว"],
  ] as const) assert.equal(translateApiError(code), text, code);
});

it('MONEY-Q1 below-minimum upgrade explains the ten-baht limit and the way forward', () => {
  const text = errorText({ code: 'BILLING_UPGRADE_BELOW_MINIMUM', status: 409 });
  assert.match(text, /ส่วนต่างต่ำกว่า 10\.00 บาท/);
  assert.match(text, /รอบต่ออายุ/);
  assert.match(text, /ติดต่อทีมงาน/);
});

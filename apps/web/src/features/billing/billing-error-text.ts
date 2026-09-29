import type { BillingDocumentResendResult } from '@watchdog-bms/contracts';
import { apiErrorCode, translateApiError } from '@/common/api/api-error-message';

export const BILLING_GENERIC_ERROR = 'ยังยืนยันผลรายการไม่ได้ กรุณาตรวจสอบสถานะหรือติดต่อทีมงานพร้อมเลขอ้างอิง';

/** Only what this page says differently from the shared map; every other code falls through to it. */
const PAGE_LABELS: Record<string, string> = {
  BILLING_PLAN_CHANGE_REQUIRED: 'แพ็กเกจปัจจุบันชำระด้วยบิล QR ทุกงวด ซื้อหรือเปลี่ยนแพ็กเกจใหม่ได้เมื่อรอบปัจจุบันสิ้นสุด หรือจัดการบิลในแท็บการต่ออายุและชำระเงิน',
  BILLING_CAP_SELECTION_REQUIRED: 'จำนวนสาขาหรือผู้ใช้เกินแพ็กเกจที่เลือก กรุณาจัดการสิทธิ์หรือติดต่อทีมงานก่อนยืนยัน',
  // R-A1: ลบใน release ถัดไป — the API no longer answers these to a purchase; an older server may, for one release.
  BILLING_COMPANY_PROFILE_REQUIRED: 'กรุณากรอกข้อมูลบริษัทให้ครบก่อนซื้อแพ็กเกจ',
  BILLING_RECIPIENT_UPDATE_REQUIRED: 'กรุณาตรวจและยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้ในส่วนอีเมล แล้วตรวจสรุปการชำระเงินใหม่',
  BILLING_EMAIL_CHANGED: 'กรุณาผูกและยืนยันอีเมลให้เรียบร้อย แล้วตรวจสรุปการชำระเงินใหม่',
  BILLING_EMAIL_VERIFICATION_REQUIRED: 'กรุณาผูกและยืนยันอีเมลให้เรียบร้อย แล้วตรวจสรุปการชำระเงินใหม่',
};

export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** Thai for the package page: status → this page's wording → the shared map → this page's generic sentence.
 *  Never an API sentence (spec §12 error): an unmapped code reads as the generic one. */
export function errorText(error: unknown): string {
  const status = errorStatus(error), code = apiErrorCode(error);
  if (status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจและการชำระเงินของบริษัท';
  if (status === 429 && code !== 'BILLING_RESEND_LIMIT' && code !== 'EMAIL_OTP_RATE_LIMITED') return 'กรุณารอสักครู่แล้วลองใหม่';
  if (!code) return BILLING_GENERIC_ERROR;
  return (Object.hasOwn(PAGE_LABELS, code) ? PAGE_LABELS[code] : translateApiError(code)) ?? BILLING_GENERIC_ERROR;
}

/** pr-d §3.7: Stripe resends the receipt only when its email changed, so the sentence says which went.
 *  `context` picks the "open the receipt" clue: the documents page has its own resend button above this
 *  text; the recipient panel does not, so it points at the payment history instead. */
export function billingResendText(result: BillingDocumentResendResult, context: 'documents' | 'recipient' = 'documents'): string {
  if (result.receiptUpdated) return `ส่งเอกสารไปที่ ${result.recipientEmail} แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`;
  return context === 'recipient'
    ? `ส่งใบแจ้งหนี้ไปที่ ${result.recipientEmail} แล้ว ใบเสร็จไม่ได้ส่งซ้ำเพราะอีเมลยังเป็นอีเมลเดิม เปิดใบเสร็จได้ที่ประวัติการชำระเงิน · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`
    : `ส่งใบแจ้งหนี้ไปที่ ${result.recipientEmail} แล้ว ใบเสร็จไม่ส่งซ้ำเพราะอีเมลไม่เปลี่ยน เปิดได้จากปุ่มด้านบน · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`;
}

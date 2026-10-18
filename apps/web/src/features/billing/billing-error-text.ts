import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import type { BillingDocumentResendResult } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage, translateApiError } from '@/common/api/api-error-message';

export const BILLING_GENERIC_ERROR = 'ยังยืนยันผลรายการไม่ได้ ตรวจสถานะล่าสุดหรือติดต่อทีมงาน';

/** Only what this page says differently from the shared map; every other code falls through to it. */
const PAGE_LABELS: Record<string, string> = {
  // The retry button beside this page's request error says "ลองอีกครั้ง".
  BILLING_CHECKOUT_PENDING: 'ระบบกำลังตรวจรายการจ่ายเงินเดิมกับผู้ให้บริการรับเงิน รอสักครู่แล้วกดลองอีกครั้ง',
};

export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** Thai for the package page: status → this page's wording → the shared map → the shared network/5xx
 *  sentence → this page's generic sentence. Never an API sentence (spec §12 error): an unmapped code
 *  reads as the generic one. A dropped connection or a 5xx is not "a result we cannot confirm", so it
 *  never asks for the team and a reference — it says to try again. */
export function errorText(error: unknown): string {
  const status = errorStatus(error), code = apiErrorCode(error);
  if (status === 401) return 'ยังยืนยันการเข้าสู่ระบบไม่ได้ เข้าสู่ระบบอีกครั้ง';
  if (status === 403) return `บัญชีนี้ยังเปิดรายการนี้ไม่ได้ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ตรวจสิทธิ์หรือติดต่อทีมงาน`;
  if (status === 429 && code !== 'BILLING_RESEND_LIMIT' && code !== 'EMAIL_OTP_RATE_LIMITED') return code === 'BILLING_RATE_LIMIT' ? apiErrorMessage(error) : 'ทำรายการถี่เกินไป รอสักครู่แล้วลองอีกครั้ง';
  const mapped = code ? (Object.hasOwn(PAGE_LABELS, code) ? PAGE_LABELS[code] : translateApiError(code)) : null;
  if (mapped) return code?.startsWith('BILLING_') ? mapped.replaceAll('รับชำระเงิน', 'รับเงิน').replaceAll('ชำระ', 'จ่าย') : mapped;
  if (status !== undefined && status >= 500) return apiErrorMessage({ status });
  if ((error as { kind?: unknown } | null)?.kind === 'network_error') return apiErrorMessage({ kind: 'network_error' });
  return BILLING_GENERIC_ERROR;
}

/** pr-d §3.7: Stripe resends the receipt only when its email changed, so the sentence says which went.
 *  `context` picks the "open the receipt" clue: the documents page has its own resend button above this
 *  text; the recipient panel does not, so it points at the payment history instead. */
export function billingResendText(result: BillingDocumentResendResult, context: 'documents' | 'recipient' = 'documents'): string {
  if (result.receiptUpdated) return `ส่งเอกสารไปที่ ${result.recipientEmail} แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`;
  return context === 'recipient'
    ? `ส่งใบแจ้งหนี้ไปที่ ${result.recipientEmail} แล้ว ใบเสร็จไม่ได้ส่งซ้ำเพราะอีเมลยังเป็นอีเมลเดิม เปิดใบเสร็จได้ที่ประวัติการจ่ายเงิน · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`
    : `ส่งใบแจ้งหนี้ไปที่ ${result.recipientEmail} แล้ว ใบเสร็จไม่ส่งซ้ำเพราะอีเมลไม่เปลี่ยน เปิดได้จากปุ่มด้านบน · วันนี้ส่งซ้ำได้อีก ${result.remainingToday} ครั้ง`;
}

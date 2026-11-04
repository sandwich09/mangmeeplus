// Pure helpers for the tax workspace page. No API calls, no React — see
// docs/guidelines/web-frontend-code-style.md.

/**
 * §11.4 / §8 (D2): the ภ.พ.30 workpaper checklist line links into the expense list scoped to the
 * selected VAT period. `TaxPeriod.periodKey` is the only date the period carries for a monthly
 * form — the API's `formPeriodKey()` (tax-period.logic.ts) writes it as 'YYYY-MM' for PP30/PND3/
 * PND53 — so this turns that key into civil day bounds the same way `periodRange()` in
 * ExpensesPages.tsx turns its own month picker into a range. Annual ('YYYY') and half-year
 * ('YYYY-Hn') CIT keys are not this shape and correctly return null — only PP30 uses this today.
 */
export function monthlyPeriodDateRange(periodKey: string): { fromDate: string; toDate: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const [, year, month] = match;
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  const lastDay = new Date(Number(year), monthNum, 0).getDate();
  return { fromDate: `${year}-${month}-01`, toDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
}

/** PND53 reads stored machine values; unknown values must not become user-facing codes. */
const TAX_PERIOD_STATUS_LABELS: Record<string, string> = {
  OPEN: 'ยังไม่ได้ยื่น', NEEDS_REVIEW: 'ต้องตรวจสอบ', READY_FOR_REVIEW: 'พร้อมตรวจสอบ', AMENDED: 'ปรับปรุงแบบแล้ว', REVIEWED: 'ตรวจสอบแล้ว', EXPORTED: 'ส่งออกแล้ว',
  FILED: 'ยื่นแบบแล้ว', PAID: 'ชำระแล้ว', CLOSED: 'ปิดงวด',
};
export function taxPeriodStatusLabel(status: string): string {
  return TAX_PERIOD_STATUS_LABELS[status] ?? 'ไม่ทราบสถานะ';
}

const TAX_REVIEW_ISSUE_LABELS: Record<string, string> = {
  MISSING_TAX_ID: 'ยังไม่มีเลขประจำตัวผู้เสียภาษี ตรวจข้อมูลต้นทาง',
  MISSING_BRANCH_CODE: 'ยังไม่มีรหัสสาขาภาษี ตรวจข้อมูลต้นทาง',
  UNKNOWN_VAT_MODE: 'ยังระบุวิธีคิด VAT ไม่ได้ ตรวจข้อมูลต้นทาง',
  INPUT_VAT_NOT_CLAIMABLE: 'ภาษีซื้อของรายการนี้ใช้ขอคืนไม่ได้',
  WHT_RATE_MISMATCH: 'ตรวจอัตรา',
  MISSING_TAX_INVOICE: 'ยังไม่มีข้อมูลอ้างอิงใบกำกับภาษี ตรวจข้อมูลต้นทาง',
  DUPLICATE_SOURCE: 'พบรายการต้นทางซ้ำ ตรวจสอบก่อนออกแบบ',
  CLOSED_PERIOD_CONFLICT: 'รายการต้นทางอยู่ในงวดที่ปิดแล้ว ตรวจสอบก่อนออกแบบ',
  MISSING_LEDGER_DATA: 'ยังไม่มีข้อมูลบัญชีที่ใช้ตรวจสอบรายการนี้',
  INCOMPLETE_SOURCE_FACTS: 'ข้อมูลต้นทางยังไม่ครบ ตรวจสอบก่อนออกแบบ',
  FUNCTIONAL_CURRENCY_FX_MISSING: 'ข้อมูลแปลงสกุลเงินของรายการต้นทางยังไม่ครบ ตรวจสอบก่อนออกแบบ',
  FUNCTIONAL_CURRENCY_SNAPSHOT_INVALID: 'ข้อมูลสกุลเงินไม่ตรงกับบริษัทหรือเอกสารต้นทาง ตรวจสอบก่อนออกแบบ',
  VOID_AFTER_TAX_PERIOD_LOCK: 'เอกสารต้นทางถูกยกเลิกหลังปิดงวดภาษี ตรวจขั้นตอนปรับปรุงรายการ',
  SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK: 'ข้อมูลภาษีต้นทางเปลี่ยนหลังปิดงวดภาษี ตรวจขั้นตอนปรับปรุงรายการ',
  TAX_EVIDENCE_NOT_VERIFIED: 'ยังไม่ได้ตรวจรับรองหลักฐานภาษีของรายการต้นทาง',
};
export function taxReviewIssueLabel(code: string): string {
  return TAX_REVIEW_ISSUE_LABELS[code] ?? 'พบรายการที่ต้องตรวจสอบ ให้ผู้มีสิทธิ์จัดทำแบบภาษีตรวจข้อมูลต้นทาง';
}

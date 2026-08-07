import type {
  TaxCodeDefinitionDto,
  TaxConfigurationStatus,
  TaxHeaderSummary,
  TransactionTaxContext,
  TransactionTaxDirection,
  TransactionTaxSnapshot,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';

export const TAX_CONTEXT_LABELS: Record<TransactionTaxContext, string> = {
  DOMESTIC_SALE: 'ขายในประเทศ',
  DOMESTIC_PURCHASE: 'ซื้อในประเทศ',
  IMPORT_GOODS: 'นำเข้าสินค้า',
  IMPORT_SERVICE: 'บริการจากต่างประเทศ / ภ.พ.36',
  EXPORT_GOODS: 'ส่งออกสินค้า',
  EXPORT_SERVICE: 'ส่งออกบริการ',
  RETURN_OR_CREDIT: 'คืนสินค้า / ใบลดหนี้',
  DEBIT_ADJUSTMENT: 'ใบเพิ่มหนี้',
  MANUAL_TAX_ADJUSTMENT: 'ปรับปรุงภาษี',
};

export const TAX_STATUS_LABELS: Record<TaxConfigurationStatus | 'ACTIVE' | 'RETIRED', string> = {
  DRAFT: 'ร่าง',
  REVIEW_REQUIRED: 'รอตรวจสอบ',
  ACTIVE: 'ใช้งาน',
  RETIRED: 'เลิกใช้',
};

export type TransactionTaxCapabilities = {
  canReadProfiles: boolean;
  canManageProfiles: boolean;
  canReadConfig: boolean;
  canManageConfig: boolean;
  canReadAccountRules: boolean;
  canManageAccountRules: boolean;
  canReadReports: boolean;
  canRecomputeReports: boolean;
  canReviewIssues: boolean;
  canPrepareEvidence: boolean;
  canVerifyEvidence: boolean;
};

export function transactionTaxCapabilities(permissions: string[]): TransactionTaxCapabilities {
  const has = (permission: string) => permissions.includes(permission);
  return {
    canReadProfiles: has('tax.profile.read'),
    canManageProfiles: has('tax.profile.manage'),
    canReadConfig: has('tax.config.read'),
    canManageConfig: has('tax.config.manage'),
    canReadAccountRules: has('ledger.posting-rule.read'),
    canManageAccountRules: has('tax.config.manage') && has('ledger.posting-rule.manage'),
    canReadReports: has('tax.report.read'),
    canRecomputeReports: has('tax.report.recompute'),
    canReviewIssues: has('tax.review_issue.resolve'),
    canPrepareEvidence: has('tax.config.manage') || has('tax.review_issue.resolve'),
    canVerifyEvidence: has('tax.config.manage'),
  };
}

function dateInWindow(date: string, from: string, to: string | null): boolean {
  const value = new Date(date).getTime();
  return value >= new Date(from).getTime() && (!to || value <= new Date(to).getTime());
}

export function availableTaxDefinitions(
  definitions: TaxCodeDefinitionDto[],
  input: { context: TransactionTaxContext; direction: TransactionTaxDirection; documentDate: string },
): TaxCodeDefinitionDto[] {
  return definitions
    .filter((definition) => definition.status === 'ACTIVE')
    .filter((definition) => definition.direction === input.direction || definition.direction === 'SELF_ASSESSED')
    .filter((definition) => definition.transactionContexts.includes(input.context))
    .filter((definition) => dateInWindow(input.documentDate, definition.effectiveFrom, definition.effectiveTo))
    .sort((a, b) => a.externalCode.localeCompare(b.externalCode));
}

export function deriveTaxHeaderSummary(
  lines: Array<{ taxSnapshot?: TransactionTaxSnapshot | null; taxCodeDefinitionId?: string | null }>,
): TaxHeaderSummary {
  const ids = new Set(
    lines
      .map((line) => line.taxSnapshot?.taxCodeDefinitionId ?? line.taxCodeDefinitionId ?? null)
      .filter((id): id is string => Boolean(id)),
  );
  if (ids.size === 0) return 'NONE';
  return ids.size === 1 ? 'SINGLE' : 'MIXED';
}

export function isTaxSourceLocked(status?: string | null): boolean {
  return Boolean(status && [
    'ISSUED', 'VOIDED', 'CREDITED', 'DEBITED', 'CLOSED',
    'CONFIRMED', 'POSTED', 'APPROVED', 'PAID', 'FILED',
  ].includes(status));
}

export function isReceiptTaxCodeAllowed(documentType: string): boolean {
  return ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType);
}

/**
 * ภ.พ.30 box 8/9 are only meaningful once the sales side (box 1–5) has data. The launch package
 * records purchases only, so box 9 would otherwise read "ชำระเกิน" = the whole month's input VAT —
 * an invitation to file a refund claim off a number the system knows is one-sided.
 */
export function pp30SalesSideRecorded(
  boxes: Pick<import('@watchdog-bms/contracts').Pp30BoxesDto,
    'box1TotalSales' | 'box2ZeroRatedSales' | 'box3ExemptSales' | 'box4TaxableSales' | 'box5OutputTax'>,
): boolean {
  return [boxes.box1TotalSales, boxes.box2ZeroRatedSales, boxes.box3ExemptSales, boxes.box4TaxableSales, boxes.box5OutputTax]
    .some((value) => Number(value) > 0);
}

/** Expense legacy VAT fields store 0.07; accounting/procurement store 7. */
export function taxDefinitionRateForSource(rate: string, source: 'expense' | 'accounting' | 'procurement'): string {
  return source === 'expense' ? String(Number(rate) / 100) : rate;
}

export function transactionTaxErrorMessage(error: unknown): string {
  const candidate = error as { status?: number; code?: string; message?: string; details?: { code?: string } };
  const code = candidate.code ?? candidate.details?.code;
  // A coded denial (e.g. feature_not_enabled) is a different truth than "no permission" —
  // let the shared map answer before the blanket status branches below.
  const shared = code ? translateApiError(code) : null;
  if (shared) return shared;
  if (candidate.status === 403) return 'คุณไม่มีสิทธิ์ดำเนินการนี้';
  if (candidate.status === 409) return 'ข้อมูลหรือช่วงวันที่ซ้ำกับการตั้งค่าที่มีอยู่ กรุณาโหลดใหม่';
  if (candidate.status === 422 && code === 'tax_profile_incomplete') return 'โปรไฟล์ยังขาดบัญชีหรือกฎรายงานที่จำเป็น';
  if (candidate.status === 422) return 'รายการภาษีต้องได้รับการตรวจสอบก่อนดำเนินการ';
  return candidate.message ?? 'เรียกข้อมูลภาษีไม่สำเร็จ';
}

/**
 * The Tax Code a line should open with, given the category its expense is filed under.
 *
 * A suggestion, never a decision (spec §5): it fills an empty picker and is written only when the
 * reviewer saves the line as they normally would.
 *
 * `available` MUST be the list the picker is already offering — the caller has run the
 * ACTIVE/direction/context/effective-date filter. Re-implementing that filter here would let the
 * two disagree and suggest a code the picker refuses to show.
 */
export function suggestedLineTaxCode(input: {
  categoryDefaultInputTaxCode: string | null;
  lineHasTaxCode: boolean;
  available: ReadonlyArray<{ externalCode: string }>;
}): string | null {
  // Never replace, clear or override what the reviewer already chose (spec §7.3).
  if (input.lineHasTaxCode || !input.categoryDefaultInputTaxCode) return null;
  // A code that no longer resolves — retired, wrong context, outside its date window — produces
  // nothing at all. A stale suggestion must not become a wrong pre-fill (spec §7.5).
  return input.available.some((item) => item.externalCode === input.categoryDefaultInputTaxCode)
    ? input.categoryDefaultInputTaxCode
    : null;
}

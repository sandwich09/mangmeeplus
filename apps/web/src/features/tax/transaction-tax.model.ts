import type {
  TaxCodeDefinitionDto,
  TaxConfigurationStatus,
  TaxHeaderSummary,
  TransactionTaxContext,
  TransactionTaxDirection,
  TransactionTaxSnapshot,
} from '@watchdog-bms/contracts';
import { apiErrorMessage, translateApiError } from '@/common/api/api-error-message';

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
  if (candidate.status === 403) return 'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากผู้ดูแลสิทธิ์';
  if (candidate.status === 409) return 'ข้อมูลหรือช่วงวันที่ซ้ำกับการตั้งค่าที่มีอยู่ เปิดหน้านี้ใหม่';
  if (candidate.status === 422 && code === 'tax_profile_incomplete') return 'โปรไฟล์ยังขาดบัญชีหรือกฎรายงานที่จำเป็น';
  if (candidate.status === 422) return 'ตรวจข้อมูลภาษีของรายการก่อนทำต่อ';
  if (error instanceof Error) return apiErrorMessage(error);
  if (candidate.message) {
    return apiErrorMessage(Object.assign(new Error(candidate.message), { status: candidate.status, code }));
  }
  return 'เรียกข้อมูลภาษีไม่สำเร็จ';
}

const TRANSACTION_TAX_DIAGNOSTIC_MESSAGES: Record<string, string> = {
  tax_code_not_active_or_not_applicable: 'Tax Code นี้ไม่พร้อมใช้กับรายการหรือวันที่เอกสาร เลือก Tax Code อื่น',
  tax_code_ambiguous: 'พบ Tax Code ที่ตรงกันมากกว่าหนึ่งรายการ ติดต่อผู้ดูแลการตั้งค่าภาษี',
  tax_account_rule_missing: 'Tax Code นี้ยังไม่ได้ผูกบัญชี ตั้งค่าบัญชีภาษีก่อนใช้งาน',
  tax_account_rule_ambiguous: 'Tax Code นี้ผูกบัญชีซ้ำกัน ตรวจสอบการตั้งค่าบัญชีภาษี',
  functional_currency_fx_required: 'รายการสกุลเงินต่างประเทศยังขาดอัตราแลกเปลี่ยน วันที่ หรือแหล่งที่มา',
  zero_tax_treatment_has_tax_amount: 'รายการภาษีอัตรา 0 ต้องไม่มียอดภาษี ตรวจสอบยอดเงิน',
  entered_tax_amount_outside_tolerance: 'ยอดภาษีที่กรอกต่างจากยอดที่ระบบคำนวณเกินกำหนด ตรวจสอบยอดภาษี',
  tax_evidence_required: 'รายการนี้ต้องแนบหลักฐานภาษีก่อนทำต่อ',
  tax_report_rule_missing: 'Tax Code นี้ยังไม่ได้ผูกช่องรายงานภาษี ตั้งค่ารายงานภาษี',
  partial_deductibility_split_policy_required: 'ภาษีซื้อที่ขอคืนได้บางส่วนยังขาดวิธีแบ่งยอด ตั้งค่านโยบายการแบ่งยอด',
  import_tax_destination_required: 'ภาษีนำเข้ายังไม่ได้ระบุว่าจะบันทึกเป็นค่าใช้จ่ายหรือสินทรัพย์',
};

/** Success payloads carry stable diagnostic codes, not user-facing copy. */
export function transactionTaxDiagnosticMessage(diagnostic: string, sourceType?: string, direction?: TransactionTaxDirection): string {
  const code = diagnostic.split(':', 1)[0] ?? '';
  if (sourceType === 'expense.record' && direction === 'INPUT') {
    if (code === 'tax_code_not_active_or_not_applicable') return 'รูปแบบ VAT นี้ใช้กับรายการหรือวันที่นี้ไม่ได้ เลือกรูปแบบอื่น';
    if (code === 'tax_evidence_required') return 'แนบเอกสารประกอบรายการนี้ก่อนทำต่อ';
    if (code === 'partial_deductibility_split_policy_required') return 'ยังตรวจยอด VAT ที่ใช้ตอนยื่นภาษีได้บางส่วนไม่ได้ ให้ผู้ทำบัญชีตรวจการตั้งค่า';
    if (['tax_code_ambiguous', 'tax_account_rule_missing', 'tax_account_rule_ambiguous', 'tax_report_rule_missing'].includes(code)
      || !TRANSACTION_TAX_DIAGNOSTIC_MESSAGES[code]) return 'ยังตรวจ VAT ของรายการนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจการตั้งค่า';
  }
  return TRANSACTION_TAX_DIAGNOSTIC_MESSAGES[code]
    ?? 'ตรวจสอบภาษีรายการนี้ไม่สำเร็จ ติดต่อผู้ดูแลการตั้งค่าภาษี';
}

const TAX_CODE_IMPORT_MESSAGES: Record<string, string> = {
  'externalCode is required': 'ระบุรหัส Tax Code (externalCode)',
  'displayName is required': 'ระบุชื่อ Tax Code (displayName)',
  'taxRegime is invalid': 'รูปแบบ taxRegime ไม่ถูกต้อง',
  'SAP Tax Code import supports VAT and IMPORT_VAT only': 'นำเข้าได้เฉพาะ taxRegime แบบ VAT หรือ IMPORT_VAT',
  'direction is invalid': 'รูปแบบ direction ไม่ถูกต้อง',
  'treatment is invalid': 'รูปแบบ treatment ไม่ถูกต้อง',
  'calculationMethod is invalid': 'รูปแบบ calculationMethod ไม่ถูกต้อง',
  'claimabilityDefault is invalid': 'รูปแบบ claimabilityDefault ไม่ถูกต้อง',
  'transactionContexts contains an invalid value': 'transactionContexts มีค่าที่ระบบไม่รองรับ',
  'Tax rate must be between 0 and 100': 'อัตราภาษีต้องอยู่ระหว่าง 0 ถึง 100',
  'At least one transaction context is required': 'ระบุ transactionContexts อย่างน้อย 1 รายการ',
  'VAT Tax Codes support only OUTPUT, INPUT, or SELF_ASSESSED direction': 'Tax Code VAT รองรับ direction แบบ OUTPUT, INPUT หรือ SELF_ASSESSED เท่านั้น',
  'OUTPUT direction is incompatible with purchase/import context': 'direction แบบ OUTPUT ใช้กับบริบทซื้อหรือนำเข้าไม่ได้',
  'INPUT direction is incompatible with sale/export context': 'direction แบบ INPUT ใช้กับบริบทขายหรือส่งออกไม่ได้',
  'SELF_ASSESSED is supported only for imported services': 'direction แบบ SELF_ASSESSED ใช้ได้เฉพาะบริการจากต่างประเทศ',
  'Partial deductibility requires an explicit split policy and is not yet activatable': 'ภาษีซื้อที่ขอคืนได้บางส่วนยังเปิดใช้ไม่ได้จนกว่าจะกำหนดวิธีแบ่งยอด',
  evidence_policy_invalid: 'รูปแบบกฎหลักฐานภาษีไม่ถูกต้อง',
  evidence_policy_invalid_json: 'กฎหลักฐานภาษีไม่ใช่ JSON ที่ถูกต้อง',
  'effectiveTo must be on or after effectiveFrom': 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มใช้',
  'effectiveFrom must be YYYY-MM-DD': 'วันที่เริ่มใช้ต้องอยู่ในรูปแบบ YYYY-MM-DD',
  'Tax Code/direction effective window conflicts with another row or existing definition': 'Tax Code, direction และช่วงวันที่ซ้ำกับแถวอื่นหรือข้อมูลเดิม',
};

export function taxCodeImportDiagnosticMessage(diagnostic: string): string {
  const exact = TAX_CODE_IMPORT_MESSAGES[diagnostic];
  if (exact) return exact;
  if (/ requires rate 0 and calculation method NONE$/.test(diagnostic)) {
    return 'Tax Code ประเภทนี้ต้องใช้อัตรา 0 และ calculationMethod แบบ NONE';
  }
  if (/ requires a positive rate and tax calculation method$/.test(diagnostic)) {
    return 'Tax Code ประเภทนี้ต้องมีอัตราภาษีมากกว่า 0 และระบุวิธีคำนวณภาษี';
  }
  return 'ข้อมูล Tax Code ในแถวนี้ไม่ถูกต้อง ตรวจสอบรูปแบบไฟล์';
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


/** Only the standard expense choices get plain display words; custom names remain data. */
export function taxChoiceLabel(item: TaxCodeDefinitionDto, sourceType?: string, direction?: TransactionTaxDirection): string {
  const rate = Number(item.rate);
  if (sourceType === 'expense.record' && direction === 'INPUT' && item.direction === 'INPUT' && item.taxRegime === 'VAT' && Number.isFinite(rate)) {
    if (item.externalCode === 'V7' && item.claimabilityDefault === 'CLAIMABLE' && item.displayName === `ภาษีซื้อขอคืนได้ ${rate}%`) return `ใช้ VAT ตอนยื่นภาษีได้ ${rate}%`;
    if (item.externalCode === 'ND' && item.claimabilityDefault === 'NONDEDUCTIBLE_EXPENSE' && item.displayName === `ภาษีซื้อขอคืนไม่ได้ ${rate}%`) return `ใช้ VAT ตอนยื่นภาษีไม่ได้ ${rate}%`;
  }
  if (!Number.isFinite(rate) || item.displayName.includes(`${rate}%`)) return item.displayName;
  return `${item.displayName} ${rate}%`;
}

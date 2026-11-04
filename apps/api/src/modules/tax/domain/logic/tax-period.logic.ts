import type { TaxFormType, TaxPeriodStatus } from '@watchdog-bms/contracts';
import { civilPeriodKey, coerceCivilDate, E_WHT_WORDS } from '@watchdog-bms/contracts';

// ─── Period key helpers ───────────────────────────────────────────────────────

/** Returns 'YYYY-MM' for monthly forms. */
export function monthlyPeriodKey(date: Date): string {
  return civilPeriodKey(coerceCivilDate(date));
}

/** Returns 'YYYY' for annual CIT (PND50). */
export function annualPeriodKey(year: number): string {
  return String(year);
}

/** Returns 'YYYY-H1' or 'YYYY-H2' for half-year CIT (PND51). */
export function halfYearPeriodKey(year: number, half: 1 | 2): string {
  return `${year}-H${half}`;
}

export function formPeriodKey(formType: TaxFormType, date: Date): string {
  const civil = coerceCivilDate(date);
  const year = Number(civil.slice(0, 4));
  const month = Number(civil.slice(5, 7));
  switch (formType) {
    case 'PP30':
    case 'PP36':
    case 'PND2':
    case 'PND3':
    case 'PND53':
    case 'CUSTOMS_SUPPORT':
      return monthlyPeriodKey(date);
    case 'PND50':
      return annualPeriodKey(year);
    case 'PND51': {
      const half = month <= 6 ? 1 : 2;
      return halfYearPeriodKey(year, half as 1 | 2);
    }
  }
}

// ─── Period lock guard ────────────────────────────────────────────────────────

const LOCKED_STATUSES: TaxPeriodStatus[] = ['FILED', 'PAID', 'CLOSED'];

export function isPeriodLocked(status: TaxPeriodStatus): boolean {
  return LOCKED_STATUSES.includes(status);
}

export function assertPeriodUnlocked(status: TaxPeriodStatus, formType: string, periodKey: string): void {
  if (isPeriodLocked(status)) {
    throw new Error(
      `Tax period ${formType}/${periodKey} is locked (${status}). Use adjustment or amended filing workflow.`,
    );
  }
}

// ─── Due date evaluation ──────────────────────────────────────────────────────

/**
 * Evaluates a due date rule stored as configurable JSON.
 * Rule shape: { type: 'day_of_next_month', day: number }
 * Never hard-codes RD rules — all values come from config.
 */
export type DueDateRule = { type: 'day_of_next_month'; day: number };

/** Shared with the PND53 paper artifact: configured extensions win. */
export function pnd53PaperDueDay(periodKey: string, configured?: Date | null): string {
  const [year, month] = periodKey.split('-').map(Number);
  return configured?.toISOString().slice(0, 10) ?? new Date(Date.UTC(year!, month!, 7)).toISOString().slice(0, 10);
}

export function evaluateDueDate(periodKey: string, rule: DueDateRule): Date | null {
  if (rule.type === 'day_of_next_month') {
    const [yearStr, monthStr] = periodKey.split('-');
    if (!yearStr || !monthStr) return null;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10); // 1-12
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return new Date(Date.UTC(nextYear, nextMonth - 1, rule.day));
  }
  return null;
}

// ─── Review issue helpers ─────────────────────────────────────────────────────

export type ReviewIssueCode =
  | 'WHT_PAYEE_KIND_UNKNOWN'
  | 'MISSING_TAX_ID'
  | 'MISSING_BRANCH_CODE'
  | 'UNKNOWN_VAT_MODE'
  | 'INPUT_VAT_NOT_CLAIMABLE'
  | 'WHT_RATE_MISMATCH'
  | 'MISSING_TAX_INVOICE'
  | 'DUPLICATE_SOURCE'
  | 'CLOSED_PERIOD_CONFLICT'
  | 'MISSING_LEDGER_DATA'
  | 'INCOMPLETE_SOURCE_FACTS';

export type ReviewIssueInput = {
  code: ReviewIssueCode;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  description: string;
  taxEventId?: string;
  sourceRef?: { sourceType: string; sourceId: string };
};

export function makeReviewIssue(
  code: ReviewIssueCode,
  details: { taxId?: string | null; context?: string },
): ReviewIssueInput {
  switch (code) {
    case 'WHT_PAYEE_KIND_UNKNOWN':
      return { code, severity: 'BLOCKING', description: details.context?.trim() ? `ยังไม่รู้ว่า ${details.context.trim()} เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน` : 'ยังไม่รู้ว่าผู้รับเงินเป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน' };
    case 'MISSING_TAX_ID':
      return { code, severity: 'BLOCKING', description: `ยังไม่มีเลขผู้เสียภาษีของ ${details.context || 'ผู้รับเงิน'} เปิดรายจ่ายหรือคู่ค้าแล้วกรอกเลขผู้เสียภาษี 13 หลัก` };
    case 'MISSING_BRANCH_CODE':
      return { code, severity: 'WARNING', description: `Missing branch code${details.context ? ` for ${details.context}` : ''}` };
    case 'UNKNOWN_VAT_MODE':
      return { code, severity: 'BLOCKING', description: `Unknown VAT mode${details.context ? `: ${details.context}` : ''}` };
    case 'INPUT_VAT_NOT_CLAIMABLE':
      return { code, severity: 'INFO', description: `Input VAT not claimable${details.context ? `: ${details.context}` : ''}` };
    case 'WHT_RATE_MISMATCH':
      return { code, severity: 'WARNING', description: E_WHT_WORDS['W-T4'](details.context?.trim() || 'ผู้รับเงิน') };
    case 'MISSING_TAX_INVOICE':
      return { code, severity: 'BLOCKING', description: `Missing tax invoice reference${details.context ? `: ${details.context}` : ''}` };
    case 'DUPLICATE_SOURCE':
      return { code, severity: 'BLOCKING', description: `Duplicate source event detected${details.context ? `: ${details.context}` : ''}` };
    case 'CLOSED_PERIOD_CONFLICT':
      return { code, severity: 'BLOCKING', description: `Source event falls in closed period${details.context ? `: ${details.context}` : ''}` };
    case 'MISSING_LEDGER_DATA':
      return { code, severity: 'WARNING', description: `Ledger data unavailable${details.context ? `: ${details.context}` : ''}` };
    case 'INCOMPLETE_SOURCE_FACTS':
      return { code, severity: 'WARNING', description: `Incomplete source facts${details.context ? `: ${details.context}` : ''}` };
  }
}


/** Review descriptions are also the download refusal, so the page can point at the source to fix. */
export const PND3_FILING_REVIEW_MESSAGES = {
  bank_remitted_only: E_WHT_WORDS['W-T3']('ภ.ง.ด.3'),
  review: 'ยังมีรายการที่ต้องแก้ไข เปิดรายการที่แจ้งไว้แล้วแก้ไขก่อนดาวน์โหลดแบบ',
  empty: 'เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ',
  month: 'เดือนภาษีไม่ถูกต้อง เลือกเดือนแล้วดึงรายการล่าสุดอีกครั้ง',
  overdue: 'พ้นกำหนดยื่นแล้ว ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร',
  branches: 'มีรายการจ่ายจากหลายสาขา ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา',
  branch: 'ไม่พบสาขาที่จ่าย เปิดรายการจ่ายแล้วตรวจสาขา',
  payer: 'ข้อมูลร้านยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดข้อมูลร้านแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก สาขา 5 หลัก และที่อยู่',
  event: 'รายการจ่ายไม่ตรงแบบหรือเดือนภาษี หรือไม่ได้ใช้เงินบาท เปิดรายจ่ายแล้วตรวจแบบ เดือน และสกุลเงิน',
  payee: 'ข้อมูลผู้รับเงินยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดรายจ่ายแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก ที่อยู่ และสาขา 5 หลักถ้ามี',
  category: 'ยังไม่พบประเภทเงินได้ในรายการของระบบ เปิดรายจ่ายแล้วเลือกจ่ายค่าอะไรอีกครั้ง',
  amount: 'ยอดหักภาษีไม่ตรงกับยอดจ่ายและอัตรา เปิดรายจ่ายแล้วตรวจยอดจ่าย อัตราภาษี และยอดหักภาษีให้ครบและตรงกัน',
  kind: 'ยังไม่ได้ยืนยันว่าผู้รับเงินเป็นบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน',
  source: 'รายการต้นทางยังใช้กับแบบนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจรายการและจัดทำแบบยื่น',
} as const;

export function withholdingIssueDescription(code: string, description: string, payee?: string | null, fixAtExpense = false, branchName?: string | null): string {
  if (fixAtExpense && /KIND/.test(code)) return withholdingIssueDescription(code, description, payee).replace('เปิดคู่ค้าแล้วเลือกประเภทก่อน', 'เปิดรายจ่ายแล้วเลือกว่าผู้รับเงินเป็นบริษัทหรือบุคคล');
  if (code === 'WHT_PAYEE_KIND_UNKNOWN' && payee?.trim()) return makeReviewIssue(code, { context: payee }).description;
  if (code === 'MISSING_TAX_ID') return makeReviewIssue('MISSING_TAX_ID', { context: payee || description.match(/^Missing tax ID for (.+)$/)?.[1] }).description;
  if (code === 'FUNCTIONAL_CURRENCY_FX_MISSING') return `รายการจ่าย${payee ? `ให้ ${payee}` : 'นี้'}ไม่ได้ใช้สกุลเงินของร้าน ให้ผู้ทำบัญชีตรวจสกุลเงินและจัดทำแบบยื่น`;
  const match = code.match(/^(PND3|PND53)_FILING_(.+)$/);
  if (match) {
    const reason = match[2].toLowerCase() as keyof typeof PND3_FILING_REVIEW_MESSAGES;
    if (reason === 'bank_remitted_only') return E_WHT_WORDS['W-T3'](match[1] === 'PND53' ? 'ภ.ง.ด.53' : 'ภ.ง.ด.3', branchName);
    let text: string = PND3_FILING_REVIEW_MESSAGES[reason] ?? description;
    if (match[1] === 'PND53') text = text.replace('ของบุคคล', 'ของบริษัท').replace('เป็นบุคคล', 'เป็นบริษัท');
    return payee ? `${payee}: ${text}` : text;
  }
  return description;
}

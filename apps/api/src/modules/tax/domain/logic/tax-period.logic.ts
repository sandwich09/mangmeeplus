import type { TaxFormType, TaxPeriodStatus } from '@watchdog-bms/contracts';

// ─── Period key helpers ───────────────────────────────────────────────────────

/** Returns 'YYYY-MM' for monthly forms. */
export function monthlyPeriodKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
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
  switch (formType) {
    case 'PP30':
    case 'PP36':
    case 'PND3':
    case 'PND53':
    case 'CUSTOMS_SUPPORT':
      return monthlyPeriodKey(date);
    case 'PND50':
      return annualPeriodKey(date.getFullYear());
    case 'PND51': {
      const half = date.getMonth() < 6 ? 1 : 2;
      return halfYearPeriodKey(date.getFullYear(), half as 1 | 2);
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
    case 'MISSING_TAX_ID':
      return { code, severity: 'BLOCKING', description: `Missing tax ID${details.context ? ` for ${details.context}` : ''}` };
    case 'MISSING_BRANCH_CODE':
      return { code, severity: 'WARNING', description: `Missing branch code${details.context ? ` for ${details.context}` : ''}` };
    case 'UNKNOWN_VAT_MODE':
      return { code, severity: 'BLOCKING', description: `Unknown VAT mode${details.context ? `: ${details.context}` : ''}` };
    case 'INPUT_VAT_NOT_CLAIMABLE':
      return { code, severity: 'INFO', description: `Input VAT not claimable${details.context ? `: ${details.context}` : ''}` };
    case 'WHT_RATE_MISMATCH':
      return { code, severity: 'WARNING', description: `WHT rate mismatch${details.context ? `: ${details.context}` : ''}` };
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

import type { VendorBillSummary } from '@watchdog-bms/contracts';

type VendorBillTaxEvidenceState = Pick<VendorBillSummary, 'taxEvidenceRequired' | 'taxEvidenceReviewStatus' | 'reviewIssues'>;

export function isVendorBillTaxEvidenceBlocked(bill: VendorBillTaxEvidenceState): boolean {
  return bill.taxEvidenceRequired && (bill.taxEvidenceReviewStatus !== 'VERIFIED' || bill.reviewIssues.length > 0);
}

export function isVendorBillTaxEvidenceCompleteForReview(bill: VendorBillTaxEvidenceState): boolean {
  const reviewStateIssues = new Set(['tax_evidence_review_required']);
  return bill.taxEvidenceRequired && bill.reviewIssues.every((issue) => reviewStateIssues.has(issue));
}

export type SupplierPaymentWhtInput = {
  /** '' when the operator is not withholding on this payment. */
  whtAmount: string;
  whtCategoryCode: string;
  whtRate: string;
  /** Withholding the bill already took at accrual. Non-zero means it must not be taken again. */
  billWhtAmount: string;
};

/**
 * `amount` is the debt being cleared, which is what the bill's outstanding is measured against —
 * withholding reduces the cash transferred, never the settlement. Mirrors the server rules so the
 * operator sees the problem before submitting, but the server remains the authority.
 */
export function canSubmitSupplierPayment(input: {
  amount: string; outstandingAmount: string; pp36Candidate: boolean; pp36PaymentEvidenceIds: string[];
  wht?: SupplierPaymentWhtInput;
}): boolean {
  const amount = Number(input.amount);
  const outstanding = Number(input.outstandingAmount);
  const base = Number.isFinite(amount) && amount > 0 && amount <= outstanding
    && (!input.pp36Candidate || input.pp36PaymentEvidenceIds.length > 0);
  if (!base) return false;
  return isSupplierPaymentWithholdingValid(amount, input.wht);
}

export function isSupplierPaymentWithholdingValid(amount: number, wht?: SupplierPaymentWhtInput): boolean {
  if (!wht || !wht.whtAmount.trim()) return true;
  const withheld = Number(wht.whtAmount);
  if (!Number.isFinite(withheld) || withheld < 0) return false;
  if (withheld === 0) return true;
  // Withholding everything would clear the debt while paying the vendor nothing.
  if (withheld >= amount) return false;
  // A bill that withheld at accrual already reported the tax; taking it again double-counts it.
  if (Number(wht.billWhtAmount || '0') > 0) return false;
  if (!wht.whtCategoryCode) return false;
  const rate = Number(wht.whtRate);
  return Number.isFinite(rate) && rate > 0 && rate <= 100;
}

/**
 * WHT certificate system issuance plan §4.1 (S9): both gate axes. `permissions` already folds in
 * the `wht_50bis` entitlement (or a retained legacy Tax grant) before
 * `wht.certificate.issue` reaches the effective permission set. The other axis is route-readiness
 * (`systemIssuanceOpen`) plus the handoff actually being open to an action (`REQUIRED`).
 */
export function canIssueSystemWhtCertificate(
  handoff: { status: string; systemIssuanceOpen?: boolean },
  permissions: readonly string[],
): boolean {
  return handoff.status === 'REQUIRED' && Boolean(handoff.systemIssuanceOpen) && permissions.includes('wht.certificate.issue');
}

/**
 * Correction & replacement plan §5.1: mirrors `canIssueSystemWhtCertificate` exactly, one axis
 * swapped — only a certificate the SYSTEM itself issued (`certificateId` present) may be corrected,
 * and the route-readiness axis is `systemCorrectionOpen` instead of `systemIssuanceOpen`.
 */
export function canCorrectWhtCertificate(
  handoff: { status: string; certificateId?: string | null; systemCorrectionOpen?: boolean },
  permissions: readonly string[],
): boolean {
  return handoff.status === 'SYSTEM_ISSUED' && Boolean(handoff.certificateId) && Boolean(handoff.systemCorrectionOpen)
    && permissions.includes('wht.certificate.correct');
}

/** Same shape as `canCorrectWhtCertificate`, checking `systemReplacementOpen` instead. */
export function canIssueWhtReplacementCopy(
  handoff: { status: string; certificateId?: string | null; systemReplacementOpen?: boolean },
  permissions: readonly string[],
): boolean {
  return handoff.status === 'SYSTEM_ISSUED' && Boolean(handoff.certificateId) && Boolean(handoff.systemReplacementOpen)
    && permissions.includes('wht.certificate.correct');
}

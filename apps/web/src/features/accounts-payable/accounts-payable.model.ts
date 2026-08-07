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

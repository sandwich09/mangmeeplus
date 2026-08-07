import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import type { PurchaseLineType, ProcurementVatMode, VendorBillRecord } from '../models/procurement.model';

// ---- Money helpers ----

export function d(v: string | number): Decimal {
  return new Decimal(String(v));
}

export function decStr(v: Decimal): string {
  return v.toFixed(4);
}

// Satang policy (spec §19d): every recorded money component rounds to 2dp at
// compute time so stored totals equal the printed document (542.06 × 7% →
// 37.94, not 37.9442). Columns stay Decimal(18,4); only the value is satang.
export function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// Pre-§19d bills store 4dp totals (e.g. 580.0042); paying the printed 580.00
// must settle them. Half a satang forgives only sub-satang residue — a real
// 0.01 shortfall stays PARTIALLY_PAID.
export const SETTLE_EPSILON = new Decimal('0.005');

// ---- Line totals ----

type LineTotalsInput = {
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatMode: ProcurementVatMode;
  vatRate?: string;
};

type LineTotalsOutput = {
  lineSubtotalAmount: string;
  vatAmount: string;
  lineTotalAmount: string;
};

export function calcLineTotals(line: LineTotalsInput): LineTotalsOutput {
  const qty = d(line.quantity);
  const price = d(line.unitPrice);
  const discount = round2(d(line.discountAmount ?? '0'));
  const vatRate = line.vatRate ? d(line.vatRate) : d('0');

  const gross = round2(qty.mul(price));
  const afterDiscount = round2(gross.sub(discount));

  let vatAmount = d('0');
  let taxable = afterDiscount;
  let total = afterDiscount;
  if (line.vatMode === 'VAT_EXCLUDED' && vatRate.gt(0)) {
    vatAmount = round2(afterDiscount.mul(vatRate).div(100));
    total = afterDiscount.add(vatAmount);
  } else if (line.vatMode === 'VAT_INCLUDED' && vatRate.gt(0)) {
    // §19d: taxable rounds; VAT is the exact remainder so the printed gross
    // survives intact.
    taxable = round2(afterDiscount.mul(100).div(d('100').add(vatRate)));
    vatAmount = afterDiscount.sub(taxable);
  }

  return {
    lineSubtotalAmount: decStr(taxable),
    vatAmount: decStr(vatAmount),
    lineTotalAmount: decStr(total),
  };
}

// ---- Document totals ----

type LineForTotals = {
  lineSubtotalAmount: string;
  vatAmount: string;
  lineTotalAmount: string;
  whtAmount?: string;
  vatMode: ProcurementVatMode;
};

type DocumentTotals = {
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtEstimateAmount: string;
  grandTotalAmount: string;
};

export function calcDocumentTotals(lines: LineForTotals[], headerDiscount = '0'): DocumentTotals {
  let subtotal = d('0');
  let vatTotal = d('0');
  let whtTotal = d('0');

  for (const ln of lines) {
    subtotal = subtotal.add(d(ln.lineSubtotalAmount));
    vatTotal = vatTotal.add(d(ln.vatAmount));
    if (ln.whtAmount) whtTotal = whtTotal.add(d(ln.whtAmount));
  }

  // §19d: document totals re-round the sums (pre-policy stored lines are 4dp).
  subtotal = round2(subtotal);
  vatTotal = round2(vatTotal);
  whtTotal = round2(whtTotal);
  const discount = round2(d(headerDiscount));
  const taxable = round2(subtotal.sub(discount));
  const grand = round2(taxable.add(vatTotal));

  return {
    subtotalAmount: decStr(subtotal),
    discountAmount: decStr(discount),
    taxableAmount: decStr(taxable),
    vatAmount: decStr(vatTotal),
    whtEstimateAmount: decStr(whtTotal),
    grandTotalAmount: decStr(grand),
  };
}

// ---- Status transitions ----

const PR_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CONVERTED', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  CANCELLED: [],
  CONVERTED: [],
};

export function canTransitionPR(from: string, to: string): boolean {
  return PR_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const PO_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['ISSUED', 'REJECTED'],
  REJECTED: ['DRAFT'],
  ISSUED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'PARTIALLY_BILLED', 'CLOSED'],
  RECEIVED: ['PARTIALLY_BILLED', 'BILLED', 'CLOSED'],
  PARTIALLY_BILLED: ['BILLED', 'CLOSED'],
  BILLED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionPO(from: string, to: string): boolean {
  return PO_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const VB_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['NEEDS_REVIEW', 'PENDING_APPROVAL'],
  NEEDS_REVIEW: ['PENDING_APPROVAL', 'DRAFT'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['PARTIALLY_PAID', 'PAID', 'VOIDED', 'CREDITED'],
  REJECTED: ['DRAFT'],
  PARTIALLY_PAID: ['PAID'],
  PAID: [],
  VOIDED: [],
  CREDITED: [],
};

export function canTransitionVB(from: string, to: string): boolean {
  return VB_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---- Matching ----

type MatchLineInput = {
  poQuantity: string;
  poUnitPrice: string;
  billQuantity: string;
  billUnitPrice: string;
  grAcceptedQuantity?: string;
  lineType: PurchaseLineType;
  matchingMode: 'TWO_WAY_PO_BILL' | 'THREE_WAY_PO_RECEIPT_BILL';
};

type MatchResult = {
  quantityVariance: string;
  amountVariance: string;
  status: 'MATCHED' | 'MATCHED_WITH_VARIANCE' | 'NOT_MATCHED';
};

export function matchLine(input: MatchLineInput): MatchResult {
  const poQty = d(input.poQuantity);
  const poPrice = d(input.poUnitPrice);
  const billQty = d(input.billQuantity);
  const billPrice = d(input.billUnitPrice);

  if (input.matchingMode === 'THREE_WAY_PO_RECEIPT_BILL' && !input.grAcceptedQuantity) {
    return {
      quantityVariance: decStr(billQty),
      amountVariance: decStr(billQty.mul(billPrice)),
      status: 'NOT_MATCHED',
    };
  }

  const qtyToMatch = input.matchingMode === 'THREE_WAY_PO_RECEIPT_BILL' && input.grAcceptedQuantity
    ? d(input.grAcceptedQuantity) : poQty;

  const qtyVariance = billQty.sub(qtyToMatch).abs();
  const poAmount = qtyToMatch.mul(poPrice);
  const billAmount = billQty.mul(billPrice);
  const amtVariance = billAmount.sub(poAmount).abs();

  const isMatched = qtyVariance.isZero() && amtVariance.isZero();
  const hasVariance = !qtyVariance.isZero() || !amtVariance.isZero();

  return {
    quantityVariance: decStr(qtyVariance),
    amountVariance: decStr(amtVariance),
    status: isMatched ? 'MATCHED' : hasVariance ? 'MATCHED_WITH_VARIANCE' : 'NOT_MATCHED',
  };
}

// ---- AP Aging ----

type ApAgingInput = {
  vendorBillId: string;
  supplierId: string;
  supplierDisplayName: string;
  dueDate: Date;
  outstandingAmount: string;
  currency: string;
};

type AgingBucket = 'not_due' | '0_30' | '31_60' | '61_90' | '91_plus';

export function getAgingBucket(dueDate: Date, asOfDate: Date): AgingBucket {
  const diffMs = asOfDate.getTime() - dueDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'not_due';
  if (diffDays <= 30) return '0_30';
  if (diffDays <= 60) return '31_60';
  if (diffDays <= 90) return '61_90';
  return '91_plus';
}

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  not_due: 'Not Due',
  '0_30': '0–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  '91_plus': '91+ days',
};

// ---- Tax review issues ----

type BillTaxFields = {
  taxId?: string;
  branchCode?: string;
  vatRegistered?: boolean;
  taxInvoiceNumber?: string;
  taxInvoiceDate?: Date;
  attachmentActive?: boolean;
  vatAmount: string;
  whtCategoryCode?: string;
  whtRate?: string;
  pp36Candidate: boolean;
  inputVatClaimStatus: string;
  taxEvidenceRequired?: boolean;
  taxEvidenceReviewStatus?: 'DRAFT' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'REJECTED';
};

export function buildTaxReviewIssues(bill: BillTaxFields): string[] {
  const issues: string[] = [];
  if (bill.taxEvidenceRequired) {
    if (!bill.taxId) issues.push('missing_supplier_tax_id');
    if (bill.vatRegistered !== true) issues.push('supplier_vat_registration_not_confirmed');
    if (!bill.taxInvoiceNumber) issues.push('missing_tax_invoice_number');
    if (!bill.taxInvoiceDate) issues.push('missing_tax_invoice_date');
    if (!bill.attachmentActive) issues.push('missing_active_tax_invoice_attachment');
    if (bill.taxEvidenceReviewStatus === 'REJECTED') issues.push('tax_evidence_rejected');
    else if (bill.taxEvidenceReviewStatus !== 'VERIFIED') issues.push('tax_evidence_review_required');
  }
  if (bill.whtCategoryCode && !bill.whtRate) issues.push('wht_rate_not_set');
  if (bill.pp36Candidate && !bill.taxId) issues.push('pp36_candidate_missing_tax_id');
  return issues;
}

/** Optimistic token for every vendor-bill fact used by final tax resolution. */
// H-07: fail-closed maker-checker defaults when no ProcurementApprovalPolicy
// row exists — shared by enforcement and the policy read endpoint so the two
// can never drift.
export const PROCUREMENT_APPROVAL_POLICY_DEFAULTS = {
  allowSelfApproval: false,
  dualApprovalThresholdAmount: null as string | null,
};

// H-07 product decision (2026-07-18): small companies run on the owner/admin/
// manager doing everything, so holders of these roles may self-approve without
// a policy override. Everyone else stays maker-checker unless the company
// policy allows self-approval. The dual-approval threshold is NOT exempted —
// it always demands two approvers other than the submitter.
export const SELF_APPROVAL_EXEMPT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];

export function canSelfApprove(roles: string[] | undefined, allowSelfApprovalPolicy: boolean): boolean {
  return allowSelfApprovalPolicy || (roles ?? []).some((role) => SELF_APPROVAL_EXEMPT_ROLES.includes(role));
}

export function vendorBillTaxSourceChecksum(bill: VendorBillRecord): string {
  const date = (value?: Date) => value?.toISOString() ?? null;
  const facts = {
    id: bill.id,
    companyId: bill.companyId,
    branchId: bill.branchId ?? null,
    status: bill.status,
    supplierId: bill.supplierId,
    billDate: date(bill.billDate),
    currency: bill.currency,
    pp36Candidate: bill.pp36Candidate,
    matchingMode: bill.matchingMode,
    matchingStatus: bill.matchingStatus,
    taxInvoiceNumber: bill.taxInvoiceNumber ?? null,
    taxInvoiceDate: date(bill.taxInvoiceDate),
    attachmentId: bill.attachmentId ?? null,
    taxEvidenceRequired: bill.taxEvidenceRequired,
    taxEvidenceReviewStatus: bill.taxEvidenceReviewStatus,
    lines: [...(bill.lines ?? [])]
      .sort((left, right) => left.lineNumber - right.lineNumber || left.id.localeCompare(right.id))
      .map((line) => ({
        id: line.id,
        updatedAt: date(line.updatedAt),
        lineNumber: line.lineNumber,
        lineSubtotalAmount: line.lineSubtotalAmount,
        lineTotalAmount: line.lineTotalAmount,
        vatAmount: line.vatAmount,
        inputVatClaimStatus: line.inputVatClaimStatus,
        taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? null,
        externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
        taxContext: line.taxSnapshot?.taxContext ?? null,
      })),
  };
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

// ---- Source posting idempotency key ----

export function buildPostingKey(sourceType: string, sourceId: string, eventType: string): string {
  return `${sourceType}:${sourceId}:${eventType}`;
}

// ---- AP net payable ----

export function calcNetPayable(grandTotal: string, whtAmount: string): string {
  return decStr(round2(d(grandTotal).sub(d(whtAmount))));
}

// ---- Payment allocation ----

type AllocationInput = { amount: string };
export function calcAllocatedAndUnapplied(
  grossAmount: string,
  allocations: AllocationInput[],
): { allocatedAmount: string; unappliedAmount: string } {
  const total = allocations.reduce((acc, a) => acc.add(d(a.amount)), d('0'));
  const gross = d(grossAmount);
  return {
    allocatedAmount: decStr(total),
    unappliedAmount: decStr(gross.sub(total)),
  };
}

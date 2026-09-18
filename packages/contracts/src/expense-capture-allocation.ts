/**
 * Buyer expense capture — assembled facts, the human fact patch and the reviewed business
 * allocation (W04a).
 *
 * Source of truth: `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md` §7
 * (D03 money policy), §9 (`facts`/`review`/`accept` routes) and spec §6 (money rules 1–13).
 *
 * Money is a STRING everywhere, as in `expense-capture.ts`: these values are transcribed from a
 * document and a float would quietly re-round a printed total. Nothing in this file computes —
 * `expense-capture-facts.logic.ts` assembles and `expense-capture-allocation.logic.ts` divides.
 */
import type {
  ExpenseCaptureBlocker,
  ExpenseCaptureBusinessUse,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureComponentRole,
  ExpenseCaptureCompleteness,
  ExpenseCaptureDocumentObservation,
  ExpenseCaptureFundingRoute,
  ExpenseCaptureItemEvent,
  ExpenseCaptureItemObservation,
  ExpenseCaptureObservations,
  ExpenseCapturePaymentObservation,
  ExpenseCaptureRefundObservation,
  ExpenseCaptureTotalKind,
  ExpenseCaptureTotalObservation,
} from './expense-capture.js';
import type {
  ExpenseLineChargeKind,
  ExpenseVatMode,
  InputVatClaimStatus,
  TaxEvidenceStatus,
} from './expenses.js';

/** D03 defaults of appendix §7, recorded in every snapshot so a later policy can be told apart. */
export const EXPENSE_CAPTURE_ALLOCATION_POLICY = {
  discount: 'shared-discount-v1',
  shipping: 'shipping-by-eligible-item-v1',
} as const;

export type CaptureAllocationPolicy = {
  discount: typeof EXPENSE_CAPTURE_ALLOCATION_POLICY.discount;
  shipping: typeof EXPENSE_CAPTURE_ALLOCATION_POLICY.shipping;
};

export const EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION =
  `${EXPENSE_CAPTURE_ALLOCATION_POLICY.discount}+${EXPENSE_CAPTURE_ALLOCATION_POLICY.shipping}` as const;

// ─── Assembled facts (§4.4 assembly, the INPUT of the allocation) ─────────────

export type CaptureFactsSource = 'AI' | 'HUMAN' | 'EXPENSE_FACTS';

/** §4.4: does the document add up, or do we merely not know enough to say? */
export type CaptureDocumentReconciliation = 'reconciled' | 'mismatch' | 'insufficient';

/**
 * What one document is, financially, before anybody divides it. `documentTotal` is what the
 * document printed, `reportedPaid` what it says was actually handed over — never merged
 * (spec §13.2), and neither is ever invented from the other.
 */
export type CaptureDocumentState = {
  reconciliation: CaptureDocumentReconciliation;
  documentTotal?: string;
  buyerPayable?: string;
  reportedPaid?: string;
  paymentStatus: 'paid' | 'pending' | 'unknown';
  /** Ids of rows whose amount is needed to add this document up and could not be read (rule 9). */
  unknownAmounts: string[];
  completeness: ExpenseCaptureCompleteness;
};

/**
 * Every fact carries the file it came from, because one group holds several reads and an id is
 * only stable within one of them. Ids and refs are namespaced `<fileId>:<id>` by the assembler.
 */
export type CaptureFactsDocument = ExpenseCaptureDocumentObservation & {
  fileId: string;
  /** The issuer scope a derived source will belong to — `deriveCaptureScopeKey`'s normalisation. */
  scopeKey: string;
  state: CaptureDocumentState;
};

export type CaptureFactsItem = ExpenseCaptureItemObservation & { fileId: string; scopeKey: string };
export type CaptureFactsComponent = ExpenseCaptureComponentObservation & { fileId: string; scopeKey: string };
export type CaptureFactsTotal = ExpenseCaptureTotalObservation & { fileId: string };
export type CaptureFactsPayment = ExpenseCapturePaymentObservation & { fileId: string };
export type CaptureFactsRefund = ExpenseCaptureRefundObservation & { fileId: string };

/** Which observation each file's facts came from, so a reviewer can see what they are reading. */
export type CaptureFactsFile = {
  fileId: string;
  observationId: string;
  version: number;
  source: CaptureFactsSource;
  completeness: ExpenseCaptureCompleteness;
};

/**
 * The group's facts, one shape for the page, the allocation and the LINE summary.
 *
 * Structurally assignable to `ExpenseCaptureObservations` (same six arrays plus `completeness`),
 * which is what lets the group detail dto keep its declared type while carrying the richer object.
 */
export type CaptureFactsView = {
  documents: CaptureFactsDocument[];
  items: CaptureFactsItem[];
  components: CaptureFactsComponent[];
  totals: CaptureFactsTotal[];
  payments: CaptureFactsPayment[];
  refunds: CaptureFactsRefund[];
  /** The union of every file's completeness: an empty list is a claim, this is the counter-claim. */
  completeness: ExpenseCaptureCompleteness;
  files: CaptureFactsFile[];
  summary: {
    documents: number;
    items: number;
    filesRead: number;
    filesPartial: number;
    unknownItems: number;
  };
};

// ─── Human facts patch (§9 `POST …/facts`) ────────────────────────────────────

/** Why a value says what it says. Recorded per edited field, never per observation. */
export type CaptureFactsProvenance = {
  target: 'item' | 'component' | 'total' | 'document' | 'payment';
  id: string;
  field: string;
  source: 'HUMAN';
  userId: string;
  at: string;
  /** What the value was before the edit — `null` when it was unknown (rule 9 works both ways). */
  previous: string | null;
};

/** The payload of a `source: HUMAN` observation: the same facts plus who changed what. */
export type CaptureHumanObservationPayload = ExpenseCaptureObservations & {
  provenance: CaptureFactsProvenance[];
};

/** `null` clears a value back to unknown; an absent key is not an edit. */
export type CaptureFactsItemPatch = {
  id: string;
  description?: string;
  quantity?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
  event?: ExpenseCaptureItemEvent;
};

export type CaptureFactsComponentPatch = {
  id: string;
  amount?: string | null;
  role?: ExpenseCaptureComponentRole;
};

export type CaptureFactsTotalPatch = {
  documentRef: string;
  kind: ExpenseCaptureTotalKind;
  /** `null` removes the total the reader claimed to see. */
  amount: string | null;
};

export type CaptureFactsDocumentPatch = {
  ref: string;
  issuerName?: string | null;
  issuerTaxId?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  currency?: string | null;
};

export type CaptureFactsPaymentPatch = {
  /** Index into the file's `payments` array; payments carry no id of their own. */
  index: number;
  status: 'paid' | 'pending' | 'unknown';
};

export type CaptureFactsPatch = {
  items?: CaptureFactsItemPatch[];
  components?: CaptureFactsComponentPatch[];
  totals?: CaptureFactsTotalPatch[];
  documents?: CaptureFactsDocumentPatch[];
  payments?: CaptureFactsPaymentPatch[];
};

// ─── Reviewed business allocation (§9 `POST …/review`) ────────────────────────

export type CaptureAllocationOutcome = 'READY' | 'BLOCKED' | 'NO_COMPANY_PORTION';

/** Which reviewed date a scope uses (A42): never the upload date, never today. */
export type CaptureExpenseDateChoice = 'payment' | 'document' | 'order' | { date: string };
export type CaptureExpenseDateSource = 'payment' | 'document' | 'order' | 'explicit';

export type CaptureTaxReviewEntry = {
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  taxEvidenceStatus: TaxEvidenceStatus;
};

/** What a reviewer decided, plus who decided it — the stored `taxReviewJson` of §2.2. */
export type CaptureTaxReviewRecord = CaptureTaxReviewEntry & {
  reviewedByUserId: string;
  reviewedAt: string;
};

export type CaptureAllocationSelection = Record<string, { companyQuantity: string }>;

export type CaptureAllocationInput = {
  facts: CaptureFactsView;
  businessUse: ExpenseCaptureBusinessUse;
  selection: CaptureAllocationSelection;
  fundingRoute: ExpenseCaptureFundingRoute;
  payerUserId: string | null;
  taxReview: Record<string, CaptureTaxReviewEntry>;
  expenseDateChoice: Record<string, CaptureExpenseDateChoice>;
  policy: CaptureAllocationPolicy;
  /** Only ever used to reject a future-dated choice — never as a default date (A42). */
  todayIso: string;
};

/** `remainderAdjust` marks the satang the largest-remainder pass handed to this row (rule 7). */
export type CaptureAllocationDiscountShare = {
  componentId: string;
  share: string;
  remainderAdjust: boolean;
};

export type CaptureAllocationProvenance = {
  itemId: string;
  companyQuantity: string;
  quantity: string;
  /** `true` when the document never printed a quantity, so the row is all-or-nothing (§16.2). */
  quantityInferred: boolean;
  unitPrice: string;
  baseAmount: string;
  discountShares: CaptureAllocationDiscountShare[];
  shippingShare?: string;
};

/** Structurally the api's `LineTotalsResult`; declared here so the snapshot has one shape. */
export type CaptureAllocationLineTotals = {
  lineSubtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  lineTotalAmount: string;
};

export type CaptureAllocationLine = {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  /** Only ever a rate a row actually printed. Never 7% by default (A53). */
  vatRate: string | null;
  totals: CaptureAllocationLineTotals;
  provenance: CaptureAllocationProvenance;
};

export type CaptureAllocationCharge = {
  chargeKind: ExpenseLineChargeKind;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatRate: string | null;
  totals: CaptureAllocationLineTotals;
  provenance: {
    componentIds: string[];
    grossAmount: string;
    discountAmount: string;
    companyShare: string;
    itemShares: Array<{ itemId: string; share: string }>;
  };
};

export type CaptureAllocationTotals = {
  subtotal: string;
  discount: string;
  taxable: string;
  vat: string;
  grandTotal: string;
  netPayable: string;
};

export type CaptureAllocationScope = {
  scopeKey: string;
  fileIds: string[];
  documentRefs: string[];
  issuer: ExpenseCaptureDocumentObservation['issuer'];
  currency: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  taxEvidenceStatus: TaxEvidenceStatus;
  /** `review` when a reviewer decided it, `facts` when it is the default read off the document. */
  taxSource: 'facts' | 'review';
  expenseDate: string | null;
  expenseDateSource: CaptureExpenseDateSource | null;
  lines: CaptureAllocationLine[];
  charges: CaptureAllocationCharge[];
  totals: CaptureAllocationTotals;
  companyAmount: string;
  personalAmount: string;
  /** `reported_paid` ?? `buyer_payable` ?? `document_total` — what actually left the buyer. */
  paidTotal: string;
  /** Employee route only: the reviewed tax state a reimbursement source must already satisfy. */
  claimReady: boolean;
  blockers: ExpenseCaptureBlocker[];
};

export type CaptureAllocationResult = {
  policyVersion: typeof EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION;
  outcome: CaptureAllocationOutcome;
  scopes: CaptureAllocationScope[];
  /** Group-level only: these are what make the outcome `BLOCKED` and refuse an accept. */
  blockers: ExpenseCaptureBlocker[];
  summary: { companyAmount: string; personalAmount: string; paidTotal: string };
};

/**
 * Every reason an allocation cannot move on. Module-prefixed because `api-error-message.ts` is one
 * flat Thai map for the whole product, and a key called `payer_required` there would be claimed by
 * whichever feature wrote it first.
 */
export const EXPENSE_CAPTURE_BLOCKERS = {
  BUSINESS_USE_REQUIRED: 'expense_capture_business_use_required',
  FUNDING_ROUTE_REQUIRED: 'expense_capture_funding_route_required',
  PAYER_REQUIRED: 'expense_capture_payer_required',
  ITEM_AMOUNT_UNKNOWN: 'expense_capture_item_amount_unknown',
  DOCUMENT_MISMATCH: 'expense_capture_document_mismatch',
  COMPONENT_UNCLASSIFIED: 'expense_capture_component_unclassified',
  EXPENSE_DATE_REQUIRED: 'expense_capture_expense_date_required',
  CURRENCY_UNSUPPORTED: 'expense_capture_currency_unsupported',
  COMPANY_PAID_PERSONAL_PORTION: 'expense_capture_company_paid_personal_portion',
  TOTALS_IDENTITY_FAILED: 'expense_capture_totals_identity_failed',
  /** Scope-level only: the source is still created, the claim is what waits (§7, A04/A08). */
  TAX_REVIEW_PENDING: 'expense_capture_tax_review_pending',
  /** The group has facts but nobody has said what is company and who paid. */
  REVIEW_REQUIRED: 'expense_capture_review_required',
} as const;

export type ExpenseCaptureBlockerCode =
  (typeof EXPENSE_CAPTURE_BLOCKERS)[keyof typeof EXPENSE_CAPTURE_BLOCKERS];

export type ExpenseCaptureReviewResultDto = {
  allocationId: string;
  groupRevision: number;
  revision: number;
  status: 'PREVIEW' | 'ACCEPTED';
  result: CaptureAllocationResult;
};

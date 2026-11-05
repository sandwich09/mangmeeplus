import { EXPENSE_MAX_ITEM_LINES } from './expense-item-limits.js';
/**
 * Buyer expense capture — read models, gateway contract and manifest shape.
 *
 * Source of truth: `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md`
 * (§4.3 gateway, §4.4 manifest/assembly, §9 HTTP). W01 ships the persistence, the group API and
 * the lineage guards; W03 fills the observations and W04 the allocation, so the fact-carrying
 * shapes below are declared here once and stay stable across those waves.
 *
 * Money is a STRING everywhere: these values are transcribed from a document, and a float would
 * quietly re-round a printed total. Nothing in this file computes — the API assembles and the
 * reviewer decides.
 */
import type {
  AiBudgetScope,
  BusinessDocumentClassification,
  BusinessDocumentFamily,
  BusinessDocumentKind,
  ReceiptOcrFieldResult,
} from './line-ai.js';
import type { AiBudgetEnvelope } from './ai-budget-bounds.js';
import type { AiModelLineage, AiUsageEntry } from './ai-lineage.js';

/** Bumped when a field changes meaning. Both sides refuse a version they do not know. */
export const EXPENSE_CAPTURE_CONTRACT_VERSION = 1;

export type ExpenseCaptureIntakeChannel = 'WEB' | 'LINE';
export type ExpenseCaptureGroupStatus = 'OPEN' | 'HANDED_OFF' | 'CLOSED_NO_HANDOFF' | 'CANCELLED';
export type ExpenseCaptureBusinessUse = 'UNKNOWN' | 'ALL_COMPANY' | 'MIXED';
export type ExpenseCaptureFundingRoute = 'UNKNOWN' | 'COMPANY' | 'EMPLOYEE';
export type ExpenseCaptureHandoffState = 'NONE' | 'ACTIVE' | 'RELEASED';
export type ExpenseCaptureFileState = 'PENDING_UPLOAD' | 'STORED' | 'REJECTED' | 'DETACHED';
export type ExpenseCaptureReadStatus =
  | 'QUEUED' | 'PREPARING' | 'READING' | 'PARTIAL' | 'PAUSED' | 'FAILED' | 'DONE' | 'CANCELLED';
export type ExpenseCaptureAllocationStatus = 'PREVIEW' | 'ACCEPTED' | 'SUPERSEDED' | 'INVALIDATED';

/** D09 baseline: this release never claims a document was verified, only that it was not checked. */
export type ExpenseCaptureElectronicVerification = {
  status: 'NOT_CHECKED' | 'UNAVAILABLE';
  method: string | null;
  checkedAt: string | null;
};

/** Why a read stopped at a declared boundary rather than failing (§4.6/§10). */
export type ExpenseCapturePausedReason = 'page_limit' | 'call_budget' | 'time_budget' | 'ai_credit' | 'memory_budget';

/** The two reasons a group may be closed without a handoff (§9). */
export const EXPENSE_CAPTURE_CLOSE_REASONS = ['NO_COMPANY_PORTION', 'CANCELLED'] as const;
export type ExpenseCaptureCloseReason = (typeof EXPENSE_CAPTURE_CLOSE_REASONS)[number];

/** What the client may do next, decided by the server — a hidden button is not a guard. */
export const EXPENSE_CAPTURE_ACTIONS = [
  'add_file', 'detach_file', 'review', 'accept_allocation', 'handoff', 'close',
] as const;
export type ExpenseCaptureAction = (typeof EXPENSE_CAPTURE_ACTIONS)[number];

/** Limits the UI and the LINE copy read instead of hard-coding them (§4.1). */
export type ExpenseCaptureCapabilityDto = {
  maxBytes: number;
  allowedMimeTypes: string[];
  /** Always true in this release: a PDF is read automatically, within `pdfMaxPagesAutomatic`. */
  pdfAutomaticRead: true;
  pdfMaxPagesAutomatic: number;
};

export type ExpenseCaptureFileDto = {
  fileId: string;
  attachmentId: string;
  position: number;
  uploadState: ExpenseCaptureFileState;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  /** Null until the file has been opened by the reader (W03). */
  pageCount: number | null;
  /** Null while no read job exists for this file. */
  readStatus: ExpenseCaptureReadStatus | null;
  pagesRead: number;
  pausedReason: ExpenseCapturePausedReason | null;
  lastErrorCode: string | null;
  electronicVerification: ExpenseCaptureElectronicVerification;
  addedByUserId: string;
  detachedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseCaptureGroupDto = {
  groupId: string;
  companyId: string;
  branchId: string | null;
  intakeChannel: ExpenseCaptureIntakeChannel;
  status: ExpenseCaptureGroupStatus;
  revision: number;
  businessUse: ExpenseCaptureBusinessUse;
  fundingRoute: ExpenseCaptureFundingRoute;
  payerUserId: string | null;
  handoffState: ExpenseCaptureHandoffState;
  acceptedAllocationId: string | null;
  note: string | null;
  closedReason: string | null;
  closedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseCaptureGroupListItemDto = {
  groupId: string;
  status: ExpenseCaptureGroupStatus;
  intakeChannel: ExpenseCaptureIntakeChannel;
  fileCount: number;
  /** Files whose read finished, so a list row can say "อ่านครบ" without loading every job. */
  filesRead: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  webPath: string;
};

export type ExpenseCaptureAllocationDto = {
  allocationId: string;
  groupRevision: number;
  policyVersion: string;
  status: ExpenseCaptureAllocationStatus;
  fundingRoute: ExpenseCaptureFundingRoute;
  payerUserId: string | null;
  computedByUserId: string;
  computedAt: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  invalidatedReason: string | null;
  /** Per-scope result of §4.4/§7. Opaque to the client contract until W04 renders it. */
  result: unknown;
};

/**
 * W06 §12: the substitute-receipt certificate of ONE derived source. A group never has one — the
 * certificate belongs to the source whose payee, amount and evidence it certifies (§12.2).
 */
export type ExpenseCaptureDerivedCertificateDto = {
  evidenceId: string;
  status: 'PREPARED' | 'PAYER_CERTIFIED' | 'ISSUED' | 'SUPERSEDED';
  signatureMode: 'DIGITAL' | 'PAPER';
  fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | null;
  documentNumber: string;
};

/**
 * What this one source is waiting for (§14.3, A40): the group shows "ร้าน A ออกแล้ว / ร้าน B รอลงนาม"
 * and continues with B only. `receipt_present` is the A18/A19 outcome — a scope that already has a
 * usable receipt is never offered a certificate.
 */
export type ExpenseCaptureDerivedNextAction =
  | 'certificate_available' | 'certificate_prepared' | 'certificate_certified' | 'certificate_issued'
  | 'receipt_present' | 'blocked';

/** A derived source is an ordinary `ExpenseRecord`; the group only reports the lineage. */
export type ExpenseCaptureDerivedSourceDto = {
  expenseId: string;
  scopeKey: string;
  status: string;
  grandTotalAmount: string;
  payerUserId: string | null;
  /** The current (non-superseded) certificate of this source, or null while it has none. */
  certificate: ExpenseCaptureDerivedCertificateDto | null;
  nextAction: ExpenseCaptureDerivedNextAction;
};

/**
 * Something that must be resolved before the group can move on. Server-decided and Thai-worded
 * at the web boundary through `api-error-message.ts`; `action` names the affordance, if any.
 */
export type ExpenseCaptureBlocker = {
  code: string;
  messageTh: string;
  action?: ExpenseCaptureAction;
};

export type ExpenseCaptureGroupDetailDto = ExpenseCaptureGroupDto & {
  /** Assembled observations, empty until W03 reads a file. Never invented from an upload. */
  facts: ExpenseCaptureObservations | null;
  files: ExpenseCaptureFileDto[];
  allocation: ExpenseCaptureAllocationDto | null;
  derivedSources: ExpenseCaptureDerivedSourceDto[];
  blockers: ExpenseCaptureBlocker[];
  allowedActions: ExpenseCaptureAction[];
  /** Deep link for "กรอกข้อมูลต่อ" (§10); the page itself lands in W04. */
  webPath: string;
  capability: ExpenseCaptureCapabilityDto;
};

// ─── Gateway contract (§4.3) ───────────────────────────────────────────────────

export type ExpenseCaptureChunkKind = 'pdf' | 'image' | 'tiles';

export type ExpenseCaptureReadChunk = {
  /** Original media kind, retained when a PDF page is rasterised. */
  sourceMimeType?: string;
  id: string;
  kind: ExpenseCaptureChunkKind;
  mimeType: string;
  /** Present for `pdf` and single `image` chunks. */
  contentBase64?: string;
  /** Present for `tiles`: an overview plus its tiles, one provider call. */
  images?: Array<{ contentBase64: string; mimeType: string; role: 'overview' | 'tile'; index: number }>;
  pageIndexes: number[];
  fileLabel: string;
};

export type ExpenseCaptureReadRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  contractVersion: typeof EXPENSE_CAPTURE_CONTRACT_VERSION;
  chunk: ExpenseCaptureReadChunk;
  modelPolicy?: { modelId?: string; provider?: string };
  budgetEnvelope?: AiBudgetEnvelope;
};

export type ExpenseCaptureReadPage = {
  pageIndex: number;
  text: string;
  /** The model hit `maxTokens` on this page; the API re-chunks instead of losing a whole page. */
  truncated: boolean;
  blank: boolean;
};

export type ExpenseCaptureGatewayStatus = 'ok' | 'not_configured' | 'failed';

export type ExpenseCaptureReadResponse = {
  status: ExpenseCaptureGatewayStatus;
  contractVersion: number;
  pages?: ExpenseCaptureReadPage[];
  errorCode?: string;
  /** Present only with an `AI_BUDGET_*` code: which ceiling refused (spec §9.1). */
  budgetScope?: AiBudgetScope;
  usage?: AiUsageEntry[];
  modelLineage?: AiModelLineage;
};

export type ExpenseCaptureExtractWindow = {
  fileLabel: string;
  pageIndexes: number[];
  pages: Array<{ pageIndex: number; text: string; sourceOffset?: number }>;
  /** Documents already assembled from earlier windows, so a continuation is not a new document. */
  priorDocuments?: Array<{
    ref: string;
    issuerName?: string;
    documentNumber?: string;
    documentDate?: string;
    currency?: string;
    openTotals: boolean;
  }>;
};

export type ExpenseCaptureExtractRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  contractVersion: typeof EXPENSE_CAPTURE_CONTRACT_VERSION;
  window: ExpenseCaptureExtractWindow;
  activeCategories?: Array<{ id: string; name: string }>;
  modelPolicy?: { modelId?: string; provider?: string };
  budgetEnvelope?: AiBudgetEnvelope;
};

export type ExpenseCaptureExtractResponse = {
  status: ExpenseCaptureGatewayStatus;
  contractVersion: number;
  observations?: ExpenseCaptureObservations;
  errorCode?: string;
  budgetScope?: AiBudgetScope;
  usage?: AiUsageEntry[];
  modelLineage?: AiModelLineage;
};

// ─── Observations (§4.3) ──────────────────────────────────────────────────────

/** What a row DID, so a void or a promo line is never summed as a purchase. */
export type ExpenseCaptureItemEvent =
  | 'sale' | 'void' | 'discount' | 'price_correction' | 'zero_price_promo' | 'reward' | 'info' | 'unknown';

/**
 * What a non-item amount IS. `tender`/`change` describe how the bill was settled (500 handed
 * over, 68 back) and never reduce the merchandise total; `future_reward` is a coupon the buyer
 * will receive and reduces nothing at all.
 */
export type ExpenseCaptureComponentRole =
  | 'charge' | 'applied_discount' | 'tax_included' | 'tax_additional' | 'tax_unknown'
  | 'tender' | 'change' | 'future_reward' | 'refund' | 'balance' | 'summary' | 'unclassified';

export type ExpenseCaptureComponentScope = 'item' | 'order' | 'shipping' | 'checkout' | 'document';

export type ExpenseCaptureTotalKind =
  | 'merchandise' | 'shipping' | 'tax' | 'document_total' | 'buyer_payable' | 'reported_paid';

export type ExpenseCaptureDocumentObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  ref: string;
  pageIndexes: number[];
  kind: BusinessDocumentKind;
  family: BusinessDocumentFamily;
  issuer: { name?: string; taxId?: string; branchCode?: string; address?: string; storefront?: string; platform?: string };
  buyer?: { name?: string; taxId?: string };
  documentNumber?: string;
  documentDate?: string;
  currency?: string;
  printedPage?: { number?: number; of?: number };
  /**
   * Assembly-only: every printed page number this document showed, so `1 of 3` + `3 of 3` in a
   * two-page file is visibly missing page 2 (§16.8). The gateway never sets it.
   */
  printedPages?: number[];
  continuationOfRef?: string;
  /**
   * The photo reader's reporting-category suggestion for this whole document, same shape and rule:
   * an id from the request's `activeCategories` plus 1-5 exact spans of the window text. Advisory —
   * `receipt-ocr-apply` writes it only for an active category of the company and at or above
   * `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE`.
   */
  categorySuggestion?: NonNullable<ReceiptOcrFieldResult['categorySuggestion']>;
  classification: BusinessDocumentClassification;
};

export type ExpenseCaptureItemObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  /** v2 uses the original page/description span; legacy reads use `<page>:<line>`. */
  id: string;
  documentRef: string;
  description: string;
  quantity?: string;
  unit?: string;
  packSize?: string;
  unitPrice?: string;
  amount?: string;
  listPrice?: string;
  taxMarker?: string;
  event: ExpenseCaptureItemEvent;
  /** The row this one cancels or corrects. */
  linkedItemId?: string;
  /** MUST be a substring of the cited page's text, or the field is dropped as unknown. */
  evidenceSpan: string;
};

export type ExpenseCaptureComponentObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  id: string;
  documentRef: string;
  label: string;
  amount?: string;
  currency?: string;
  role: ExpenseCaptureComponentRole;
  scope: ExpenseCaptureComponentScope;
  parentId?: string;
  appliedStatus: 'applied' | 'pending' | 'unknown';
  evidenceSpan: string;
};

export type ExpenseCaptureTotalObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  documentRef: string;
  kind: ExpenseCaptureTotalKind;
  amount: string;
  evidenceSpan: string;
};

export type ExpenseCapturePaymentObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  documentRef: string;
  method?: string;
  status: 'paid' | 'pending' | 'unknown';
  amount?: string;
  occurredAt?: string;
  reference?: string;
  evidenceSpan: string;
};

export type ExpenseCaptureRefundObservation = {
  fieldEvidence?: Record<string, ExpenseCaptureFieldEvidence>;
  documentRef: string;
  state: 'requested' | 'approved' | 'processing' | 'completed' | 'unknown';
  amount?: string;
  destination?: string;
  evidenceSpan: string;
};

/** Says what the read did NOT cover. An empty list is a claim; this is the counter-claim. */
export type ExpenseCaptureCompleteness = {
  itemsTruncated: boolean;
  unreadableRows: number;
  pagesCovered: number[];
  notes: string[];
};

export type ExpenseCaptureFieldEvidence = {
  attachmentId: string;
  checksumSha256: string;
  pageIndex: number;
  /** Exact UTF-16 offsets in the original stored page transcription, not the window. */
  localSpan: { start: number; end: number };
  rawValue: string;
  role: string;
};

export type ExpenseCaptureObservations = {
  documents: ExpenseCaptureDocumentObservation[];
  items: ExpenseCaptureItemObservation[];
  components: ExpenseCaptureComponentObservation[];
  totals: ExpenseCaptureTotalObservation[];
  payments: ExpenseCapturePaymentObservation[];
  refunds: ExpenseCaptureRefundObservation[];
  completeness: ExpenseCaptureCompleteness;
};

/**
 * What the deterministic assembly proved about ONE document (§4.4). The API computes this with
 * `decimal.js` from printed values only: `insufficient` is the honest answer when the page never
 * printed enough to check, and a `mismatch` is shown to the reviewer rather than balanced away.
 */
export type ExpenseCaptureDocumentReconciliation = {
  documentRef: string;
  status: 'reconciled' | 'mismatch' | 'insufficient';
  /** The printed `document_total`, when the read found one. */
  documentTotal?: string;
  /** `Σ sale − Σ void − Σ applied_discount + Σ charge + printed additional VAT`, absent when nothing could be summed. */
  computedTotal?: string;
  difference?: string;
  /** A printed `page n of m` says the file is missing pages the reader never saw (§16.8). */
  suspectedMissingPages: boolean;
  /**
   * W10 D1: the printed rows were ALREADY net of the document-level discount (FlowAccount, PEAK and
   * Leceipt print a per-line discount column and repeat the same total in the summary), so that
   * discount was NOT subtracted a second time. Absent means the ordinary `Σ − discount` was used.
   */
  discountAlreadyInRows?: boolean;
};

/** The assembled observation a job stores: the merged facts plus what they reconcile to. */
export type ExpenseCaptureAssembledObservations = ExpenseCaptureObservations & {
  reconciliation: ExpenseCaptureDocumentReconciliation[];
  /** More than one document or issuer in one file: never applied to a single expense (§3). */
  multiDocument: boolean;
};

/** Declared per-window ceilings of §4.3; past them `itemsTruncated` is true, never a silent cut. */
export const EXPENSE_CAPTURE_OBSERVATION_LIMITS = {
  maxItemsPerWindow: EXPENSE_MAX_ITEM_LINES,
  maxComponentsPerWindow: EXPENSE_MAX_ITEM_LINES,
  maxDocumentsPerWindow: 10,
  maxWindowTextChars: 12_000,
} as const;

// ─── Manifest (§4.4) ──────────────────────────────────────────────────────────

export type ExpenseCaptureManifestPageState = 'pending' | 'read' | 'partial' | 'failed' | 'blank';

export type ExpenseCaptureReadManifest = {
  pageCount: number | null;
  pages: Array<{
    index: number;
    printedNumber?: string;
    state: ExpenseCaptureManifestPageState;
    chunkId?: string;
    textLayerChars?: number;
  }>;
  chunks: Array<{
    id: string;
    kind: ExpenseCaptureChunkKind;
    pageIndexes: number[];
    bytes: number;
    state: 'pending' | 'done' | 'failed';
    calls: number;
    errorCode?: string;
  }>;
  windows: Array<{ id: string; pageIndexes: number[]; state: 'pending' | 'done' | 'failed' }>;
  electronicVerification: { status: ExpenseCaptureElectronicVerification['status'] };
};

/** What a job's manifest looks like before anything has been opened. */
export const emptyExpenseCaptureReadManifest = (): ExpenseCaptureReadManifest => ({
  pageCount: null,
  pages: [],
  chunks: [],
  windows: [],
  electronicVerification: { status: 'NOT_CHECKED' },
});

/** Pages of a manifest that finished, for the "อ่านแล้ว n จาก m หน้า" line. */
export function expenseCapturePagesRead(manifest: ExpenseCaptureReadManifest | null | undefined): number {
  return (manifest?.pages ?? []).filter((page) => page.state === 'read' || page.state === 'blank').length;
}

/** What the web polls while a PDF is being read (§9 `read-status`, both owner types). */
export type ExpenseCaptureReadStatusDto = {
  jobId: string | null;
  status: ExpenseCaptureReadStatus | null;
  pagesRead: number;
  pageCount: number | null;
  pausedReason: ExpenseCapturePausedReason | null;
  lastErrorCode: string | null;
  /** True once the assembly found more than one document or issuer — W04 offers the split. */
  multiDocument: boolean;
  /** Whether the read result was written onto the expense draft (`ownerType EXPENSE` only). */
  applied: boolean;
};

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
  BusinessDocumentClassification,
  BusinessDocumentFamily,
  BusinessDocumentKind,
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
export type ExpenseCapturePausedReason = 'page_limit' | 'call_budget' | 'time_budget' | 'ai_credit';

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

/** A derived source is an ordinary `ExpenseRecord`; the group only reports the lineage. */
export type ExpenseCaptureDerivedSourceDto = {
  expenseId: string;
  scopeKey: string;
  status: string;
  grandTotalAmount: string;
  payerUserId: string | null;
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
  budgetScope?: string;
  usage?: AiUsageEntry[];
  modelLineage?: AiModelLineage;
};

export type ExpenseCaptureExtractWindow = {
  fileLabel: string;
  pageIndexes: number[];
  pages: Array<{ pageIndex: number; text: string }>;
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
  budgetScope?: string;
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
  ref: string;
  pageIndexes: number[];
  kind: BusinessDocumentKind;
  family: BusinessDocumentFamily;
  issuer: { name?: string; taxId?: string; branchCode?: string; storefront?: string; platform?: string };
  buyer?: { name?: string; taxId?: string };
  documentNumber?: string;
  documentDate?: string;
  currency?: string;
  printedPage?: { number?: number; of?: number };
  continuationOfRef?: string;
  classification: BusinessDocumentClassification;
};

export type ExpenseCaptureItemObservation = {
  /** `<page>:<line>` — stable within one read, so a reviewer's selection survives a re-render. */
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
  documentRef: string;
  kind: ExpenseCaptureTotalKind;
  amount: string;
  evidenceSpan: string;
};

export type ExpenseCapturePaymentObservation = {
  documentRef: string;
  method?: string;
  status: 'paid' | 'pending' | 'unknown';
  amount?: string;
  occurredAt?: string;
  reference?: string;
  evidenceSpan: string;
};

export type ExpenseCaptureRefundObservation = {
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

export type ExpenseCaptureObservations = {
  documents: ExpenseCaptureDocumentObservation[];
  items: ExpenseCaptureItemObservation[];
  components: ExpenseCaptureComponentObservation[];
  totals: ExpenseCaptureTotalObservation[];
  payments: ExpenseCapturePaymentObservation[];
  refunds: ExpenseCaptureRefundObservation[];
  completeness: ExpenseCaptureCompleteness;
};

/** Declared per-window ceilings of §4.3; past them `itemsTruncated` is true, never a silent cut. */
export const EXPENSE_CAPTURE_OBSERVATION_LIMITS = {
  maxItemsPerWindow: 120,
  maxComponentsPerWindow: 40,
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

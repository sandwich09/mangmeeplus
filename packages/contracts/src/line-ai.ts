// LINE AI contracts – shared by API (webhook ingress) and AI Gateway (turn orchestration).

import type { SourceRef } from './ai-tools.js';
import type { AiModelLineage, AiModelPolicy, AiUsageEntry } from './ai-lineage.js';
import type { LineAiValueCandidates } from './line-ai-value-normalizer.js';

export type LineAiAgent = 'general' | 'inventory' | 'notifications' | 'cfo' | 'sales' | 'crm' | 'accounting' | 'tax' | 'marketing';

export type LineAiAgentStatus = 'enabled' | 'limited' | 'planned';

export type LineAiAgentDefinition = {
  agent: LineAiAgent;
  label: string;
  status: LineAiAgentStatus;
  toolNames: string[];
};

export const LINE_AI_AGENT_REGISTRY: LineAiAgentDefinition[] = [
  { agent: 'general', label: 'General Assistant', status: 'enabled', toolNames: ['company.get_current_context', 'company.list_branches', 'company.get_employee_summary', 'company.get_employee_detail', 'dashboard.get_business_health_summary', 'notifications.list_open_alerts', 'inventory.get_product_detail', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.get_detail', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail', 'ledger.get_period_status', 'ledger.get_report_summary'] },
  { agent: 'inventory', label: 'Inventory Agent', status: 'enabled', toolNames: ['inventory.search_products', 'inventory.get_product_detail', 'inventory.get_stock_balance', 'inventory.list_low_stock', 'inventory.summarize_stock_movements'] },
  { agent: 'notifications', label: 'Notifications Agent', status: 'enabled', toolNames: ['notifications.list_open_alerts', 'notifications.get_daily_summary'] },
  { agent: 'cfo', label: 'AI CFO', status: 'limited', toolNames: ['ledger.get_financial_summary', 'ledger.get_period_status', 'ledger.get_report_summary', 'dashboard.get_business_health_summary', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.get_detail', 'expense.get_daily_closing', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail'] },
  { agent: 'sales', label: 'Sales Agent', status: 'limited', toolNames: ['sales.get_sales_summary', 'crm.get_customer_summary', 'crm.search_customers', 'crm.get_customer_360', 'crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups', 'crm.get_booking_summary', 'crm.list_bookings', 'crm.get_inbox_summary', 'crm.list_conversations', 'crm.get_conversation_summary', 'crm.suggest_sales_followups'] },
  { agent: 'crm', label: 'CRM Agent', status: 'limited', toolNames: ['crm.get_customer_summary', 'crm.search_customers', 'crm.get_customer_360', 'crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups', 'crm.get_booking_summary', 'crm.list_bookings', 'crm.get_inbox_summary', 'crm.list_conversations', 'crm.get_conversation_summary', 'crm.suggest_sales_followups'] },
  { agent: 'accounting', label: 'Accounting Agent', status: 'limited', toolNames: ['accounting.capture_receipt_evidence', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.list_recent', 'expense.get_detail', 'expense.get_daily_closing', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail', 'ledger.get_period_status', 'ledger.get_report_summary'] },
  {
    agent: 'tax',
    label: 'Tax Agent',
    status: 'limited',
    toolNames: [
      'tax.get_upcoming_tax_obligations',
      'tax.get_vat_summary',
      'tax.get_wht_summary',
      'tax.get_cit_calendar',
      'tax.list_missing_tax_documents',
      'tax.get_tax_code_profile',
      'tax.get_transaction_tax_summary',
      'tax.get_reconciliation_summary',
    ],
  },
  { agent: 'marketing', label: 'Marketing Agent', status: 'planned', toolNames: [] },
];

export type LineAiIntent =
  | 'casual_conversation'
  | 'capability_help'
  | 'read_summary'
  | 'read_detail'
  | 'report_request'
  | 'sales_suggestion'
  | 'capture_accounting_evidence'
  | 'mutation_request'
  | 'unsupported_module'
  | 'forbidden'
  | 'unknown';

export const LINE_AI_BUSINESS_SUBJECTS = [
  'company', 'branch', 'employee', 'customer', 'conversation', 'lead', 'opportunity',
  'follow_up', 'booking', 'crm_report', 'product', 'inventory', 'sale', 'payment',
  'accounting_document', 'expense', 'reimbursement', 'supplier', 'procurement',
  'ledger', 'tax', 'bank', 'workflow', 'report', 'payroll', 'leave', 'fixed_asset',
  'marketplace', 'unknown',
] as const;

export type LineAiBusinessSubject = (typeof LINE_AI_BUSINESS_SUBJECTS)[number];

export type LineAiRefusalReason =
  | 'mutation_blocked'
  | 'safety_crisis'
  | 'privacy_rumor'
  | 'unsupported_module'
  /**
   * In the system, not on LINE yet — a different sentence from `unsupported_module`, which means
   * the subject is outside the product altogether. UAT 2026-09-03: "ทำไม service charge คิดแยกเป็น
   * อีกรายการ" was a question about the sender's own expense record and was answered "อยู่นอกขอบเขต
   * ระบบ", because no LINE tool could answer it yet. Chosen from the TRUSTED intake provenance
   * (`LineAiTurnRequest.intakeIntent`), never from the model's own reading of the message.
   */
  | 'unsupported_yet'
  | 'forbidden'
  | 'unlinked_user'
  | 'ambiguous_company'
  | 'tool_unavailable'
  | 'feature_disabled'
  | 'ai_timeout'
  | 'line_delivery_failure';

/** Identity reported by the executing AgentCore artifact itself. All fields are immutable build
 * evidence; an older artifact omits the whole object rather than inventing partial identity. */
export type LineAiRuntimeIdentity = {
  sourceCommit: string;
  artifactSha256: string;
  serviceVersion: string;
  contractVersion: number;
};

/** Identity the signed ECS candidate expects before an invocation begins. Unlike the artifact's
 * reported identity this deliberately has no serviceVersion: it is derived from retained release
 * evidence and therefore remains available on timeout or network failure. */
export type LineAiExpectedRuntimeIdentity = Omit<LineAiRuntimeIdentity, 'serviceVersion'>;

export const LINE_AI_RUNTIME_CONTRACT_VERSION = 1;

/** Measured seams only. Optional fields keep older AgentCore artifacts wire-compatible. */
export type LineAiStageDurations = {
  bodyReadMs?: number;
  payloadValidationMs?: number;
  orchestrationMs?: number;
  runtimeTotalMs?: number;
  agentcoreHttpMs?: number;
};

export type LineAiRuntimeBinding = {
  /** SHA-256 prefix of the configured runtime ARN; enough to correlate without logging an ARN. */
  runtimeArnHash: string;
  qualifier: string;
};

/** Server-derived LINE user context – never populated from LINE user text. */
export type LineUserContext = {
  lineUserId: string;
  internalUserId: string;
  companyId: string;
  membershipId: string;
  permissions: string[];
  /** Server-resolved permissions removed only because their owning company feature is OFF.
   * Internal policy evidence only: never place this map in model prompts or customer output. */
  entitlementDeniedPermissions?: Record<string, string>;
  /** Exact server-resolved feature set. `null` preserves the legacy fail-open convention;
   * `undefined` keeps older callers/artifacts wire-compatible. Internal policy evidence only. */
  entitledFeatureKeys?: string[] | null;
  roles: string[];
  branchIds?: string[];
  locationIds?: string[];
  locale: string;
  conversationId?: string;
  /**
   * Spec §5.5: the chat this turn belongs to, as the SAME salted hash the intake lane stores on a
   * LINE-captured record (`chatKeyHashOf`). It is what lets a read tool resolve "บิลเมื่อกี้" to the
   * record captured in THIS chat instead of any record the user owns, so the explain tool and the
   * correction lane share one provenance rule.
   *
   * DATA, never authorization: company, membership, permissions and branch scope are re-resolved
   * server-side from the actor delegation, so the worst a wrong value can do is narrow (or, at
   * most, widen to another of the SAME user's own chats) which of their own records is explained.
   */
  chatKeyHash?: string;
};

/** Single source of truth for the short-term LINE memory window (api loader, gateway prompts,
 *  agentcore passthrough all derive from these — do not hardcode the numbers elsewhere). */
export const LINE_AI_CONTEXT_WINDOW_MINUTES = 15;
export const LINE_AI_CONTEXT_MAX_TURNS = 15;
export const LINE_AI_ACTOR_DELEGATIONS_PER_TOOL = 8;

export type LineAiConversationContextTurn = {
  at: string;
  userMessagePreview?: string;
  assistantReplyPreview?: string;
  intent?: string;
  agent?: string;
  refused?: boolean;
};

export type LineAiConversationContext = {
  /** Previous stored LINE turns included only when the latest turn is within this window. */
  windowMinutes: number;
  /** Max previous AiTurn rows included. */
  maxTurns: number;
  lastTurnAt?: string;
  recentTurns: LineAiConversationContextTurn[];
};

/** Internal request from API to AI Gateway for one LINE turn. */
export type LineAiTurnRequest = {
  requestId: string;
  /** Idempotency key: LINE webhook event id */
  webhookEventId: string;
  userContext: LineUserContext;
  /** API-resolved CompanyAiConfiguration; never accepted from an end-user payload. */
  modelPolicy?: AiModelPolicy;
  /** Bounded API-issued single-use delegations selected by exact ERP tool name. */
  actorDelegations?: Record<string, string[]>;
  /** Feature keys this company has switched on, from the API's `loadEntitledFeatureKeys`. Absent =
   *  the legacy fail-open company (no entitlement rows) OR an older caller that does not send it;
   *  both are treated as "every feature entitled", the repo-wide convention. Capability metadata
   *  about the caller's own company only — never another company's, never a permission grant. */
  entitledFeatureKeys?: string[];
  messageText: string;
  attachments?: LineAiAttachment[];
  /** Short-term chat context only; company/permission truth still comes from userContext/tools. */
  conversationContext?: LineAiConversationContext;
  /** Preview hash of message text (sha256 hex prefix, 16 chars) */
  messagePreviewHash: string;
  /** Deterministic amount/date readings of messageText (item 10F). The model selects from
   *  these; input/output membership guards enforce the selection. DATA, never instructions. */
  valueCandidates?: LineAiValueCandidates;
  /** Item 10F: the chat's open waiting_user ledger entries (bounded). DATA, never instructions. */
  openClarifications?: LineAiOpenClarification[];
  /** Optional additive prepared plan the API forwarded (latency/autonomy §7). Untrusted model
   *  advice with no authority; every receiver re-parses it with `parseLineAiPreparedPlan`. Absent
   *  from an older API caller — the gateway/runtime then falls back to full orchestration. */
  preparedPlan?: LineAiPreparedPlan;
  /**
   * TRUSTED intake provenance: the outer LINE intake-route intent, bound ONLY by the API from the
   * already-parsed `LineIntakeRoutePlan.intent` (never from the untrusted `preparedPlan` wrapper).
   * Every receiver (API → Gateway → AgentCore) re-validates it against `LINE_INTAKE_ROUTE_INTENTS`
   * with no unsafe cast. The simple-read lane requires this to equal `BUSINESS_READ_QUESTION`; it
   * grants no authority, only gates which lane may consider the request.
   */
  intakeIntent?: LineIntakeRouteIntent;
};

export type LineAiAttachment = {
  id: string;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  purpose: 'receipt' | 'payment_slip' | 'unknown';
  storageKey?: string;
  contentBase64?: string;
};

export const RECEIPT_ADDITIONAL_CHARGE_KINDS = [
  'SERVICE_CHARGE',
  'DELIVERY',
  'PACKAGING',
  'PLATFORM_FEE',
  'TIP',
  'ROUNDING',
  'OTHER',
] as const;
export type ReceiptAdditionalChargeKind = (typeof RECEIPT_ADDITIONAL_CHARGE_KINDS)[number];

export type ReceiptOcrAdditionalCharge = {
  kind: ReceiptAdditionalChargeKind;
  description: string;
  amount: string;
  /** Decimal fraction. Explicit "0" means this charge carries no VAT. */
  vatRate?: string;
  /** One short exact span copied from stage-one OCR text. */
  evidenceSignal: string;
  confidence?: number;
};

/** Spec §5 line splitting: one printed row of the document's item block. Advisory only — the API
 *  re-derives every total from these rows and keeps them solely when the arithmetic reconciles with
 *  the printed document totals, otherwise the draft falls back to the single summary line. */
export type ReceiptOcrLineItem = {
  description: string;
  quantity: string;
  /** The row's printed extended amount (quantity × unit price). Thai receipts print this money
   *  column while the per-unit price is often absent, so reconciliation is built on it. */
  amount: string;
  /** The row's printed per-unit price, when the document actually shows one. */
  unitPrice?: string;
  /**
   * This row's own VAT rate, present ONLY when the page marks tax per row (UAT survey 2026-08-28
   * found 3 of 38 real receipts doing exactly this: a `V` suffix on taxed prices, `N` or `P` on
   * exempt ones). Absent means "the document-level rate applies", which is what 25 of 38 receipts
   * print and stays the existing behaviour — never a guess that a row is untaxed.
   */
  vatRate?: string;
  /** Why this row carries no VAT, when the page says so. Mirrors ExpenseLine.vatTreatment and is
   *  only ever accepted together with a zero `vatRate`. */
  vatTreatment?: 'ZERO_RATED' | 'EXEMPT' | 'NON_VAT';
  /** One short exact span copied from stage-one OCR text. */
  evidenceSignal: string;
  confidence?: number;
};

export type ReceiptOcrFieldResult = {
  vendorName?: string;
  vendorTaxId?: string;
  vendorBranchCode?: string;
  documentNumber?: string;
  expenseDate?: string;
  description?: string;
  quantity?: string;
  unitPrice?: string;
  vatRate?: string;
  subtotalAmount?: string;
  discountAmount?: string;
  taxableAmount?: string;
  vatAmount?: string;
  whtRate?: string;
  whtAmount?: string;
  grandTotalAmount?: string;
  /**
   * ISO 4217 code of the money PRINTED ON THE DOCUMENT, when the page shows one (a ฿/$/€/¥ symbol,
   * a printed code, or plainly Thai wording). Absent means the page did not say — no reader may
   * assume THB from absence. This is read-only evidence for the reviewer: the ERP stays THB-based,
   * the amounts above are still copied verbatim, and NOTHING converts them (UAT 2026-08-29: a
   * $200.00 USD invoice was recorded as 200 บาท, silently wrong by the exchange rate).
   */
  currency?: string;
  vatMode?: 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW';
  /** Printed item rows in document order, when the item block is legible. The single
   *  description/quantity/unitPrice above stays the whole-document summary the draft uses whenever
   *  these rows are absent or fail reconciliation. */
  lines?: ReceiptOcrLineItem[];
  /** Positive printed charges only; discounts/negative rounding stay in discountAmount. */
  additionalCharges?: ReceiptOcrAdditionalCharge[];
  /** Optional reporting-category suggestion. It is advisory until the API revalidates
   *  tenant, active state, confidence, and preservation of any reviewed category. */
  categorySuggestion?: {
    expenseCategoryId: string;
    confidence: number;
    /** Short exact spans copied from stage-1 OCR text; never reasoning or catalogue text. */
    evidenceSignals: string[];
  };
  confidence?: number;
  missingFields?: string[];
};

/** Shared API auto-fill gate for receipt reporting-category suggestions. */
export const RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE = 0.85;

export const BUSINESS_DOCUMENT_CONTENT_KINDS = [
  'DOCUMENT', 'MULTI_DOCUMENT', 'NON_DOCUMENT_IMAGE', 'UNREADABLE', 'AMBIGUOUS',
] as const;
export type BusinessDocumentContentKind = (typeof BUSINESS_DOCUMENT_CONTENT_KINDS)[number];

export const BUSINESS_DOCUMENT_FAMILIES = [
  'EXPENSE_EVIDENCE', 'COMMERCIAL_DOCUMENT', 'PAYMENT_EVIDENCE', 'SCHEDULING_DOCUMENT',
  'SIGNATURE_ASSET', 'OTHER_BUSINESS_DOCUMENT', 'NON_BUSINESS',
] as const;
export type BusinessDocumentFamily = (typeof BUSINESS_DOCUMENT_FAMILIES)[number];

export const BUSINESS_DOCUMENT_KINDS = [
  // ABBREVIATED_TAX_INVOICE (ใบกำกับภาษีอย่างย่อ, Revenue Code s.86/6) is separate from TAX_INVOICE
  // because only the full form supports an input-VAT credit. Spec §19h.
  'RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'SUPPLIER_INVOICE_OR_BILL', 'ORDER_OR_CHECK_BILL',
  'QUOTATION', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'TRANSFER_SLIP', 'MARKETPLACE_ORDER',
  'HANDWRITTEN_CASH_BILL', 'APPOINTMENT_CARD', 'BOOKING_CONFIRMATION',
  'RESERVATION_CONFIRMATION', 'SIGNATURE_IMAGE', 'OTHER_BUSINESS_DOCUMENT',
  'NON_FINANCIAL_IMAGE', 'NEEDS_REVIEW',
] as const;
export type BusinessDocumentKind = (typeof BUSINESS_DOCUMENT_KINDS)[number];

export const BUSINESS_DOCUMENT_DIRECTIONS = [
  'PURCHASE_EXPENSE', 'SALES_RECEIVABLE', 'CUSTOMER_INBOUND', 'UNKNOWN',
] as const;
export type BusinessDocumentDirection = (typeof BUSINESS_DOCUMENT_DIRECTIONS)[number];

export const BUSINESS_DOCUMENT_TRANSACTION_STATES = [
  'PROPOSED', 'ORDERED', 'DUE', 'PAID', 'SCHEDULED', 'CONFIRMED', 'CANCELLED', 'UNKNOWN',
] as const;
export type BusinessDocumentTransactionState = (typeof BUSINESS_DOCUMENT_TRANSACTION_STATES)[number];

export const BUSINESS_DOCUMENT_EVIDENCE_ROLES = [
  'EXPENSE_SUPPORT', 'TAX_EVIDENCE_CANDIDATE', 'PAYMENT_PROOF', 'COMMERCIAL_PROPOSAL',
  'SCHEDULING_PROOF', 'CONVERSATION_ATTACHMENT',
] as const;
export type BusinessDocumentEvidenceRole = (typeof BUSINESS_DOCUMENT_EVIDENCE_ROLES)[number];

export const BUSINESS_DOCUMENT_REASON_CODES = [
  'NO_DOCUMENT_STRUCTURE', 'UNREADABLE_OR_CROPPED', 'MULTIPLE_DOCUMENTS',
  'LOW_CLASSIFICATION_CONFIDENCE', 'CONTRADICTORY_SIGNALS', 'QUANTITY_ONLY',
  'MISSING_MONETARY_AMOUNT', 'MISSING_TRANSACTION_TOTAL', 'MISSING_PAYMENT_EVIDENCE',
  'ORDER_ONLY', 'MISSING_VENDOR', 'MISSING_DOCUMENT_NUMBER', 'MISSING_VENDOR_TAX_ID',
  'MISSING_TAX_BASE_OR_VAT', 'QUOTATION_NOT_TRANSACTION', 'PAYMENT_EVIDENCE_ONLY',
  'MISSING_SCHEDULED_TIME', 'MISSING_PARTY_OR_PROVIDER', 'MISSING_BOOKING_REFERENCE',
  'AMBIGUOUS_BUSINESS_DIRECTION', 'CHANNEL_SCOPE_MISMATCH', 'TARGET_PERMISSION_MISSING',
  'TARGET_MODULE_DISABLED', 'OCR_UNAVAILABLE', 'HUMAN_REVIEW_REQUIRED',
] as const;
export type BusinessDocumentReasonCode = (typeof BUSINESS_DOCUMENT_REASON_CODES)[number];

/** Global advisory classification. Source modules still enforce permission, state, and mutation gates. */
export type BusinessDocumentClassification = {
  contentKind: BusinessDocumentContentKind;
  documentFamily: BusinessDocumentFamily;
  documentKind: BusinessDocumentKind;
  businessDirection: BusinessDocumentDirection;
  transactionState: BusinessDocumentTransactionState;
  evidenceRoles: BusinessDocumentEvidenceRole[];
  confidence: number;
  /** Short OCR spans only; never raw provider output or chain-of-thought. */
  evidenceSignals: string[];
  /** OCR spans identifying transaction-specific amounts/totals. */
  amountSignals: string[];
  /** OCR spans identifying receipt/paid/settlement state. */
  settlementSignals: string[];
  missingRequiredSignals: BusinessDocumentReasonCode[];
  contradictionSignals: BusinessDocumentReasonCode[];
  requiresClarification: boolean;
};

export type ReceiptOcrRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  modelPolicy?: AiModelPolicy;
  /** API-derived active company/global reporting categories; DATA, never instructions. */
  activeCategories?: Array<{ id: string; name: string }>;
  attachment: LineAiAttachment;
  /**
   * Stage-one text for this exact attachment, produced by the intake router's own read of the same
   * image. When present and usable, receipt OCR skips its own read; the §13 value cross-check runs
   * against this text exactly as it would against a fresh read, so extraction is still checked
   * against what the page says rather than against itself.
   */
  documentText?: string;
};

export type ReceiptOcrResponse = {
  status: 'ok' | 'not_configured' | 'failed';
  fields?: ReceiptOcrFieldResult;
  classification?: BusinessDocumentClassification;
  modelLineage?: AiModelLineage[];
  errorCode?: string;
  /** One entry per model call the gateway made for this request; absent from an older gateway. */
  usage?: AiUsageEntry[];
};

// ─── LINE Intake Router (item 10B front-stage for item 09 intake) ────────────
// The router classifies a LINE message semantically BEFORE any source-module
// use case runs. It emits a route plan only: it must not answer users, call ERP
// tools, create records, or approve/apply signatures.

export type LineIntakeRouteIntent =
  | 'EXPENSE_DOCUMENT_CAPTURE'
  /** Answers an already-persisted LINE expense draft; never creates a second record. */
  | 'EXPENSE_DRAFT_CONTINUATION'
  /** Correcting a field of a record this assistant already captured — never a new capture. */
  | 'EXPENSE_CAPTURE_CORRECTION'
  | 'SUBSTITUTE_RECEIPT_CONTINUATION'
  /** The user asks to be paid back for money they advanced (ขอเบิก/เบิกคืน/สำรองจ่าย). Handoff or
   *  clarify room ONLY — it must never fall through to expense capture and never creates a record by
   *  itself (uat-correctness-latency spec §7/§9). */
  | 'REIMBURSEMENT_REQUEST_START'
  | 'BUSINESS_DOCUMENT_REFERENCE'
  | 'SIGNATURE_UPLOAD_TICKET'
  | 'BUSINESS_READ_QUESTION'
  /** Advisor conversation (advisor spec §9): social/general-advice talk with no attachment, no open
   *  continuation and no live tool need. Emitted ONLY under the trusted `advisor` capability. It grants
   *  NO authority and no lane of its own yet: every receiver validates membership and treats it exactly
   *  like `UNSUPPORTED` (casual/capability/full path) until the direct-answer lane ships. */
  | 'ADVISOR_CONVERSATION'
  | 'MUTATION_REQUEST_REFUSAL'
  | 'CLARIFY'
  | 'UNSUPPORTED';

/** Runtime mirror of {@link LineIntakeRouteIntent} (parity-tested) so bounded parsers can validate an
 *  untrusted intake-intent string by explicit membership instead of a blind cast. */
export const LINE_INTAKE_ROUTE_INTENTS = [
  'EXPENSE_DOCUMENT_CAPTURE',
  'EXPENSE_DRAFT_CONTINUATION',
  'EXPENSE_CAPTURE_CORRECTION',
  'SUBSTITUTE_RECEIPT_CONTINUATION',
  'REIMBURSEMENT_REQUEST_START',
  'BUSINESS_DOCUMENT_REFERENCE',
  'SIGNATURE_UPLOAD_TICKET',
  'BUSINESS_READ_QUESTION',
  'ADVISOR_CONVERSATION',
  'MUTATION_REQUEST_REFUSAL',
  'CLARIFY',
  'UNSUPPORTED',
] as const satisfies readonly LineIntakeRouteIntent[];

const LINE_INTAKE_ROUTE_INTENT_SET: ReadonlySet<string> = new Set(LINE_INTAKE_ROUTE_INTENTS);

/** Receiver-boundary validator: narrow an untrusted value to a known intake-route intent by explicit
 *  membership (no unsafe cast), or `undefined`. Used by every API→Gateway→AgentCore hop that carries
 *  the trusted outer `LineAiTurnRequest.intakeIntent` provenance. */
export function asIntakeRouteIntent(value: unknown): LineIntakeRouteIntent | undefined {
  return typeof value === 'string' && LINE_INTAKE_ROUTE_INTENT_SET.has(value)
    ? (value as LineIntakeRouteIntent)
    : undefined;
}

/** The two intake outcomes that are NOT about the company's own records: one the router could not
 *  place, and one it placed outside the product. Listed as the exception so a new member of
 *  {@link LINE_INTAKE_ROUTE_INTENTS} — every one of which so far is an expense, a document, a
 *  reading or an advisory turn — is business without a second edit here. */
const NON_BUSINESS_INTAKE_INTENTS: readonly LineIntakeRouteIntent[] = ['CLARIFY', 'UNSUPPORTED'];

/** True when the API's own intake routing already placed this turn inside the business (spec
 *  §5.3). A refusal on such a turn means "LINE cannot do this yet" (`unsupported_yet`), never
 *  "that subject is outside the system" (`unsupported_module`). */
export function isBusinessIntakeIntent(value: unknown): boolean {
  const intent = asIntakeRouteIntent(value);
  return intent !== undefined && !NON_BUSINESS_INTAKE_INTENTS.includes(intent);
}

// ─── Semantic expense-vs-reimbursement contract (uat-correctness-latency spec §7) ─────────────
// Bounded, explicitly encoded on the route plan — never inferred later from the intent name. Both
// are untrusted model advice: `AMBIGUOUS` and `UNKNOWN` are deterministic mutation vetoes, and only a
// server-verified BUSINESS_EXPENSE + COMPANY_PAID may ever reach expense capture in a primary mode.

export const LINE_INTAKE_SEMANTIC_OUTCOMES = ['BUSINESS_EXPENSE', 'REIMBURSEMENT_CLAIM', 'AMBIGUOUS'] as const;
export type LineIntakeSemanticOutcome = (typeof LINE_INTAKE_SEMANTIC_OUTCOMES)[number];
const LINE_INTAKE_SEMANTIC_OUTCOME_SET: ReadonlySet<string> = new Set(LINE_INTAKE_SEMANTIC_OUTCOMES);

export const LINE_INTAKE_FUNDING_SOURCES = ['COMPANY_PAID', 'EMPLOYEE_PAID', 'UNKNOWN'] as const;
export type LineIntakeFundingSource = (typeof LINE_INTAKE_FUNDING_SOURCES)[number];
const LINE_INTAKE_FUNDING_SOURCE_SET: ReadonlySet<string> = new Set(LINE_INTAKE_FUNDING_SOURCES);

/** Explicit membership (no cast) for an untrusted semantic outcome; `undefined` when not a member. */
export function asIntakeSemanticOutcome(value: unknown): LineIntakeSemanticOutcome | undefined {
  return typeof value === 'string' && LINE_INTAKE_SEMANTIC_OUTCOME_SET.has(value)
    ? (value as LineIntakeSemanticOutcome)
    : undefined;
}

/** Explicit membership (no cast) for an untrusted funding source; `undefined` when not a member. */
export function asIntakeFundingSource(value: unknown): LineIntakeFundingSource | undefined {
  return typeof value === 'string' && LINE_INTAKE_FUNDING_SOURCE_SET.has(value)
    ? (value as LineIntakeFundingSource)
    : undefined;
}

/** The ONLY field names a typed clarification (expense or reimbursement) may report as missing,
 *  accepted, or conflicting — enum-only so logs and errors never carry raw conversation or PII. */
export const LINE_INTAKE_CLARIFICATION_FIELDS = [
  'fundingSource', 'amount', 'description', 'purpose', 'incurredDate', 'categoryKey', 'reason',
] as const;
export type LineIntakeClarificationField = (typeof LINE_INTAKE_CLARIFICATION_FIELDS)[number];
const LINE_INTAKE_CLARIFICATION_FIELD_SET: ReadonlySet<string> = new Set(LINE_INTAKE_CLARIFICATION_FIELDS);

/** Keep only known clarification fields (deduplicated, bounded); anything else is dropped. */
export function asIntakeClarificationFields(value: unknown): LineIntakeClarificationField[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is LineIntakeClarificationField =>
    typeof item === 'string' && LINE_INTAKE_CLARIFICATION_FIELD_SET.has(item)))].slice(0, LINE_INTAKE_CLARIFICATION_FIELDS.length);
}

/** Bounded semantic hints for REIMBURSEMENT_REQUEST_START. Deliberately a DIFFERENT type from
 *  {@link LineIntakeCaptureHints}: an expense category id and a reimbursement category key are different
 *  authorities. Every value is model advice the API re-grounds; the first release displays them on a
 *  handoff card only and writes nothing. */
export type LineIntakeReimbursementHints = {
  description?: string;
  businessPurpose?: string;
  /** Must be selected from valueCandidates.amounts (membership-guarded at parse). */
  amount?: string;
  /** Must be selected from valueCandidates.dates (membership-guarded at parse). */
  incurredDate?: string;
  /** Reserved for the DRAFT amendment: accepted ONLY from a server allowlist, which this release never sends. */
  categoryKey?: string;
  /** Grounded claim reason for the header; never model-invented. */
  reason?: string;
  confidence?: number;
  missingFields?: LineIntakeClarificationField[];
};

/** Prisma `AiTurnIntent` mirror (parity-tested). Distinct from apps/api's
 *  `AI_TURN_INTENTS`, which is the narrower normalization subset. */
export const AI_TURN_INTENT_VALUES = [
  'READ_SUMMARY', 'READ_DETAIL', 'MUTATION_REQUEST', 'UNSUPPORTED_MODULE', 'FORBIDDEN', 'UNKNOWN',
  'EVIDENCE_CAPTURE', 'SIGNATURE_REQUEST', 'CLARIFY', 'CORRECTION',
] as const;
export type AiTurnIntentValue = (typeof AI_TURN_INTENT_VALUES)[number];

export const LINE_EXPENSE_ACCOUNTING_CLASSES = ['OPEX', 'ASSET', 'INVENTORY', 'LIABILITY', 'REVENUE', 'UNKNOWN'] as const;
export type LineExpenseAccountingClass = (typeof LINE_EXPENSE_ACCOUNTING_CLASSES)[number];
export const LINE_EXPENSE_ITEM_BEHAVIORS = ['STOCKABLE', 'NON_STOCK', 'SERVICE', 'UNKNOWN'] as const;
export type LineExpenseItemBehavior = (typeof LINE_EXPENSE_ITEM_BEHAVIORS)[number];

/** One source-grounded item candidate. Values remain advisory until the API validates them. */
export type LineIntakeExpenseItemHint = {
  /** Stable question/item ref from an active draft (for example I01); omit for a new item. */
  itemRef?: string;
  /** Exact short span from this message naming the item. */
  sourceText?: string;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalAmount?: string;
  /** Must be an id from LineIntakeRouteRequest.activeCategories. */
  expenseCategoryId?: string;
  accountingClass?: LineExpenseAccountingClass;
  itemBehavior?: LineExpenseItemBehavior;
  taxTreatment?: string;
  confidence?: number;
  missingFields?: string[];
};

/** Bounded semantic capture hints for EXPENSE_DOCUMENT_CAPTURE handoff.
 * All values are AI suggestions; deterministic API guards decide insertion. */
export type LineIntakeCaptureHints = {
  /** Active draft selected only from LineIntakeRouteRequest.activeExpenseDrafts. */
  targetExpenseId?: string;
  sourceDocumentType?: string;
  sourceDocumentLanguage?: string;
  vendorName?: string;
  description?: string;
  expenseDate?: string;
  amount?: string;
  vatMode?: 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW';
  /** Must be an id from LineIntakeRouteRequest.activeCategories to be inserted. */
  expenseCategoryId?: string;
  businessPurpose?: string;
  items?: LineIntakeExpenseItemHint[];
  confidence?: number;
  missingFields?: string[];
};

/** Bounded database-backed context for semantic routing only. The API reloads and authorizes it. */
export type LineExpenseDraftRouteContext = {
  expenseId: string;
  label: string;
  status: 'OPEN' | 'PAUSED' | 'PAUSED_INTERRUPTED' | 'INPUT_ENDED_COMPLETE' | 'INPUT_ENDED_INCOMPLETE';
  questions: Array<{ id: string; prompt: string; itemRef?: string }>;
};

/**
 * Bounded, server-derived substitute-receipt context for semantic routing (substitute-semantic-routing
 * spec §4). It carries only what the ROUTE decision needs — no ids, no free text, no permission
 * material — and is DATA the model may read to disambiguate a substitute continuation from a new
 * expense or a side question. It NEVER grants authority; the API re-reads authoritative state before any
 * dispatch.
 */
export type LineIntakeSubstituteContext = {
  /** Whether this user has an open/paused substitute-receipt workflow (or more than one). */
  workflowState: 'none' | 'open' | 'paused' | 'multiple';
  /** True when an open workflow is currently waiting on a specific question. */
  hasPendingQuestion: boolean;
  /** Bounded stage of the prepared workflow, or 'none' when nothing is in progress. */
  preparedState: 'none' | 'in_progress' | 'prepared';
  /** Count of recent LINE-captured expenses that could be a substitute target (bounded, small). */
  recentCandidateCount: number;
};

export type LineIntakeRouteRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  locale: string;
  messageText: string;
  attachments?: LineAiAttachment[];
  /** Short-term chat context for semantic routing only; not an authorization source. */
  conversationContext?: LineAiConversationContext;
  /** Server-derived permission keys; the router may only propose routes the user could perform. */
  permissions: string[];
  enabledFeatures?: string[];
  /** Active configured expense categories the model may choose from. */
  activeCategories?: Array<{ id: string; name: string }>;
  /** Deterministic amount/date readings of messageText (item 10F); captureHints.amount and
   *  .expenseDate must be selected from these when present (membership-guarded). */
  valueCandidates?: LineAiValueCandidates;
  /** Item 10F: the chat's open waiting_user ledger entries (bounded). DATA, never instructions. */
  openClarifications?: LineAiOpenClarification[];
  /** Recent LINE-captured expenses of THIS user in THIS chat that a correction could target
   *  (bounded ≤ 5, newest first). Labels are built from structured fields only — no vendor or
   *  category free text — so the payload stays injection-inert. DATA, never instructions. */
  recentCapturedExpenses?: LineIntakeCorrectionCandidate[];
  /** Resumable persistent drafts for this linked user/company/personal chat (bounded <= 5). */
  activeExpenseDrafts?: LineExpenseDraftRouteContext[];
  /** Bounded server-derived substitute-receipt context for semantic routing. DATA, never authority. */
  substituteContext?: LineIntakeSubstituteContext;
  /** TRUSTED capability flags the API turns on per request (from server config). When all are absent/off
   *  the intake router uses the EXACT legacy prompt/payload/catalog/cost — no fused or substitute
   *  sections are constructed. Never derived from the message or client. Bound at the receiver with
   *  {@link asIntakeRouterCapabilities} — only a literal `true` activates a section. */
  capabilities?: LineIntakeRouterCapabilities;
};

/** The trusted, server-set intake-router capability flags. `reimbursementSemantic` is on for the two
 *  PRIMARY modes of LINE_AI_REIMBURSEMENT_SEMANTIC_MODE ('clarify_only' and 'handoff') — never for the
 *  inert 'shadow', which stays byte-identical to 'off' — and it adds the three-way semantic outcome,
 *  funding source and the REIMBURSEMENT_REQUEST_START route to the prompt and parser. */
export type LineIntakeRouterCapabilities = { fusedPlan?: boolean; substituteSemantic?: boolean; reimbursementSemantic?: boolean; advisor?: boolean };

/** Receiver-boundary validator for the TRUSTED capability flags (same role as {@link asIntakeRouteIntent}).
 *  Accepts ONLY a literal boolean `true` for each known key; EVERY other shape — a truthy
 *  non-boolean (`1`, `"true"`, `{}`, `[]`), a `false`, `null`, a non-object, or any unknown/nested key — is
 *  discarded. So a malformed or hostile `line-intake-route` body can NEVER activate the fused-plan,
 *  substitute or reimbursement prompt sections (and their ~21KB catalog / larger token budget): activation
 *  requires the API to have set an actual boolean `true`. Returns a bounded object carrying at most the known keys. */
export function asIntakeRouterCapabilities(value: unknown): LineIntakeRouterCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const caps: LineIntakeRouterCapabilities = {};
  // OWN literal-true only: Object.hasOwn ignores anything reachable via the prototype chain (a `__proto__`
  // key, a polluted Object.prototype), so only a real own boolean `true` the API set can activate a section.
  if (Object.hasOwn(raw, 'fusedPlan') && raw.fusedPlan === true) caps.fusedPlan = true;
  if (Object.hasOwn(raw, 'substituteSemantic') && raw.substituteSemantic === true) caps.substituteSemantic = true;
  if (Object.hasOwn(raw, 'reimbursementSemantic') && raw.reimbursementSemantic === true) caps.reimbursementSemantic = true;
  // Advisor Slice A (advisor spec §9/§17): gates the ADVISOR_CONVERSATION route and the advisorAnswer
  // envelope. Off ⇒ byte-exact legacy prompt/payload, exactly like the three flags above.
  if (Object.hasOwn(raw, 'advisor') && raw.advisor === true) caps.advisor = true;
  return caps;
}

/** One correction target offered to the router. The model may only select from this list. */
export type LineIntakeCorrectionCandidate = {
  id: string;
  /** Structured-only summary, e.g. "บิลเงินสดเขียนมือ · 17 มิ.ย. 2569 · 59.00". */
  label: string;
  amount?: string;
  expenseDate?: string;
  sourceDocumentType?: string;
  createdAt: string;
};

/** Max correction candidates offered per turn (also the gateway parse bound). */
export const LINE_CORRECTION_CANDIDATE_LIMIT = 5;

/** A corrected field always carries where it is going, and — when the message says so — where it
 *  came from. `from` is what lets the API refuse "เลขเดิม 123 แก้เป็น 456" writing back 123: both
 *  numbers are grounded in the text, so only the stated direction can disambiguate them. */
export type LineIntakeCorrectionValue = { to: string; from?: string };

/** Bounded correction hints (phase 2). Every value is a model SELECTION from grounded evidence;
 *  deterministic API guards decide what is written. No category or source-document-type here —
 *  those corrections are deferred until their line/tax semantics are specified. */
export type LineIntakeCorrectionHints = {
  /** Must be an id from `recentCapturedExpenses`; anything else is stripped at parse. */
  targetExpenseId?: string;
  expenseDate?: LineIntakeCorrectionValue;
  amount?: LineIntakeCorrectionValue;
  vendorName?: LineIntakeCorrectionValue;
  documentNumber?: LineIntakeCorrectionValue;
  /** Maps to the expense HEADER note, never a line description. */
  note?: LineIntakeCorrectionValue;
  confidence?: number;
  missingFields?: string[];
};

/** The correction fields a v1 apply may touch, in the order a confirmation reply lists them. */
export const LINE_CORRECTION_FIELDS = ['expenseDate', 'amount', 'vendorName', 'documentNumber', 'note'] as const;
export type LineCorrectionField = (typeof LINE_CORRECTION_FIELDS)[number];

// ─── Prepared advisor contract (advisor spec §6/§9) ────────────────────────────────────────────
// One brain, several rooms: the mode names which room a turn belongs to. Slice A ships SOCIAL_CHAT
// only — the other members exist so the enum is the spec's, not a moving target, but nothing routes
// to them yet and each stays fail-closed at every eligibility gate until its slice lands.
export const MANGMEE_CONVERSATION_MODES = [
  'SOCIAL_CHAT',
  'BUSINESS_ADVISOR',
  'COMPANY_INSIGHT',
  'LIVE_QUERY',
  'ACTION_OR_HANDOFF',
  'SAFETY_OR_PRIVACY',
] as const;
export type MangmeeConversationMode = (typeof MANGMEE_CONVERSATION_MODES)[number];

/** The ONE enum an advisor draft may hand to the existing composer when the draft itself is discarded
 *  (spec §6/§9): a single acknowledging line prepended to a LIVE_QUERY answer, never free-form text. */
export const ADVISOR_TONE_PREFACES = ['none', 'acknowledge_stress', 'acknowledge_good_news'] as const;
export type AdvisorTonePreface = (typeof ADVISOR_TONE_PREFACES)[number];

/** Bounded refusal vocabulary (spec §9). A refusal is always one of these codes — never a raw
 *  model sentence — so nothing free-form can reach a log line or a delivered reply. */
export const ADVISOR_REFUSAL_CODES = [
  'mutation_blocked',
  'safety_crisis',
  'privacy_rumor',
  'unsupported_module',
  /** Same split as {@link LineAiRefusalReason}: in the system, not on LINE yet. */
  'unsupported_yet',
  'insufficient_current_data',
] as const;
export type AdvisorRefusalCode = (typeof ADVISOR_REFUSAL_CODES)[number];

/**
 * Bounded advisor answer the intake router MAY propose (spec §9). UNTRUSTED model advice with NO
 * execution authority: it is parsed by its own bounded parser (`parseLineAiPreparedAdvisorAnswer`),
 * it never nests inside `LineAiPreparedPlan` (that wrapper is tied to `capabilities.fusedPlan` and its
 * ~21KB catalog), and there is no second trust chain — the server re-derives eligibility, and
 * `confidence` is veto-only (a high value never makes an ineligible lane eligible).
 */
export type PreparedAdvisorAnswer = {
  version: 1;
  mode: MangmeeConversationMode;
  confidence: number;
  /** HIGH-risk cards and finance/trend only (deterministic renderer); unused in Slice A. */
  responseFamilyId?: string;
  /** SOCIAL_CHAT and LOW/MEDIUM business/company prose. */
  answerText?: string;
  /** MUST be a subset of `LineIntakeRoutePlan.advisorContext.offeredCards`; `[]` in Slice A. */
  knowledgeCardIds: string[];
  /** MUST be a subset of the permission-checked profile the server loaded; `[]` in Slice A. */
  companyProfileFieldsUsed: string[];
  needsTools: boolean;
  tonePreface?: AdvisorTonePreface;
  clarificationQuestion?: string;
  refusalCode?: AdvisorRefusalCode;
};

/** SERVER-derived audit context for an advisor turn (spec §9): what the server offered the model and
 *  whether a profile was loaded. Never parsed from model output — a wire value claiming to be this is
 *  ignored, so the model can never widen its own citation or profile surface. */
export type LineIntakeAdvisorContext = {
  offeredCards: Array<{ id: string; version: number }>;
  profileLoaded: boolean;
};

export type LineIntakeRoutePlan = {
  /** ROUTED = model produced a usable route; UNAVAILABLE = provider disabled/misconfigured/invalid output. */
  status: 'ROUTED' | 'UNAVAILABLE';
  intent: LineIntakeRouteIntent;
  language: string;
  confidence: number;
  /** Bounded reason for audit/summary. Never raw model output. */
  reason?: string;
  /** CLARIFY only: one short model-written clarifying question in the user's language (bounded). */
  clarifyQuestion?: string;
  /** CLARIFY only: the intake route this question belongs to, preserved when a low-confidence
   *  route is downgraded. The dispatcher stores it so the ANSWER inherits the route
   *  deterministically instead of relying on the model to re-read the original text. */
  clarifyForIntent?: LineIntakeRouteIntent;
  captureHints?: LineIntakeCaptureHints;
  /** EXPENSE_CAPTURE_CORRECTION only (phase 2). */
  correctionHints?: LineIntakeCorrectionHints;
  /** Present ONLY under the trusted `reimbursementSemantic` capability (always both, defaulting to the
   *  fail-closed AMBIGUOUS/UNKNOWN when the model omits them). Veto-only advice: AMBIGUOUS or UNKNOWN
   *  blocks every mutation; expense capture additionally requires BUSINESS_EXPENSE + COMPANY_PAID. */
  semanticOutcome?: LineIntakeSemanticOutcome;
  fundingSource?: LineIntakeFundingSource;
  /** REIMBURSEMENT_REQUEST_START only; bounded and membership-guarded at parse. */
  reimbursementHints?: LineIntakeReimbursementHints;
  /** Advisory image/document classification; source modules decide the final route. */
  documentClassification?: BusinessDocumentClassification;
  /**
   * The page as stage-one text, present only when this intake carried an image and the model was
   * asked for it. The intake router already reads the photo to classify it, so handing that read
   * back lets receipt OCR skip reading the SAME image a second time — UAT 2026-08-28 measured
   * 12.8s of intake followed by a 16.6s re-read of the identical photo. Advisory like every other
   * field here: receipt OCR re-bounds it and falls back to its own read when it is absent or
   * unusable, so an older gateway that never sends it keeps today's behaviour exactly.
   */
  documentText?: string;
  errorCode?: string;
  /** Ids from this request's `openClarifications` the model judged answered by this message.
   *  Membership-guarded at parse (⊆ the ids sent); the dispatcher consumes ONLY these. */
  resolvedClarificationIds?: string[];
  /** One entry per model call the gateway made for this request; absent from an older gateway. */
  usage?: AiUsageEntry[];
  /** Optional additive fused plan (latency/autonomy §7). Additive and optional so an older
   *  gateway that never produced one, or a caller that ignores it, both stay wire-compatible. */
  preparedPlan?: LineAiPreparedPlan;
  /** Present ONLY under the trusted `advisor` capability (advisor spec §9) — a SIBLING of
   *  `clarifyQuestion`, never nested in `preparedPlan`. Untrusted model advice re-parsed by
   *  `parseLineAiPreparedAdvisorAnswer` at every receiver; absent from an older gateway, and an
   *  older API that ignores the field simply keeps its existing behavior (no HTTP 400). */
  advisorAnswer?: PreparedAdvisorAnswer;
  /** SERVER-derived audit context, never model output (spec §9). */
  advisorContext?: LineIntakeAdvisorContext;
};

export type LineAiWebLink = {
  label: string;
  path: string;
};

export type LineAiAnswerCard = {
  title?: string;
  text: string;
  sourceLabels?: string[];
  webLink?: LineAiWebLink;
  /** Spec §13: one state badge rendered as its own row above the body. Additive — a card without
   *  one renders exactly as it did before, and an older gateway never sends one. */
  badge?: string;
};

export type LineAiAnswerPresentation = {
  kind: 'answer_cards';
  cards: LineAiAnswerCard[];
};

// ── Item 10F: open clarifications (waiting_user ledger entries riding a turn) ─

/** An earlier unanswered clarify from this chat, attached to the next turn as DATA so the
 *  model can complete the ORIGINAL request when the new message answers the question. */
export type LineAiOpenClarification = {
  /** Ledger entry id (opaque to the gateway). */
  id: string;
  question: string;
  /** The original request text the question belongs to. */
  text: string;
  /** Canonical subject of the original request, when known. */
  subject?: LineAiBusinessSubject;
  askedAt: string;
  /** Intake route the ORIGINAL request was on, when it was an intake clarify. The dispatcher
   *  inherits it deterministically instead of trusting the model to re-read the original text. */
  clarifyForIntent?: LineIntakeRouteIntent;
  /** Correction-target shortlist the question named (≤ 5). A snapshot for wording only — the
   *  dispatcher re-runs the candidate query on the answer and intersects; never authorization. */
  candidateExpenseIds?: string[];
  /**
   * Set when the question was asked ABOUT a file the customer already sent and the server still
   * holds. Without this the model only knows a picture was mentioned once and has no way to tell
   * "answer about the stored file" from "ask them to send a picture" — which is what made the
   * clarify loop back on itself. Ids are opaque handles for the dispatcher to resolve; the model
   * never dereferences them itself.
   */
  pendingMedia?: {
    pendingMediaId: string;
    attachmentId: string;
    mimeType: string;
  };
};

// ── Item 10F: per-sub-request coverage (critic verdicts) ─────────────────────

export type LineAiCoverageVerdict = 'covered' | 'needs_user' | 'uncovered';

/** One honest outcome per sub-request of a multi-command turn. `needs_user` carries the ONE
 *  bounded clarify question; `uncovered` carries the reason (budget, no data, no tool). */
export type LineAiCoverageItem = {
  request: string;
  subject?: LineAiBusinessSubject;
  verdict: LineAiCoverageVerdict;
  question?: string;
  reason?: string;
};

export type LineAiTurnResponse = {
  requestId: string;
  replyText: string;
  sourceRefs: SourceRef[];
  sourceLabels: string[];
  webLinks: LineAiWebLink[];
  intent: LineAiIntent;
  agent: LineAiAgent;
  refused: boolean;
  refusalReason?: LineAiRefusalReason;
  toolsInvoked: string[];
  /** Real per-tool outcomes (status/durationMs/errorCode). `toolsInvoked` names stay for wire
   *  compatibility; absent when an older AgentCore artifact returns no per-tool detail. */
  toolCalls?: AgentToolCall[];
  durationMs: number;
  errorCode?: string;
  /** Every processor used for this turn. Persisted by ERP with the turn. */
  modelLineage?: AiModelLineage[];
  /** Grounded LINE presentation. Absent for clarification, refusal, unavailable, and failed reads. */
  presentation?: LineAiAnswerPresentation;
  /** Item 10F: critic verdicts per sub-request (native loop path only). Drives the API-side
   *  ledger acks/appends; absent on the 10B paths. */
  coverage?: LineAiCoverageItem[];
  /** One entry per model call this turn made; absent from an older gateway or AgentCore artifact. */
  usage?: AiUsageEntry[];
  /** Additive hosted-runtime evidence. Missing identity means an older/unacceptable candidate. */
  runtimeIdentity?: LineAiRuntimeIdentity;
  expectedRuntimeIdentity?: LineAiExpectedRuntimeIdentity;
  runtimeBinding?: LineAiRuntimeBinding;
  stageDurationsMs?: LineAiStageDurations;
  modelCallCount?: number;
};

// ─── Item 10B agent orchestration types ──────────────────────────────────────

export type ProviderErrorCode =
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_CONFIG_MISSING'
  | 'PROVIDER_THROTTLED'
  | 'PROVIDER_ACCESS_NOT_READY'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNKNOWN';

export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
};

export type AgentIntentItem = {
  intent: LineAiIntent;
  subject: LineAiBusinessSubject;
  agent: LineAiAgent;
  priority: number;
  requiredTools: string[];
  missingContext: string[];
};

export type AgentRefusal = {
  request: string;
  reason: LineAiRefusalReason;
};

export type AgentIntentPlan = {
  status: 'ROUTABLE' | 'PARTIAL' | 'UNROUTABLE';
  language: string;
  intents: AgentIntentItem[];
  refusals: AgentRefusal[];
  requiresHumanReview: boolean;
};

// ─── LINE AI Prepared Plan (latency/autonomy §7) ─────────────────────────────
// One optional additive wrapper around the existing `AgentIntentPlan`; NOT a second plan
// hierarchy. `responseMode`, `answerShape`, and `confidence` are untrusted model advice, never
// execution authority — the server derives the lane only from verified invariants and treats
// confidence as veto-only (a value below the simple floor forces upward fallback; it can never
// make an ineligible plan eligible). Every receiver re-parses this with `parseLineAiPreparedPlan`
// (packages/contracts/src/line-ai-prepared-plan.ts) and never casts raw wire JSON into the type.

export type LineAiPreparedPlanComplexity = 'simple' | 'complex';
export type LineAiPreparedPlanResponseMode =
  | 'deterministic' | 'casual_composer' | 'simple_grounded' | 'full_agentic';
export type LineAiPreparedPlanAnswerShape = 'single_metric' | 'list' | 'summary' | 'comparison';

export type LineAiPreparedCall = {
  toolName: string;
  input: Record<string, unknown>;
};

export type LineAiPreparedPlan = {
  version: 1;
  complexity: LineAiPreparedPlanComplexity;
  /** Untrusted model advice; veto-only, never grants authority. */
  confidence: number;
  intentPlan: AgentIntentPlan;
  proposedCalls: LineAiPreparedCall[];
  responseMode: LineAiPreparedPlanResponseMode;
  answerShape?: LineAiPreparedPlanAnswerShape;
};

export type AgentFact = {
  label: string;
  value: string;
  sourceRef?: SourceRef;
};

export type AgentSuggestion = {
  kind: 'action' | 'review' | 'info';
  text: string;
};

export type AgentToolCall = {
  name: string;
  status: 'ok' | 'forbidden' | 'unsupported_module' | 'unavailable' | 'error';
  durationMs: number;
  errorCode?: string;
};

export type ReceiptRisk = {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  requiresHumanReview: boolean;
};

export type SpecialistOutput = {
  agent: LineAiAgent;
  status: 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED' | 'PERMISSION_DENIED';
  summary: string;
  facts: AgentFact[];
  suggestions: AgentSuggestion[];
  toolCalls: AgentToolCall[];
  risks?: ReceiptRisk;
  requiresHumanReview: boolean;
  /** Bounded raw tool data snapshots for the model answer layer (grounding source). */
  toolData?: Array<{ tool: string; data: unknown }>;
  /** As-of timestamp of the primary successful tool result, carried so a deterministic formatter can
   *  state data freshness without re-invoking the tool. Absent when no tool returned a dated result. */
  asOf?: string;
};

/** Error codes for domain-level failures. */
export const LINE_AI_ERROR_CODES = {
  INVALID_SIGNATURE: 'LINE_AI_INVALID_SIGNATURE',
  DUPLICATE_EVENT: 'LINE_AI_DUPLICATE_EVENT',
  UNLINKED_USER: 'LINE_AI_UNLINKED_USER',
  AMBIGUOUS_COMPANY: 'LINE_AI_AMBIGUOUS_COMPANY',
  FORBIDDEN: 'LINE_AI_FORBIDDEN',
  UNSUPPORTED_MODULE: 'LINE_AI_UNSUPPORTED_MODULE',
  MUTATION_BLOCKED: 'LINE_AI_MUTATION_BLOCKED',
  TOOL_UNAVAILABLE: 'LINE_AI_TOOL_UNAVAILABLE',
  AI_TIMEOUT: 'LINE_AI_AI_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'LINE_AI_PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'LINE_AI_RATE_LIMITED',
  DELIVERY_FAILURE: 'LINE_AI_DELIVERY_FAILURE',
} as const;

export type LineAiErrorCode = (typeof LINE_AI_ERROR_CODES)[keyof typeof LINE_AI_ERROR_CODES];

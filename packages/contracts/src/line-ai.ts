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
  roles: string[];
  branchIds?: string[];
  locationIds?: string[];
  locale: string;
  conversationId?: string;
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
  | 'BUSINESS_DOCUMENT_REFERENCE'
  | 'SIGNATURE_UPLOAD_TICKET'
  | 'BUSINESS_READ_QUESTION'
  | 'MUTATION_REQUEST_REFUSAL'
  | 'CLARIFY'
  | 'UNSUPPORTED';

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
};

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
  /** Advisory image/document classification; source modules decide the final route. */
  documentClassification?: BusinessDocumentClassification;
  errorCode?: string;
  /** Ids from this request's `openClarifications` the model judged answered by this message.
   *  Membership-guarded at parse (⊆ the ids sent); the dispatcher consumes ONLY these. */
  resolvedClarificationIds?: string[];
  /** One entry per model call the gateway made for this request; absent from an older gateway. */
  usage?: AiUsageEntry[];
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

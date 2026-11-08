// LINE AI contracts – shared by API (webhook ingress) and AI Gateway (turn orchestration).

import type { LineChatActionId, SourceRef } from './ai-tools.js';
import type { AiModelLineage, AiModelPolicy, AiUsageEntry } from './ai-lineage.js';
import {
  parseLineAiValueCandidates as parseNormalizedLineAiValueCandidates,
  type LineAiValueCandidates as NormalizedLineAiValueCandidates,
  type LineAiValueCandidatesV2,
} from './line-ai-value-normalizer.js';
import type { LineAiInputEvidenceV2 } from './line-ai-input-evidence.js';
import { parseAiBudgetGrantV2 } from './ai-budget-bounds.js';
import { parseLineAiInputEvidence, verifyLineAiInputEvidence, validateLineAiSourceRefV2, type LineAiSourceRefV2 } from './line-ai-input-evidence.js';
import type { AiBudgetGrantV2 } from './ai-budget-bounds.js';
import type { ReimbursementAiReadFilters } from './reimbursements.js';

export type LineAiTurnValueCandidates = NormalizedLineAiValueCandidates | LineAiValueCandidatesV2;

export function parseLineAiTurnValueCandidates(value: unknown, messageText: string): LineAiTurnValueCandidates | undefined {
  return parseNormalizedLineAiValueCandidates(value, messageText);
}

/** 1 chat credit = 1 baht of metered CHAT cost; OCR/receipt reads are accounted separately. */
export const DEFAULT_CHAT_CREDIT_SATANG = 5_000;

export type LineAiAgent = 'general' | 'inventory' | 'notifications' | 'cfo' | 'sales' | 'crm' | 'accounting' | 'tax' | 'marketing';

export type LineAiAgentStatus = 'enabled' | 'limited' | 'planned';

export type LineAiAgentDefinition = {
  agent: LineAiAgent;
  label: string;
  status: LineAiAgentStatus;
  toolNames: string[];
};

export const LINE_AI_AGENT_REGISTRY: LineAiAgentDefinition[] = [
  { agent: 'general', label: 'General Assistant', status: 'enabled', toolNames: ['company.get_current_context', 'company.list_branches', 'company.get_employee_summary', 'company.get_employee_detail', 'company.get_roles', 'company.action.preview', 'dashboard.get_business_health_summary', 'notifications.list_open_alerts', 'inventory.get_product_detail', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.get_detail', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail', 'ledger.get_period_status', 'ledger.get_report_summary'] },
  { agent: 'inventory', label: 'Inventory Agent', status: 'enabled', toolNames: ['inventory.search_products', 'inventory.get_product_detail', 'inventory.get_stock_balance', 'inventory.list_low_stock', 'inventory.summarize_stock_movements'] },
  { agent: 'notifications', label: 'Notifications Agent', status: 'enabled', toolNames: ['notifications.list_open_alerts', 'notifications.get_daily_summary'] },
  { agent: 'cfo', label: 'AI CFO', status: 'limited', toolNames: ['ledger.get_financial_summary', 'ledger.get_period_status', 'ledger.get_report_summary', 'dashboard.get_business_health_summary', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.get_detail', 'expense.get_daily_closing', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail'] },
  { agent: 'sales', label: 'Sales Agent', status: 'limited', toolNames: ['sales.get_sales_summary', 'crm.get_customer_summary', 'crm.search_customers', 'crm.get_customer_360', 'crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups', 'crm.get_booking_summary', 'crm.list_bookings', 'crm.get_inbox_summary', 'crm.list_conversations', 'crm.get_conversation_summary', 'crm.suggest_sales_followups'] },
  { agent: 'crm', label: 'CRM Agent', status: 'limited', toolNames: ['crm.get_customer_summary', 'crm.search_customers', 'crm.get_customer_360', 'crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups', 'crm.get_booking_summary', 'crm.list_bookings', 'crm.get_inbox_summary', 'crm.list_conversations', 'crm.get_conversation_summary', 'crm.suggest_sales_followups'] },
  { agent: 'accounting', label: 'Accounting Agent', status: 'limited', toolNames: ['accounting.capture_receipt_evidence', 'accounting.get_document_detail', 'accounting.get_receivable_summary', 'expense.list_recent', 'expense.get_detail', 'expense.get_daily_closing', 'reimbursement.get_summary', 'reimbursement.get_detail', 'procurement.get_summary', 'counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview', 'procurement.search_suppliers', 'procurement.get_purchase_order_detail', 'ledger.get_period_status', 'ledger.get_report_summary'] },
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

export type LineAiResponsePreferences = {
  language: 'th' | 'en';
  detail: 'short' | 'normal' | 'detailed';
  presentation: 'prose' | 'bullets' | 'table' | 'steps';
};

export type LineAiTaskProjectionV2 = {
  version: 2;
  stateVersion: number;
  lifecycleEpoch: number;
  expiresAtMs: number;
  tasks: Array<{
    taskId: string;
    revision: number;
    kind: 'read' | 'write' | 'general' | 'help' | 'public' | 'file';
    state: 'active' | 'waiting_user' | 'waiting_job' | 'paused' | 'completed' | 'canceled' | 'invalidated';
    userGoal: string;
    subrequests: Array<{ index: number; kind: 'read'|'write'|'general'|'help'|'public'|'file'; goal: string; status: 'pending'|'handled'|'denied'|'unsupported'|'needs_user' }>;
    slots?: Record<string, string | number | boolean | null>;
    constraints?: string[];
    deliveredQuestionRefs?: string[];
    sourceRevisionLocators?: Array<{ sourceType: string; sourceId: string; revision: string }>;
    attachmentPageRefs?: Array<{ attachmentId: string; contentHash: string; pages: number[] }>;
  }>;
};

export type LineAiSemanticSubrequestV2 = {
  index: number;
  /** Advisory selection from the offered task projection; API rechecks exact owner/revision before CAS. */
  taskRef?: { taskId: string; taskRevision: number; subrequestIndex: number };
  kind: 'read' | 'general' | 'write' | 'help' | 'public' | 'file';
  /** Typed proposal only; each API domain still validates evidence, state and mutation authority. */
  writeIntent?: 'EXPENSE_PAYMENT_EVIDENCE_LINK' | 'EXPENSE_DOCUMENT_CAPTURE' | 'EXPENSE_DRAFT_CONTINUATION' | 'EXPENSE_CAPTURE_CORRECTION' | 'SUBSTITUTE_RECEIPT_CONTINUATION' | 'REIMBURSEMENT_REQUEST_START';
  goal: string;
  requiredEvidence: string[];
  requestedFilters: Record<string, string | number | boolean | null>;
  /** Exact user phrase only; it is a lookup hint, never an entity/action ID. */
  entityReference?: { kind: 'user_text'; value: string };
  /** tuning-7b (K1): router's best-guess read tool for this clause (e.g. "expense.get_breakdown"),
   *  advisory only — the gateway may skip its own tool-planning call when it trusts this. Never
   *  authority: a read tool still runs the full permission/entitlement check before it executes. */
  toolHint?: string;
  dependsOn: number[];
  evidenceRefs?: LineAiSourceRefV2[];
};

/** API-verified historical clause selected from an immutable accepted request. It is context only:
 * the live request keeps its own messageText, evidence and budget authority. */
export type LineAiRetainedTaskSourceV2 = {
  taskRef: { taskId: string; taskRevision: number; subrequestIndex: number };
  inputEvidence: LineAiInputEvidenceV2;
  semanticSubrequest: LineAiSemanticSubrequestV2;
};

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
  /** True only when the API knows the stored USER preview was not truncated. Absent is ineligible
   *  for deterministic follow-up candidates so older callers cannot accidentally widen evidence. */
  userMessagePreviewComplete?: true;
  assistantReplyPreview?: string;
  intent?: string;
  agent?: string;
  refused?: boolean;
};

/** Non-monetary scope proof for a delivered expense summary. Supplied only by the API after its
 *  current identity/access/chat and delivery checks; it is never a business-data source. */
export type LineAiDeliveredExpenseSummary = {
  version: 1;
  deliveredAt: string;
  statusBasis: 'exclude_rejected_voided';
  continuationOfPrior?: true;
  ranges: Array<{ fromDate: string; toDate: string; branchId: string | null }>;
};

/**
 * Spec §4 R-M1/R-M4: one entry the customer saw — a numbered record (expense.list_recent,
 * reimbursement.list_pending_approvals), a breakdown group (expense.get_breakdown; `kind` names the
 * axis), or the single record a detail read resolved (expense.get_detail, reimbursement.get_detail).
 * `id` is the ONLY thing an ordinal reference ("รายการแรก", "หมวดแรก") may resolve to (R-M5); never an
 * amount. `label`/`date` are display text for the router prompt, not business facts to compute from.
 */
export type LineAiReadMemoryShownItem = {
  ordinal: number;
  id: string;
  label: string;
  date?: string;
  kind?: 'category' | 'branch' | 'vendor';
};

/**
 * Spec §4 R-M1: what one successful read tool call actually applied, recorded by the API from the
 * tool result's OWN `queryApplied`/resolved data — never the model's raw proposed input, so a
 * follow-up can never inherit a filter that was rejected, ambiguous, or never really took effect.
 * R-M6: carries no returned figures. Claim amount bounds describe the query to repeat,
 * never a previous total. Every answer figure comes from this turn's own tool results.
 */
export type LineAiReadMemory = {
  tool: string;
  /** Exact applied claim filters, including an empty object for a verified unfiltered read. */
  claimFilters?: ReimbursementAiReadFilters;
  period?: { fromDate: string; toDate: string };
  documentStatus?: string;
  paymentStatus?: string;
  categoryId?: string;
  categoryName?: string;
  vendorId?: string;
  vendorName?: string;
  branchId?: string;
  branchName?: string;
  groupBy?: 'category' | 'branch' | 'vendor';
  answerShape: 'single_metric' | 'list';
  shownItems?: LineAiReadMemoryShownItem[];
  asOf: string;
};

export const LINE_AI_EXPENSE_CRITERION_REPLIES = {
  deliveredTh: 'ยอดค่าใช้จ่ายที่แสดงก่อนหน้านี้ไม่รวมรายการที่ “ปฏิเสธ” และ “ยกเลิก” อยู่แล้วค่ะ ยอดนั้นยังรวมรายการที่อยู่ระหว่างตรวจสอบด้วยค่ะ',
  generalTh: 'ตามเกณฑ์ทั่วไป ยอดค่าใช้จ่ายบน LINE ไม่นับรายการที่ถูกปฏิเสธหรือยกเลิก และยังรวมรายการที่อยู่ระหว่างตรวจสอบค่ะ',
  deliveredEn: 'The delivered expense summary already excluded rejected and voided records. It still included records under review.',
  generalEn: 'LINE expense summaries exclude rejected and voided records, while still including records under review.',
} as const;

export type LineAiConversationContext = {
  /** Previous stored LINE turns included only when the latest turn is within this window. */
  windowMinutes: number;
  /** Max previous AiTurn rows included. */
  maxTurns: number;
  lastTurnAt?: string;
  recentTurns: LineAiConversationContextTurn[];
  /** IDs and exact versions of the latest delivered knowledge answer in this window.
   * DATA for candidate retrieval only. Current eligibility and selection are checked again. */
  lastKnowledgeCards?: Array<{ id: string; version: number }>;
  /** Latest fully evidenced expense summary delivered in this same chat and current access scope. */
  deliveredExpenseSummary?: LineAiDeliveredExpenseSummary;
  /** Spec §4 R-M2: at most 3 read-tool results delivered in this same chat and current access scope,
   *  newest first, within `windowMinutes`. `undefined` in a group/room chat (R-M7) or when the access
   *  scope changed since — never a business-data source, understanding-only (R-M6). */
  recentReads?: LineAiReadMemory[];
  /** References from the exact bot message quoted in this private chat; tools recheck current access. */
  quotedRecords?: Array<{ tool: string; id: string }>;
  /** Server-derived references from this same company/user/chat; the API still checks access. */
  recentCapturedExpenses?: Array<{ id: string }>;
  activeExpenseDrafts?: Array<{ expenseId: string }>;
};

/** Internal request from API to AI Gateway for one LINE turn. */
/** Current message wins over account locale and saved style; Thai-English input stays Thai. */
export function lineReplyLanguage(text: string, fallback: 'th' | 'en' = 'th'): 'th' | 'en' {
  if (/[\u0E00-\u0E7F]/u.test(text)) return 'th';
  if (/^\/[a-z][a-z0-9-]*(?:\s|$)/iu.test(text.trim())) return fallback;
  if (/^[A-Z0-9_.:/-]+$/u.test(text.trim()) && /\d/u.test(text)) return fallback;
  return /[A-Za-z]/u.test(text) ? 'en' : fallback;
}

export type LineAiTurnRequest = {
  requestId: string;
  /** Idempotency key: LINE webhook event id */
  webhookEventId: string;
  userContext: LineUserContext;
  /** Public selling terms resolved by the API from BillingService.catalog(). Never budget authority. */
  packageOffers?: import('./billing.js').BillingOffer[];
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
  /** Preserved presentation language for synthetic button/continuation turns. Never authority. */
  language?: 'th' | 'en';
  /** Complete immutable v2 raw webhook evidence. When present, receivers must validate it and may
   *  not normalize, truncate, or fall back to the legacy parser after a mismatch. */
  inputEvidence?: LineAiInputEvidenceV2;
  /** Explicit server negotiation for the additive v2 wire capabilities. */
  contractCapabilities?: Array<'input-evidence-v2' | 'budget-envelope-v2'>;
  /** API-issued, authority-bound grant. It is never a user/model supplied field. */
  budgetGrantV2?: AiBudgetGrantV2;
  /** Server-verified approved-help lane. Never inferred from message text or model output. */
  approvedKnowledge?: boolean;
  /** Exact card ids selected from the server-offered allowlist, at most five. */
  selectedKnowledgeCardIds?: string[];
  /** Server-catalog action selected by semantic intake; navigation only, never mutation authority. */
  howToActionId?: LineChatActionId;
  /** API-issued bounded conversational state. References only; never authority or financial facts. */
  taskProjection?: LineAiTaskProjectionV2;
  /** Explicit owner-approved style only. Current message instructions take precedence. */
  responsePreferences?: LineAiResponsePreferences;
  /** Complete, bounded semantic request inventory emitted by intake and preserved by the API. */
  semanticSubrequests?: LineAiSemanticSubrequestV2[];
  /** Intake advice only; draft tools must prove these values against inputEvidence/candidates. */
  reimbursementHints?: LineIntakeReimbursementHints;
  /** Read-only API context for one explicitly selected historical clause. */
  retainedTaskSource?: LineAiRetainedTaskSourceV2;
  attachments?: LineAiAttachment[];
  /** Short-term chat context only; company/permission truth still comes from userContext/tools. */
  conversationContext?: LineAiConversationContext;
  /** Preview hash of message text (sha256 hex prefix, 16 chars) */
  messagePreviewHash: string;
  /** Deterministic amount/date readings of messageText (item 10F). The model selects from
   *  these; input/output membership guards enforce the selection. DATA, never instructions. */
  valueCandidates?: LineAiTurnValueCandidates;
  /** Item 10F: the chat's open waiting_user ledger entries (bounded). DATA, never instructions. */
  openClarifications?: LineAiOpenClarification[];
  /** Offered questions this intake resolved; context only, never write authority. */
  resolvedClarificationIds?: string[];
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

/** Stateless public answer route. It deliberately has no user/company identity, private history,
 * permissions/delegations, attachments, or private task projection. The verified payer is bound by
 * the grant and must match this already-authorized channel admission. */
export type LineAiPublicGeneralRequest = {
  requestId: string;
  webhookEventId: string;
  kind: 'PUBLIC_GENERAL';
  messageText: string;
  inputEvidence: LineAiInputEvidenceV2;
  contractCapabilities: Array<'input-evidence-v2' | 'budget-envelope-v2'>;
  budgetGrantV2: AiBudgetGrantV2;
  publicAdmission: {
    channelKind: 'USER' | 'GROUP' | 'ROOM';
    channelKeyHash: string;
    payerCompanyId: string;
    admissionId: string;
  };
  approvedKnowledge?: boolean;
  selectedKnowledgeCardIds?: string[];
  enabledFeatures?: string[];
};

export type LineAiPublicGeneralResponse = {
  requestId: string;
  status: 'answered' | 'unavailable';
  replyText: string;
  language: 'th' | 'en';
  errorCode?: string;
  usage?: AiUsageEntry[];
};

const LINE_AI_V2_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const LINE_AI_SHA256 = /^[0-9a-f]{64}$/u;
// tuning-7b (K1): exact "category.action" tool-name shape, e.g. "expense.get_breakdown".
const LINE_AI_TOOL_HINT = /^[a-z_]+\.[a-z_]+$/u;
const SEMANTIC_KINDS = ['read', 'general', 'write', 'help', 'public', 'file'] as const;
const SEMANTIC_STATUSES = ['handled', 'denied', 'unsupported', 'needs_user'] as const;
const TASK_SUBREQUEST_STATUSES = ['pending', ...SEMANTIC_STATUSES] as const;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const recordValue = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedStringList = (value: unknown, maxItems: number, maxLength: number): string[] | undefined =>
  Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= maxLength)
    ? [...value] as string[] : undefined;

export function parseLineAiResponsePreferences(value: unknown): LineAiResponsePreferences | undefined {
  if (!recordValue(value) || Object.keys(value).length !== 3 || !exactKeys(value, ['language', 'detail', 'presentation'])
    || (value['language'] !== 'th' && value['language'] !== 'en')
    || !['short', 'normal', 'detailed'].includes(String(value['detail']))
    || !['prose', 'bullets', 'table', 'steps'].includes(String(value['presentation']))) return undefined;
  return { language: value['language'], detail: value['detail'] as LineAiResponsePreferences['detail'], presentation: value['presentation'] as LineAiResponsePreferences['presentation'] };
}

/** An explicit request about how to answer THIS user from now on (core contract §9): store one or more allowlisted
 *  values, list what is stored, or forget some or all of it. Same shape as the API's exact-command parser. */
export type LineAiResponsePreferenceCommand =
  | { kind: 'list' }
  | { kind: 'set'; values: Partial<LineAiResponsePreferences> }
  | { kind: 'delete'; keys: Array<keyof LineAiResponsePreferences> | 'all' };

const RESPONSE_PREFERENCE_CHOICES: { [K in keyof LineAiResponsePreferences]: readonly LineAiResponsePreferences[K][] } = {
  language: ['th', 'en'], detail: ['short', 'normal', 'detailed'], presentation: ['prose', 'bullets', 'table', 'steps'],
};

/** Receiver-boundary validator for a router-proposed preference command: exact keys and allowlisted values only. */
export function parseLineAiResponsePreferenceCommand(value: unknown): LineAiResponsePreferenceCommand | undefined {
  if (!recordValue(value)) return undefined;
  if (value['kind'] === 'list') return Object.keys(value).length === 1 ? { kind: 'list' } : undefined;
  if (value['kind'] === 'set') {
    const values = value['values'];
    if (Object.keys(value).length !== 2 || !recordValue(values) || !Object.keys(values).length
      || !Object.entries(values).every(([key, item]) => Object.hasOwn(RESPONSE_PREFERENCE_CHOICES, key)
        && (RESPONSE_PREFERENCE_CHOICES[key as keyof LineAiResponsePreferences] as readonly unknown[]).includes(item))) return undefined;
    return { kind: 'set', values: { ...values } as Partial<LineAiResponsePreferences> };
  }
  if (value['kind'] === 'delete') {
    const keys = value['keys'];
    if (Object.keys(value).length !== 2) return undefined;
    if (keys === 'all') return { kind: 'delete', keys: 'all' };
    if (!Array.isArray(keys) || !keys.length || keys.length > 3 || new Set(keys).size !== keys.length
      || !keys.every(key => typeof key === 'string' && Object.hasOwn(RESPONSE_PREFERENCE_CHOICES, key))) return undefined;
    return { kind: 'delete', keys: [...keys] as Array<keyof LineAiResponsePreferences> };
  }
  return undefined;
}

/** Rebuild bounded API-owned task state. No transcript or authoritative financial totals fit this shape. */
export function parseLineAiTaskProjection(value: unknown): LineAiTaskProjectionV2 | undefined {
  if (!recordValue(value) || !exactKeys(value, ['version', 'stateVersion', 'lifecycleEpoch', 'expiresAtMs', 'tasks'])
    || value['version'] !== 2 || !Number.isSafeInteger(value['stateVersion']) || Number(value['stateVersion']) < 0
    || !Number.isSafeInteger(value['lifecycleEpoch']) || Number(value['lifecycleEpoch']) < 0
    || !Number.isSafeInteger(value['expiresAtMs']) || Number(value['expiresAtMs']) < 0
    || !Array.isArray(value['tasks']) || value['tasks'].length > 4) return undefined;
  const tasks: LineAiTaskProjectionV2['tasks'] = [];
  for (const raw of value['tasks']) {
    if (!recordValue(raw) || !exactKeys(raw, ['taskId', 'revision', 'kind', 'state', 'userGoal', 'subrequests', 'slots', 'constraints', 'deliveredQuestionRefs', 'sourceRevisionLocators', 'attachmentPageRefs'])
      || typeof raw['taskId'] !== 'string' || !LINE_AI_V2_ID.test(raw['taskId'])
      || !Number.isSafeInteger(raw['revision']) || Number(raw['revision']) < 0
      || !['read', 'write', 'general', 'help', 'public', 'file'].includes(String(raw['kind']))
      || !['active', 'waiting_user', 'waiting_job', 'paused', 'completed', 'canceled', 'invalidated'].includes(String(raw['state']))
      || typeof raw['userGoal'] !== 'string' || raw['userGoal'].length > 800
      || !Array.isArray(raw['subrequests']) || raw['subrequests'].length > 8) return undefined;
    const subrequests: LineAiTaskProjectionV2['tasks'][number]['subrequests'] = [];
    for (let i = 0; i < raw['subrequests'].length; i += 1) {
      const item = raw['subrequests'][i];
      if (!recordValue(item) || !exactKeys(item, ['index', 'kind', 'goal', 'status']) || item['index'] !== i
        || !SEMANTIC_KINDS.includes(item['kind'] as typeof SEMANTIC_KINDS[number])
        || typeof item['goal'] !== 'string' || item['goal'].length < 1 || item['goal'].length > 800
        || !TASK_SUBREQUEST_STATUSES.includes(item['status'] as typeof TASK_SUBREQUEST_STATUSES[number])) return undefined;
      subrequests.push({ index: i, kind: item['kind'] as typeof SEMANTIC_KINDS[number], goal: item['goal'], status: item['status'] as typeof TASK_SUBREQUEST_STATUSES[number] });
    }
    let slots: LineAiTaskProjectionV2['tasks'][number]['slots'];
    if (raw['slots'] !== undefined) {
      if (!recordValue(raw['slots']) || Object.keys(raw['slots']).length > 32 || Object.entries(raw['slots']).some(([key, item]) =>
        key.length > 80 || !(item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 800))) return undefined;
      slots = { ...raw['slots'] } as NonNullable<typeof slots>;
    }
    const constraints = raw['constraints'] === undefined ? undefined : boundedStringList(raw['constraints'], 16, 256);
    const deliveredQuestionRefs = raw['deliveredQuestionRefs'] === undefined ? undefined : boundedStringList(raw['deliveredQuestionRefs'], 8, 128);
    if (raw['constraints'] !== undefined && !constraints || raw['deliveredQuestionRefs'] !== undefined && !deliveredQuestionRefs) return undefined;
    let sourceRevisionLocators: LineAiTaskProjectionV2['tasks'][number]['sourceRevisionLocators'];
    if (raw['sourceRevisionLocators'] !== undefined) {
      if (!Array.isArray(raw['sourceRevisionLocators']) || raw['sourceRevisionLocators'].length > 8 || raw['sourceRevisionLocators'].some((loc) =>
        !recordValue(loc) || !exactKeys(loc, ['sourceType', 'sourceId', 'revision'])
        || !['sourceType', 'sourceId', 'revision'].every((key) => typeof loc[key] === 'string' && (loc[key] as string).length > 0 && (loc[key] as string).length <= 128))) return undefined;
      sourceRevisionLocators = raw['sourceRevisionLocators'].map((loc) => ({ sourceType: String((loc as Record<string, unknown>)['sourceType']), sourceId: String((loc as Record<string, unknown>)['sourceId']), revision: String((loc as Record<string, unknown>)['revision']) }));
    }
    let attachmentPageRefs: LineAiTaskProjectionV2['tasks'][number]['attachmentPageRefs'];
    if (raw['attachmentPageRefs'] !== undefined) {
      if (!Array.isArray(raw['attachmentPageRefs']) || raw['attachmentPageRefs'].length > 5 || raw['attachmentPageRefs'].some((ref) =>
        !recordValue(ref) || !exactKeys(ref, ['attachmentId', 'contentHash', 'pages'])
        || typeof ref['attachmentId'] !== 'string' || !LINE_AI_V2_ID.test(ref['attachmentId'])
        || typeof ref['contentHash'] !== 'string' || !LINE_AI_SHA256.test(ref['contentHash'])
        || !Array.isArray(ref['pages']) || ref['pages'].length > 20 || ref['pages'].some((page) => !Number.isSafeInteger(page) || Number(page) < 1))) return undefined;
      attachmentPageRefs = raw['attachmentPageRefs'].map((ref) => ({ attachmentId: String((ref as Record<string, unknown>)['attachmentId']), contentHash: String((ref as Record<string, unknown>)['contentHash']), pages: [...(ref as { pages: number[] }).pages] }));
    }
    tasks.push({ taskId: raw['taskId'], revision: Number(raw['revision']), kind: raw['kind'] as LineAiTaskProjectionV2['tasks'][number]['kind'], state: raw['state'] as LineAiTaskProjectionV2['tasks'][number]['state'], userGoal: raw['userGoal'], subrequests,
      ...(slots ? { slots } : {}), ...(constraints ? { constraints } : {}), ...(deliveredQuestionRefs ? { deliveredQuestionRefs } : {}),
      ...(sourceRevisionLocators ? { sourceRevisionLocators } : {}), ...(attachmentPageRefs ? { attachmentPageRefs } : {}) });
  }
  const parsed: LineAiTaskProjectionV2 = { version: 2, stateVersion: Number(value['stateVersion']), lifecycleEpoch: Number(value['lifecycleEpoch']), expiresAtMs: Number(value['expiresAtMs']), tasks };
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 16_384) return undefined;
  return parsed;
}

/** Strict semantic plan parser: all proposals are bounded, indexed, and bound to original evidence. */
export function parseLineAiSemanticSubrequests(value: unknown, messageText: string, evidence?: LineAiInputEvidenceV2, originalClarifications?: readonly LineAiOpenClarification[]): LineAiSemanticSubrequestV2[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return undefined;
  const parsed: LineAiSemanticSubrequestV2[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!recordValue(raw) || !exactKeys(raw, ['index', 'kind', 'goal', 'requiredEvidence', 'requestedFilters', 'entityReference', 'dependsOn', 'evidenceRefs', 'taskRef', 'writeIntent', 'toolHint'])
      || raw['index'] !== i || !SEMANTIC_KINDS.includes(raw['kind'] as typeof SEMANTIC_KINDS[number])
      || typeof raw['goal'] !== 'string' || !raw['goal'].trim() || raw['goal'].length > 800
      || !Array.isArray(raw['requiredEvidence']) || raw['requiredEvidence'].length > 8
      || raw['requiredEvidence'].some((item) => typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(item))
      || !recordValue(raw['requestedFilters']) || Object.keys(raw['requestedFilters']).length > 16
      || Object.entries(raw['requestedFilters']).some(([key, item]) => key.length > 80 || !(item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 200))
      || !Array.isArray(raw['dependsOn']) || raw['dependsOn'].length > i
      || raw['dependsOn'].some((dep) => !Number.isSafeInteger(dep) || Number(dep) < 0 || Number(dep) >= i)
      || new Set(raw['dependsOn']).size !== raw['dependsOn'].length) return undefined;
    if (raw['writeIntent'] !== undefined && (raw['kind'] !== 'write' || !['EXPENSE_PAYMENT_EVIDENCE_LINK', 'EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION', 'SUBSTITUTE_RECEIPT_CONTINUATION', 'REIMBURSEMENT_REQUEST_START'].includes(String(raw['writeIntent'])))) return undefined;
    let taskRef: LineAiSemanticSubrequestV2['taskRef'];
    if (raw['taskRef'] !== undefined) {
      const ref = raw['taskRef'];
      if (!recordValue(ref) || !exactKeys(ref, ['taskId', 'taskRevision', 'subrequestIndex'])
        || typeof ref['taskId'] !== 'string' || !LINE_AI_V2_ID.test(ref['taskId'])
        || !Number.isSafeInteger(ref['taskRevision']) || Number(ref['taskRevision']) < 0
        || !Number.isSafeInteger(ref['subrequestIndex']) || Number(ref['subrequestIndex']) < 0 || Number(ref['subrequestIndex']) > 7) return undefined;
      taskRef = { taskId: ref['taskId'], taskRevision: Number(ref['taskRevision']), subrequestIndex: Number(ref['subrequestIndex']) };
      if (parsed.some(item => item.taskRef?.taskId === taskRef!.taskId && item.taskRef.subrequestIndex === taskRef!.subrequestIndex)) return undefined;
    }
    let entityReference: LineAiSemanticSubrequestV2['entityReference'];
    if (raw['entityReference'] !== undefined) {
      const ref = raw['entityReference'];
      if (!recordValue(ref) || !exactKeys(ref, ['kind', 'value']) || ref['kind'] !== 'user_text'
        || typeof ref['value'] !== 'string' || ref['value'].length > 160 || (!messageText.includes(ref['value']) && !(['read', 'general', 'help'].includes(String(raw['kind']))
          && originalClarifications?.some(entry => entry.text.includes(ref['value'] as string))))) return undefined;
      entityReference = { kind: 'user_text', value: ref['value'] };
    }
    // tuning-7b (K1): an invalid toolHint drops ONLY the hint, never the whole subrequest — it is
    // an advisory optimization, not evidence, so it must not fail parsing like taskRef/entityReference do.
    const toolHint = typeof raw['toolHint'] === 'string' && raw['toolHint'].length >= 1 && raw['toolHint'].length <= 80
      && LINE_AI_TOOL_HINT.test(raw['toolHint']) ? raw['toolHint'] : undefined;
    let evidenceRefs: LineAiSourceRefV2[] | undefined;
    if (raw['evidenceRefs'] !== undefined) {
      if (!evidence || !Array.isArray(raw['evidenceRefs']) || raw['evidenceRefs'].length > 8) return undefined;
      evidenceRefs = [];
      for (const ref of raw['evidenceRefs']) {
        const exactText = validateLineAiSourceRefV2(ref, evidence);
        if (exactText === undefined) return undefined;
        evidenceRefs.push({ ...(ref as LineAiSourceRefV2) });
      }
    }
    if (evidence && !evidenceRefs?.length) return undefined;
    parsed.push({ index: i, kind: raw['kind'] as LineAiSemanticSubrequestV2['kind'], goal: raw['goal'].trim(),
      requiredEvidence: [...raw['requiredEvidence']] as string[], requestedFilters: { ...raw['requestedFilters'] } as LineAiSemanticSubrequestV2['requestedFilters'],
      ...(entityReference ? { entityReference } : {}), ...(taskRef ? { taskRef } : {}), ...(raw['writeIntent'] ? { writeIntent: raw['writeIntent'] as LineAiSemanticSubrequestV2['writeIntent'] } : {}), ...(toolHint ? { toolHint } : {}), dependsOn: [...raw['dependsOn']] as number[], ...(evidenceRefs ? { evidenceRefs } : {}) });
  }
  return parsed;
}

function parseRetainedSemanticSubrequest(value: unknown, messageText: string, evidence: LineAiInputEvidenceV2): LineAiSemanticSubrequestV2 | undefined {
  if (!recordValue(value) || !Number.isSafeInteger(value['index']) || Number(value['index']) < 0 || Number(value['index']) > 7
    || !Array.isArray(value['dependsOn']) || value['dependsOn'].length > Number(value['index'])
    || value['dependsOn'].some((dep) => !Number.isSafeInteger(dep) || Number(dep) < 0 || Number(dep) >= Number(value['index']))
    || new Set(value['dependsOn']).size !== value['dependsOn'].length) return undefined;
  const parsed = parseLineAiSemanticSubrequests([{ ...value, index: 0, dependsOn: [] }], messageText, evidence)?.[0];
  if (!parsed || parsed.kind !== 'write' || !parsed.evidenceRefs?.length) return undefined;
  return { ...parsed, index: Number(value['index']), dependsOn: [...value['dependsOn']] as number[] };
}

/** Extract only the selected historical clause. Reordered, duplicate or overlapping refs fail. */
export function lineAiRetainedTaskSourceText(source: LineAiRetainedTaskSourceV2): string | undefined {
  const refs = source.semanticSubrequest.evidenceRefs;
  if (!refs?.length) return undefined;
  const parts = new Map(source.inputEvidence.parts.map((part, index) => [part.partId, { part, index }] as const));
  let previous: { part: number; end: number } | undefined;
  const text: string[] = [];
  for (const ref of refs) {
    const found = parts.get(ref.partId);
    const exact = validateLineAiSourceRefV2(ref, source.inputEvidence);
    if (!found || exact === undefined || previous && (found.index < previous.part
      || found.index === previous.part && ref.startUtf16 < previous.end)) return undefined;
    previous = { part: found.index, end: ref.endUtf16 };
    text.push(exact);
  }
  return text.join('\n');
}

/** Structural retained-source parser. Process boundaries must additionally call the async verifier. */
export function parseLineAiRetainedTaskSource(value: unknown): LineAiRetainedTaskSourceV2 | undefined {
  if (!recordValue(value) || Object.keys(value).length !== 3
    || !exactKeys(value, ['taskRef', 'inputEvidence', 'semanticSubrequest']) || !recordValue(value['taskRef'])) return undefined;
  const ref = value['taskRef'];
  if (!exactKeys(ref, ['taskId', 'taskRevision', 'subrequestIndex'])
    || typeof ref['taskId'] !== 'string' || !LINE_AI_V2_ID.test(ref['taskId'])
    || !Number.isSafeInteger(ref['taskRevision']) || Number(ref['taskRevision']) < 0
    || !Number.isSafeInteger(ref['subrequestIndex']) || Number(ref['subrequestIndex']) < 0 || Number(ref['subrequestIndex']) > 7) return undefined;
  if (!recordValue(value['inputEvidence']) || !Array.isArray(value['inputEvidence']['parts'])) return undefined;
  const messageText = value['inputEvidence']['parts'].map((part) => recordValue(part) && typeof part['rawText'] === 'string' ? part['rawText'] : null);
  if (messageText.some((part) => part === null)) return undefined;
  const evidence = parseLineAiInputEvidence(value['inputEvidence'], (messageText as string[]).join('\n'));
  if (!evidence) return undefined;
  const semanticSubrequest = parseRetainedSemanticSubrequest(value['semanticSubrequest'], (messageText as string[]).join('\n'), evidence);
  if (!semanticSubrequest) return undefined;
  const parsed: LineAiRetainedTaskSourceV2 = {
    taskRef: { taskId: ref['taskId'], taskRevision: Number(ref['taskRevision']), subrequestIndex: Number(ref['subrequestIndex']) },
    inputEvidence: evidence,
    semanticSubrequest,
  };
  return lineAiRetainedTaskSourceText(parsed) ? parsed : undefined;
}

/** Recompute every retained source digest before exposing the selected clause to a provider. */
export async function verifyLineAiRetainedTaskSource(value: unknown): Promise<LineAiRetainedTaskSourceV2 | undefined> {
  const parsed = parseLineAiRetainedTaskSource(value);
  if (!parsed) return undefined;
  const messageText = parsed.inputEvidence.parts.map((part) => part.rawText).join('\n');
  return await verifyLineAiInputEvidence(parsed.inputEvidence, messageText) ? parsed : undefined;
}

export function lineAiRetainedTaskSourceMatchesProjection(source: LineAiRetainedTaskSourceV2, projection: LineAiTaskProjectionV2 | undefined, phase: 'intake' | 'turn' = 'intake'): boolean {
  const task = projection?.tasks.find((candidate) => candidate.taskId === source.taskRef.taskId
    && (phase === 'turn'
      ? candidate.revision === source.taskRef.taskRevision + 1 && candidate.state === 'active'
      : candidate.revision === source.taskRef.taskRevision && ['waiting_user', 'paused'].includes(candidate.state)));
  const subrequest = task?.subrequests.find((candidate) => candidate.index === source.taskRef.subrequestIndex
    && ['pending', 'needs_user'].includes(candidate.status));
  return subrequest?.kind === source.semanticSubrequest.kind;
}

export function parseLineAiSemanticCoverage(value: unknown, subrequests: readonly LineAiSemanticSubrequestV2[]): LineAiSemanticCoverageV2[] | undefined {
  if (!Array.isArray(value) || value.length !== subrequests.length) return undefined;
  const parsed: LineAiSemanticCoverageV2[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!recordValue(raw) || !exactKeys(raw, ['index', 'status', 'reasonCode', 'question', 'sourceRefIds']) || raw['index'] !== i
      || !SEMANTIC_STATUSES.includes(raw['status'] as typeof SEMANTIC_STATUSES[number])
      || raw['reasonCode'] !== undefined && (typeof raw['reasonCode'] !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(raw['reasonCode']))
      || raw['question'] !== undefined && (typeof raw['question'] !== 'string' || !raw['question'].trim() || raw['question'].length > 500)
      || raw['sourceRefIds'] !== undefined && (!Array.isArray(raw['sourceRefIds']) || raw['sourceRefIds'].length > 8 || raw['sourceRefIds'].some((id) => typeof id !== 'string' || !LINE_AI_V2_ID.test(id)))) return undefined;
    if (raw['status'] === 'needs_user' && typeof raw['question'] !== 'string') return undefined;
    parsed.push({ index: i, status: raw['status'] as LineAiSemanticCoverageV2['status'],
      ...(raw['reasonCode'] ? { reasonCode: raw['reasonCode'] as string } : {}), ...(raw['question'] ? { question: raw['question'] as string } : {}),
      ...(raw['sourceRefIds'] ? { sourceRefIds: [...raw['sourceRefIds']] as string[] } : {}) });
  }
  return parsed;
}

/** Exact-field request parser for the no-private-context endpoint. */
export function parseLineAiPublicGeneralRequest(value: unknown): LineAiPublicGeneralRequest | undefined {
  if (!recordValue(value) || !exactKeys(value, ['requestId', 'webhookEventId', 'kind', 'messageText', 'inputEvidence', 'contractCapabilities', 'budgetGrantV2', 'publicAdmission', 'approvedKnowledge', 'selectedKnowledgeCardIds', 'enabledFeatures'])
    || typeof value['requestId'] !== 'string' || !LINE_AI_V2_ID.test(value['requestId'])
    || typeof value['webhookEventId'] !== 'string' || !LINE_AI_V2_ID.test(value['webhookEventId'])
    || value['kind'] !== 'PUBLIC_GENERAL' || typeof value['messageText'] !== 'string'
    || !Array.isArray(value['contractCapabilities']) || value['contractCapabilities'].length !== 2
    || !value['contractCapabilities'].includes('input-evidence-v2') || !value['contractCapabilities'].includes('budget-envelope-v2')
    || value['approvedKnowledge'] !== undefined && value['approvedKnowledge'] !== true
    || value['selectedKnowledgeCardIds'] !== undefined && (!Array.isArray(value['selectedKnowledgeCardIds']) || value['selectedKnowledgeCardIds'].length > 5 || value['selectedKnowledgeCardIds'].some((id) => typeof id !== 'string' || !LINE_AI_V2_ID.test(id)) || new Set(value['selectedKnowledgeCardIds']).size !== value['selectedKnowledgeCardIds'].length)
    || value['enabledFeatures'] !== undefined && (!boundedStringList(value['enabledFeatures'], 128, 128))) return undefined;
  const evidence = parseLineAiInputEvidence(value['inputEvidence'], value['messageText']);
  const grant = parseAiBudgetGrantV2(value['budgetGrantV2']);
  const admission = value['publicAdmission'];
  if (!evidence || !grant || grant.authorityKind !== 'webhook_event' || evidence.turnKey !== grant.turnKey
    || !grant.allowedProfileIds.includes('line-answer/2') || !recordValue(admission)
    || !exactKeys(admission, ['channelKind', 'channelKeyHash', 'payerCompanyId', 'admissionId'])
    || !['USER', 'GROUP', 'ROOM'].includes(String(admission['channelKind']))
    || typeof admission['channelKeyHash'] !== 'string' || !LINE_AI_SHA256.test(admission['channelKeyHash'])
    || typeof admission['payerCompanyId'] !== 'string' || admission['payerCompanyId'] !== grant.payerCompanyId
    || typeof admission['admissionId'] !== 'string' || !LINE_AI_V2_ID.test(admission['admissionId'])) return undefined;
  return { requestId: value['requestId'], webhookEventId: value['webhookEventId'], kind: 'PUBLIC_GENERAL', messageText: value['messageText'], inputEvidence: evidence,
    contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: grant,
    publicAdmission: { channelKind: admission['channelKind'] as LineAiPublicGeneralRequest['publicAdmission']['channelKind'], channelKeyHash: admission['channelKeyHash'], payerCompanyId: admission['payerCompanyId'], admissionId: admission['admissionId'] },
    ...(value['approvedKnowledge'] === true ? { approvedKnowledge: true } : {}),
    ...(Array.isArray(value['selectedKnowledgeCardIds']) ? { selectedKnowledgeCardIds: [...value['selectedKnowledgeCardIds']] as string[] } : {}),
    ...(Array.isArray(value['enabledFeatures']) ? { enabledFeatures: [...value['enabledFeatures']] as string[] } : {}) };
}

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
  /** Exact issuer-name evidence; never a buyer, patient or cashier block. */
  vendorIdentityEvidence?: string;
  vendorEntityKind?: 'INDIVIDUAL' | 'JURISTIC';
  vendorTaxId?: string;
  vendorBranchCode?: string;
  /**
   * The SELLER's own printed address, at most `EXPENSE_VENDOR_ADDRESS_MAX_LENGTH` characters
   * (vendor-address spec §7). A full tax invoice prints both parties' addresses; only the issuer's
   * may arrive here, because this value auto-saves into the counterparty registry and a buyer
   * address filed against a vendor is wrong on every later document that reuses it.
   */
  vendorAddress?: string;
  /**
   * The buyer block a full tax invoice prints — our own shop, as the seller typed it. Never copied
   * into a seller field: Slice 2 compares it with the company registry and keeps the printed values
   * plus the outcome in `ExpenseRecord.buyerAsPrintedJson` (warn-only, `ExpenseBuyerAsPrinted`). It
   * exists so the reader has somewhere honest to put a buyer identity instead of mistaking it for
   * the seller's.
   */
  buyerAsPrinted?: { name?: string; taxId?: string; branchCode?: string; addressText?: string };
  documentNumber?: string;
  expenseDate?: string;
  /**
   * `VALUE_ASSUMPTIONS` markers the deterministic reading of `expenseDate` carried (spec §5.2).
   * A receipt printing `03/09/69` yields a perfectly usable `2026-09-03` — but only because the
   * reader applied the Thai DD/MM convention and picked one of two eras. Without this field the
   * ISO date arrives looking like something the page stated outright, and the draft, the card and
   * the review form all present a reading as a fact. Absent means the page said it plainly.
   */
  expenseDateAssumptions?: string[];
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
  /** Only an explicitly labelled printed withholding base, not VAT-base or inverse arithmetic. */
  whtBaseAmount?: string;
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
  /** Printed charges; only ROUNDING may be negative. Discounts/coupons stay in discountAmount. */
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
  /**
   * Names of fields the page did not yield. `vendorAddress` may appear here ONLY for a full tax
   * invoice: an abbreviated tax invoice, a receipt and a cash bill legally need no address, so a
   * missing one there is not a gap and must produce no reason code (vendor-address spec §8).
   */
  missingFields?: string[];
};

/** Shared API auto-fill gate for receipt reporting-category suggestions. */
export const RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE = 0.85;

/** A suggested payee kind needs an evidenced issuer name, not a tax number or a trade name alone. */
export function receiptPayeeEntityKind(name: string | undefined, evidence: string | undefined): 'INDIVIDUAL' | 'JURISTIC' | undefined {
  if (!name?.trim() || !evidence?.trim() || name.length > 200 || evidence.length > 320) return undefined;
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!normalize(evidence).includes(normalize(name))) return undefined;
  if (/^(?:บริษัท|บมจ\.?|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญนิติบุคคล|หจก\.?)|\b(?:CO(?:MPANY)?\.?\s*,?\s*(?:LTD\.?|LIMITED)|PUBLIC COMPANY|LIMITED|LLC|INCORPORATED|PLC)\b/i.test(name.trim())) return 'JURISTIC';
  if (/^(?:นาย|นางสาว|นาง|น\.ส\.)\s*\S|^(?:Mr\.?|Mrs\.?|Ms\.?|Miss)\s+\S/i.test(name.trim())) return 'INDIVIDUAL';
  return undefined;
}

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

/**
 * Capture appendix §3: the outbox event a finished capture read emits, and the LINE push consumes.
 * It lives in contracts because the producer (W03), the consumer (W02-LINE) and the generic
 * workflow drain that must NOT claim it are three different modules — a string copied into each is
 * how one of them ends up claiming a message nobody receives.
 */
export const EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE = 'expense.capture_read.finished';

export const BUSINESS_DOCUMENT_REASON_CODES = [
  'NO_DOCUMENT_STRUCTURE', 'UNREADABLE_OR_CROPPED', 'MULTIPLE_DOCUMENTS',
  'LOW_CLASSIFICATION_CONFIDENCE', 'CONTRADICTORY_SIGNALS', 'QUANTITY_ONLY',
  'MISSING_MONETARY_AMOUNT', 'MISSING_TRANSACTION_TOTAL', 'MISSING_PAYMENT_EVIDENCE',
  'ORDER_ONLY', 'MISSING_VENDOR', 'MISSING_DOCUMENT_NUMBER', 'MISSING_VENDOR_TAX_ID',
  'MISSING_TAX_BASE_OR_VAT', 'QUOTATION_NOT_TRANSACTION', 'PAYMENT_EVIDENCE_ONLY',
  'MISSING_SCHEDULED_TIME', 'MISSING_PARTY_OR_PROVIDER', 'MISSING_BOOKING_REFERENCE',
  'AMBIGUOUS_BUSINESS_DIRECTION', 'CHANNEL_SCOPE_MISMATCH', 'TARGET_PERMISSION_MISSING',
  'TARGET_MODULE_DISABLED', 'OCR_UNAVAILABLE', 'HUMAN_REVIEW_REQUIRED',
  // Capture appendix §10.2: the two courier shapes that both read as DELIVERY_NOTE but owe the
  // customer DIFFERENT sentences (spec §18.4 NR01 vs NR02). Signals, not a new documentKind — a
  // per-courier enum is exactly what §18.4 "ของเดิมและช่องว่าง" forbids.
  'PARCEL_LABEL_SIGNAL', 'DEPOSIT_SLIP_SIGNAL',
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

/** Receipt result validated inside the image-intake call against that call's own documentText.
 * The API may skip the separate receipt-ocr step only when this SERVER-produced envelope exists. */
export type LineIntakeOnePassReceipt = {
  fields: ReceiptOcrFieldResult;
  classification: BusinessDocumentClassification;
};

export const RECEIPT_OCR_FALLBACK_REASONS = [
  'JSON_INCOMPLETE_OR_INVALID',
  'UTILITY_PARTS_MISSING',
  'TOTAL_MISSING',
  'VAT_MISSING',
  'ITEMS_INCOMPLETE',
] as const;
export type ReceiptOcrFallbackReason = (typeof RECEIPT_OCR_FALLBACK_REASONS)[number];

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
  /** Evidence-validated utility parts. Intake may draft the prior receipt when it accompanies
   *  a new bill; this array itself never records a payment. */
  utilityDocuments?: Array<{
    role: 'BILL_DUE' | 'RECEIPT_PAID';
    period: string;
    amount: string;
    titleEvidence: string;
    amountEvidence: string;
  }>;
  modelLineage?: AiModelLineage[];
  errorCode?: string;
  /** Set only when `errorCode` is one of `AI_BUDGET_REFUSAL_CODES` (spec §9.1). */
  budgetScope?: AiBudgetScope;
  /** One entry per model call the gateway made for this request; absent from an older gateway. */
  usage?: AiUsageEntry[];
  /** Bounded causes that triggered extract repair and/or image re-read; document text is never logged. */
  fallbackReasons?: ReceiptOcrFallbackReason[];
};

// ─── Company AI money budget refusals (remediation spec §9.1) ────────────────
// One vocabulary for every seam that meets the per-company monthly MONEY gate: LINE text, LINE
// image, web receipt OCR, bank statement OCR, CRM and draft generation. Each seam still refuses in
// its own existing envelope (HTTP 429 body, `{status:'failed'}`, or a provider-error result) — what
// is shared is the CODE and the SCOPE, so no hop has to re-derive the reason from an error string.

/** Which ceiling the money check hit. Only the API that actually read the money may set it. */
export type AiBudgetScope = 'TOTAL' | 'CHAT' | 'OCR';

export const AI_BUDGET_REFUSAL_CODES = {
  /** The cap is reached: nothing more runs this Bangkok month. */
  exceeded: 'AI_MONTHLY_BUDGET_EXCEEDED',
  /** Money is left, but not enough to reserve this job's upper bound. NEVER "เต็ม/ครบ" (spec §12). */
  insufficient: 'AI_BUDGET_INSUFFICIENT',
  /** Another action owns the admission lease — bounded retry, never "out of quota". */
  busy: 'AI_BUDGET_BUSY',
  /** The budget/price/reservation could not be read. Stop, and say it could not be CHECKED. */
  unavailable: 'AI_BUDGET_UNAVAILABLE',
} as const;
export type AiBudgetRefusalCode = (typeof AI_BUDGET_REFUSAL_CODES)[keyof typeof AI_BUDGET_REFUSAL_CODES];

/** Waiting, retrying or re-uploading cannot change this answer this month. */
export function isAiBudgetPermanentRefusal(code?: string | null): boolean {
  return code === AI_BUDGET_REFUSAL_CODES.exceeded || code === AI_BUDGET_REFUSAL_CODES.insufficient;
}

/** Contention or an unreadable meter: the same request may succeed shortly, under the existing
 *  bounded deadline. Must never be relabelled as exhaustion. */
export function isAiBudgetTransient(code?: string | null): boolean {
  return code === AI_BUDGET_REFUSAL_CODES.busy || code === AI_BUDGET_REFUSAL_CODES.unavailable;
}

/** Any refusal our own money gate emits — used to tell OUR 429 from a lookalike provider error. */
export function isAiBudgetRefusalCode(code?: string | null): code is AiBudgetRefusalCode {
  return isAiBudgetPermanentRefusal(code) || isAiBudgetTransient(code);
}

/** Governance decisions cannot be retried as a new read. Empty/malformed OCR is an extraction failure.
 *  A money refusal joins them: `exceeded`/`insufficient` cannot pass this month, and `unavailable`
 *  means the meter itself could not be read — a second read under a fresh request id only buys the
 *  same answer plus another admission attempt. `busy` stays retryable: the lease frees between calls,
 *  and the retry is the customer pressing the button, not a loop. */
export function isReceiptOcrRetryableFailure(response: { status?: string; errorCode?: string }): boolean {
  return response.status === 'failed' && ![
    'OCR_FEATURE_DISABLED', 'OCR_MONTHLY_LIMIT_EXCEEDED', 'OCR_REQUEST_ALREADY_ADMITTED',
    'OCR_QUOTA_UNAVAILABLE', 'RECEIPT_QUOTA_EXCEEDED',
    AI_BUDGET_REFUSAL_CODES.exceeded, AI_BUDGET_REFUSAL_CODES.insufficient, AI_BUDGET_REFUSAL_CODES.unavailable,
  ].includes(response.errorCode ?? '');
}

// ─── LINE Intake Router (item 10B front-stage for item 09 intake) ────────────
// The router classifies a LINE message semantically BEFORE any source-module
// use case runs. It emits a route plan only: it must not answer users, call ERP
// tools, create records, or approve/apply signatures.

export type LineIntakeRouteIntent =
  | 'EXPENSE_PAYMENT_EVIDENCE_LINK'
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
  'EXPENSE_PAYMENT_EVIDENCE_LINK',
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
  revision?: string;
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
  /**
   * The ORIGINAL webhook event this intake belongs to (ADR 0013 §4). The transport `requestId` is
   * minted fresh on every reclaim, so deriving a money attempt from it would let one redelivered
   * LINE message buy a second hold. Optional and hashed before use: an older caller that omits it
   * keeps the request-id fallback, and the gateway ignores the field entirely — it is not part of
   * the model payload, so a request carrying it produces byte-identical prompts.
   */
  webhookEventId?: string;
  companyId: string;
  userId: string;
  locale: string;
  messageText: string;
  /** Complete immutable v2 raw webhook evidence; never used as an authority grant. */
  inputEvidence?: LineAiInputEvidenceV2;
  contractCapabilities?: Array<'input-evidence-v2' | 'budget-envelope-v2'>;
  /** API-issued, authority-bound grant. It is never a user/model supplied field. */
  budgetGrantV2?: AiBudgetGrantV2;
  taskProjection?: LineAiTaskProjectionV2;
  /** One server-selected historical write clause; never replaces this request's current input. */
  retainedTaskSource?: LineAiRetainedTaskSourceV2;
  attachments?: LineAiAttachment[];
  /** Short-term chat context for semantic routing only; not an authorization source. */
  conversationContext?: LineAiConversationContext;
  /** Server-derived permission keys; the router may only propose routes the user could perform. */
  permissions: string[];
  /** null preserves the repository's legacy fail-open company entitlement semantics. */
  enabledFeatures?: string[] | null;
  /** API-derived, request-scoped upper bound of ERP tools this actor may invoke. The Gateway
   *  intersects it with its own configured registry; absence on bound semantic-v2 fails closed. */
  offeredToolNames?: string[];
  /** Active configured expense categories the model may choose from. */
  activeCategories?: Array<{ id: string; name: string }>;
  /** Deterministic amount/date readings of messageText (item 10F); captureHints.amount and
   *  .expenseDate must be selected from these when present (membership-guarded). */
  valueCandidates?: LineAiTurnValueCandidates;
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
export type LineIntakeRouterCapabilities = {
  fusedPlan?: boolean;
  substituteSemantic?: boolean;
  reimbursementSemantic?: boolean;
  advisor?: boolean;
  approvedKnowledge?: boolean;
  /** A bound private chat whose answer preferences can be stored (core contract §9). */
  responsePreference?: boolean;
};

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
  if (Object.hasOwn(raw, 'approvedKnowledge') && raw.approvedKnowledge === true) caps.approvedKnowledge = true;
  if (Object.hasOwn(raw, 'responsePreference') && raw.responsePreference === true) caps.responsePreference = true;
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

// ─── S-4 draft edit over LINE (draft-control spec §5.4/§6) ────────────────────────────────────
// Two beats, always: a PREVIEW that writes nothing and an APPLY that only a confirm postback can
// reach. Everything below describes the first beat; the second carries no payload of its own
// because the postback is allowed to say nothing but "yes" (SEC-04).

/** The record kinds a draft-edit tool may address. `expense` is the only one this release writes;
 *  the field exists from day one so income/receipt drafts (spec §10) can join without a contract
 *  break, and every tool input reserves it. */
export const LINE_DRAFT_RECORD_TYPES = ['expense'] as const;
export type LineDraftRecordType = (typeof LINE_DRAFT_RECORD_TYPES)[number];

/** The five draft-edit tools, in the order the registry declares them. Exported so the API adapter,
 *  the gateway router hints and the specs all name the same five strings. */
export const LINE_DRAFT_UPDATE_TOOLS = [
  'expense.draft.set_header',
  'expense.draft.set_line',
  'expense.draft.add_charge',
  'expense.draft.remove_line',
  'expense.draft.set_vat_mode',
] as const;
export type LineDraftUpdateTool = (typeof LINE_DRAFT_UPDATE_TOOLS)[number];

/**
 * Where a diff value CAME FROM, which is the only thing that decides whether a renderer may scrub
 * it. Getting this wrong in either direction is a bug with teeth:
 *
 * - `text` is OCR/user free text — a vendor name, a line description. An attacker wrote it, so it
 *   is scrubbed, and a money-shaped run inside it is masked.
 * - `identifier` is a document number, whose DIGITS are its value; it gets the identifier scrub
 *   instead, which keeps them.
 * - `money`, `date`, `plain` are SERVER-GENERATED — amounts this server computed, an ISO date it
 *   read off the record, an enum label from a constant. Scrubbing them is how a confirm card ends
 *   up saying "วันที่เอกสาร: …-…-…" and "อัตรา VAT: …", which is worse than useless: the whole
 *   point of the card is to state what will change.
 */
export type LineDraftValueKind = 'text' | 'identifier' | 'money' | 'date' | 'plain';

/** One field the pending edit would change, as the confirm card states it. `before` is `null` when
 *  the record holds nothing today ("ยังไม่ระบุ"); `after` is null only for a cleared field. */
export type LineDraftUpdateDiffField = {
  /** Stable machine name (`expenseDate`, `line.2.amount`, `charge.SERVICE_CHARGE`, …). */
  field: string;
  /** Thai label the card prints. Server-generated from a constant — never model text, never scrubbed. */
  label: string;
  /** Decides how a renderer may treat `before`/`after`. See {@link LineDraftValueKind}. */
  kind: LineDraftValueKind;
  before: string | null;
  after: string | null;
};

/** The document totals the edit would leave behind. Same five figures as the §5.1 identity, so a
 *  card can restate the arithmetic instead of asserting a number. */
export type LineDraftUpdateTotals = {
  subtotalAmount: string;
  discountAmount: string;
  chargesAmount: string;
  taxableAmount: string;
  vatAmount: string;
  grandTotalAmount: string;
};

/**
 * The result of the PREVIEW beat: what WOULD change, what the totals WOULD become, and the handle
 * the confirm beat re-derives. Nothing is written to produce it.
 *
 * `previewId` is an opaque server id used for audit correlation and for proving that a confirm
 * matches the preview the chat was shown. It is deliberately NOT carried in the postback — the
 * server looks the preview up by chat, so a forged or replayed id can reach nothing (§5.4, SEC-04).
 */
export type LineDraftUpdatePreview = {
  previewId: string;
  recordType: LineDraftRecordType;
  expenseId: string;
  /**
   * The record the edit targets, as TYPED fields rather than one pre-joined sentence. A renderer
   * needs to format the date for its own audience (the LINE channel prints Buddhist-era Thai), and
   * it must not have to guess which half of a joined string was untrusted: `vendorName` is the one
   * attacker-controlled part and arrives already scrubbed, the rest is the server's own.
   */
  record: {
    vendorName: string | null;
    /** ISO `YYYY-MM-DD`, read off the record. */
    expenseDate: string;
    /** Thai status label from `EXPENSE_STATUS_LABELS`. */
    statusLabel: string;
  };
  /** The tool that proposed this edit; the card copy is chosen from it. */
  tool: LineDraftUpdateTool;
  diff: LineDraftUpdateDiffField[];
  totalsBefore: LineDraftUpdateTotals;
  totalsAfter: LineDraftUpdateTotals;
  /** Deterministic Thai warnings (unverified VAT on a charge, NEEDS_REVIEW reasons, …). */
  warnings: string[];
  expiresAt: string;
};

/** What the two buttons under a preview mean, in one place: the gateway's preview text ends with it
 *  and the API's confirm card prints it, so the sentence and the card cannot say different things. */
export const LINE_DRAFT_UPDATE_CONFIRM_HINT = 'กด [ยืนยัน] เพื่อบันทึก หรือ [ยกเลิก] ถ้ายังไม่แก้ค่ะ ยังไม่ได้บันทึกอะไรจนกว่าจะกดยืนยันนะคะ';

/** The locked design's "แก้ไขค่าใช้จ่าย" header: the context, then the state the edit is really in.
 *  Here, because the API's cards and the gateway's `edit_command` layout must name a state alike. */
export const LINE_DRAFT_UPDATE_CARD_CONTEXT = 'แก้ไขค่าใช้จ่าย';
export const LINE_DRAFT_UPDATE_CARD_STATES = {
  preview: 'รอยืนยัน',
  applied: 'แก้ไขแล้ว',
  cancelled: 'ยกเลิกแล้ว',
  /** The reply asks for the one thing it could not tell: which line, which record, which figure. */
  needs_input: 'ขอข้อมูลเพิ่ม',
  /** Everything else that ends with the record as it was: expired, changed, refused, not allowed. */
  unchanged: 'ยังไม่ได้แก้ไข',
} as const;
export type LineDraftUpdateCardState = keyof typeof LINE_DRAFT_UPDATE_CARD_STATES;

/** The refusals that are a question back to the user; the rest leave the record as it was. */
export function lineDraftUpdateBlockedState(reason: string): LineDraftUpdateCardState {
  return ['ambiguous_line', 'ambiguous_record', 'ungrounded_value', 'invalid_patch'].includes(reason) ? 'needs_input' : 'unchanged';
}

/** The confirm/cancel beat. It carries an INTENT and nothing else — no preview id, no expense id,
 *  no company id — because the server re-derives all of them from the chat that is answering. */
export type LineDraftUpdatePostback = {
  action: 'confirm' | 'cancel';
};

/**
 * Every free-text field on a captured record - vendor name, document number, line description,
 * a charge label the OCR wrote - is text an ATTACKER PUT ON A PIECE OF PAPER. It reaches a card,
 * a reply and an audit payload, so it is scrubbed once, here, and both apps import this copy: the
 * API renders the confirm card, the gateway renders the answer, and a second implementation is how
 * one of them ends up printing a total the server never computed.
 *
 * The alphabet is deliberately wider than ASCII. A guard written against `\\d` and `\\b` passes every
 * one of these, all of which render as a convincing total on a Thai phone:
 *
 *   ๙๙,๙๙๙.๐๐        Thai numerals
 *   ９９，９９９．００   fullwidth digits with fullwidth comma and period
 *   99,999            integer-only, no decimal point
 *   ร้านabcwww.evil.com   `\\b` does not fire between a Thai letter and a Latin one
 *
 * Links are matched by SHAPE, never by a list of known TLDs (slice C review F11): `evil.xyz`,
 * `evil.app` and `evil.ru` all walked past an allowlist, and the registry grows faster than any
 * list in this file ever will. "Something dot two-or-more letters" is the rule.
 *
 * Money-shaped runs are MASKED, not dropped (F12). A label is mostly a name, and deleting the
 * whole field to remove a number takes the name with it - "ร้าน 7-Eleven สาขา 123" has to keep
 * saying which shop it is. Callers rendering a free-text SENTENCE, where a hole reads as though
 * the system said something it did not, pass `onMoney: 'drop'` and get an empty string instead.
 *
 * It is a DISPLAY guard, not an escape: it never makes untrusted text safe to obey, and no caller
 * may treat scrubbed text as an instruction.
 */
/** Latin, Thai and fullwidth digits - the three alphabets a Thai receipt can print a total in. */
const SCRUB_DIGIT = '0-9\u0e50-\u0e59\uff10-\uff19';
/** Grouping and decimal marks, including their fullwidth and Arabic twins. */
const SCRUB_SEPARATOR = ',.\uff0c\uff0e\u066b\u066c';
/** Fullwidth punctuation folded to ASCII, so one set of patterns covers every alphabet the OCR
 *  can hand us. `\uff05` (fullwidth %) and `\u3000` (ideographic space) are here because a
 *  pattern written in ASCII does not see them. */
const SCRUB_FOLD: Readonly<Record<string, string>> = { '\uff0c': ',', '\uff0e': '.', '\uff05': '%', '\u3000': ' ', '\u066b': '.', '\u066c': ',' };
/** What a masked figure looks like. An ellipsis reads as "something was here", which is the
 *  honest thing for a reader to conclude. */
export const SCRUB_MASK = '…';

/** Control characters and the bidi overrides that can make a number read backwards. */
// eslint-disable-next-line no-control-regex
const SCRUB_INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
/**
 * Links, in two passes.
 *
 * The first is unambiguous: anything with a scheme or a `www.` is a link, whole token.
 *
 * The second finds a BARE host, and it has to thread a needle. Matching "something dot letters"
 * alone deletes ordinary text a Thai receipt really prints - `ABC Co.Ltd` became `ABC`,
 * `St.Louis Hospital` became `Hospital`, `TAX.INV` vanished entirely. So a bare host must ALSO
 * carry a corroborating signal: a path (`bit.ly/x9`), or a second dot (`evil.example.com`), or a
 * TLD that is NOT immediately followed by another letter - which is what separates `evil.xyz` from
 * `Co.Ltd`, where the "TLD" runs straight into more word.
 *
 * No allowlist of TLDs, and no leading `\b`: the registry grows faster than any list in this file,
 * and `\b` does not fire between a Thai letter and a Latin one, which is exactly where a smuggled
 * host hides (`ร้านabcwww.evil.com`).
 */
/**
 * A scheme is a hard signal wherever it appears, so `https?://` needs no boundary. `www.` does: in
 * `ร้านabcwww.evil.com` it sits mid-token, and matching there strips `www.evil.com` and hands back
 * `ร้านabc` — half a host glued to the shop's name. Guarded, it declines, and the corroborated
 * pass below takes `abcwww.evil.com` whole from the Thai→Latin boundary.
 *
 * Declared as a getter rather than a literal because it shares the boundary with the passes below,
 * which is defined after it.
 */
const scrubSchemeLink = (): RegExp => new RegExp(`https?:\\/\\/\\S+|${SCRUB_ASCII_BOUNDARY}www\\.\\S+`, 'giu');
/** The tiebreaker suffixes, shared by the ASCII and the IDN pass so the two can never disagree.
 *
 * Ordered generic-then-country and kept flat on purpose: it is read as a set, and a missing entry
 * is a live link printed verbatim on a card.
 *
 * `id`, `in`, `us` and `it` are DELIBERATELY ABSENT. All four are real ccTLDs, and all four also
 * spell the tail of an ordinary uppercase receipt abbreviation: `TAX.ID`, `REF.ID`, `DOC.ID`,
 * `CUST.ID`, `DINE.IN`, `CHECK.IN`, `WALK.IN`, `LOG.IN`, `CALL.US`, `CONTACT.US`, `ABOUT.US`,
 * `DO.IT`. This rule fires on exactly that shape — one dot, no path, nothing after the suffix — so
 * carrying them eats a real line off the card, and stripping a customer's tax id is a certain bug.
 * A bare `something.in` with no path and no second dot is a word; anything with either signal is
 * already stripped by the passes above, whatever its suffix. Revisit only with such a signal.
 *
 * ACCEPTED RESIDUAL (§D.15), recorded rather than fixed: the same collision exists for entries that
 * predate this round — `MAIN.ST`, `CALL.ME`, `ABC.CO`, `GO.LIVE`, `THE.SHOP`, `MY.APP` are stripped
 * by `st`, `me`, `co`, `live`, `shop`, `app`. Those are left alone here: each removal trades a false
 * positive on the card for a live link printed verbatim, and that trade needs its own evidence.
 */
const SCRUB_TLDS = 'com|net|org|io|co|ru|cn|th|dev|ai|zip|mov|xyz|app|link|click|top|shop|site|live'
  + '|info|biz|online|store|icu|vip|ly|me|tv|cc|gg|to|sh|st'
  + '|uk|jp|de|fr|ca|au|pl|nl|es|br|kr|sg|my|vn|ph';

/**
 * PASS (a), ASCII labels. The label may only START at a script boundary: the character before it
 * must not be a Latin letter, a combining mark, or a digit.
 *
 * That lookbehind is the whole lesson of B1. Thai writes its tone marks and vowel signs as separate
 * combining code points, so in `ร้านabcbit.ly` the Latin run that reaches the dot begins inside the
 * Thai word; without the boundary this pass strips `านabcbit.ly` and hands back `ร้`. The class is
 * `\\p{Script=Latin}`, not `[A-Za-z]`: `ü` is a Latin letter that the ASCII range does not contain,
 * and with the narrower test `münchen.de` was clipped to `mü`. Thai→Latin
 * counts AS a boundary (Thai letters are not Latin), which is exactly what lets `abcbit.ly/x9` go
 * while `ร้าน` stays. In Latin the same rule stops `münchen.de` being clipped to `mü`.
 *
 * A label may also not start immediately after a DOT. Without that, `ร้านค้า.example.com` lost only
 * its `example.com` tail to this pass and left `ร้านค้า.` behind as residue — an ASCII label sitting
 * in the middle of an IDN host is not a host of its own, and leaving pass (b) the whole token is
 * the only way it can take the whole token.
 */
const SCRUB_ASCII_BOUNDARY = '(?<![\\p{Script=Latin}\\p{M}0-9])(?<!\\.)';
/** Corroborated by shape: a path, or two-plus dots where EVERY label is at least two characters.
 *  Both labels stay ASCII, which is what keeps `กก.ขข.คค` and `เอ.บี.ซี.` out of the host branch —
 *  no registrable host is a run of Thai initials. */
const SCRUB_BARE_HOST = new RegExp(
  `${SCRUB_ASCII_BOUNDARY}[a-z0-9-]{2,}(?:\\.[a-z0-9-]{2,}){2,}(?![a-z0-9-])\\S*`
  + `|${SCRUB_ASCII_BOUNDARY}[a-z0-9-]+\\.[a-z]{2,24}\\/\\S*`,
  'giu',
);
/**
 * The genuinely ambiguous case, and the only place a TLD list earns its keep: ONE dot, no path.
 * `evil.xyz` and `Co.Ltd` are the same shape, so shape cannot separate them — and both mistakes are
 * real. Deleting `ABC Co.Ltd` down to `ABC` loses the vendor's name; leaving `evil.xyz` prints a
 * host a reader might tap. Anything with a scheme, a path or a second dot is already gone above,
 * whatever its TLD, so the list only ever decides this one shape.
 */
const SCRUB_AMBIGUOUS_HOST = new RegExp(
  `${SCRUB_ASCII_BOUNDARY}[a-z0-9-]+\\.(?:${SCRUB_TLDS})(?![a-z\\p{L}])`,
  'giu',
);

/**
 * PASS (b), IDN labels — `ร้านค้า.com`, `café.com`, `münchen.de`, `東京.jp`. A phone linkifies every
 * one of them, and pass (a) cannot see them: there is no ASCII character immediately before the dot
 * for it to bite on.
 *
 * Anchored at a HARD boundary (start of string, whitespace, or punctuation) and never mid-word,
 * because a mid-word match is precisely the bug this replaces. The inner labels and the suffix stay
 * ASCII: that is what stops an all-Thai dotted phrase — `กก.ขข.คค`, `ลาดพร้าว.วังหิน.โชคชัย` — from
 * reading as a host.
 *
 * Runs AFTER pass (a). On `ร้านabcbit.ly/x9` this pattern would otherwise match `ร้านabcbit.ly/x9`
 * whole and take the shop's name with it; by the time it runs, pass (a) has already removed the
 * link and left the name alone.
 */
const SCRUB_IDN_HOST = new RegExp(
  `(?<=^|[\\s\\p{P}])[\\p{L}\\p{M}0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${SCRUB_TLDS})(?![a-z\\p{L}])\\S*`,
  'giu',
);

export type ScrubOptions = {
  /** `mask` (default) keeps the label and replaces the figure; `drop` empties the whole value. */
  onMoney?: 'mask' | 'drop';
};

export function scrubRecordText(
  value: string | null | undefined,
  maxLength = 60,
  options: ScrubOptions = {},
): string {
  if (typeof value !== 'string') return '';
  const digit = `[${SCRUB_DIGIT}]`;
  const digitOrSep = `[${SCRUB_DIGIT}${SCRUB_SEPARATOR}]`;
  const percentSource = `${digit}${digitOrSep}*\\s*(?:%|เปอร์เซ็น(?:ต์)?)`;
  // Grouped (`99,999`), decimal (`99999.00`), or any bare run of THREE or more. Three is the
  // deliberate floor: Thai shops number their branches, so "ร้าน 7-Eleven สาขา 12" has to keep its
  // name, and nothing that short reads as a total beside a grouped figure like 1,789.04.
  const groupedSource = `${digit}${digitOrSep}+${digit}|${digit}{3,}`;
  // NFC first, so one spelling of a character cannot dodge a pattern written against another.
  // It does NOT do much for Thai — Thai vowel signs and tone marks have no canonical composition,
  // so NFC leaves them exactly as they are, and the `\p{M}` in the identifier charset is what
  // actually carries them. What NFC does buy is Latin: a decomposed `e` + U+0301 becomes `é`, so
  // `caf\u00e9.com` and `cafe\u0301.com` are the same string by the time the link rule sees them.
  // NFC, never NFKC — NFKC rewrites Thai in ways this channel has been bitten by before. Digits
  // fold in the same pass, so every pattern below is written once, in ASCII.
  const linkless = normalizeScrubDigits(value.normalize('NFC'))
    .replace(SCRUB_INVISIBLE, ' ')
    .replace(scrubSchemeLink(), ' ')
    // (a) then (b): see SCRUB_IDN_HOST. Reversing these two eats the Thai word before the link.
    .replace(SCRUB_BARE_HOST, ' ')
    .replace(SCRUB_AMBIGUOUS_HOST, ' ')
    .replace(SCRUB_IDN_HOST, ' ');
  // Fresh non-global regexes for the test: a `g` regex carries `lastIndex` between calls, so
  // reusing the replace ones here would make the answer depend on what was tested before it.
  if (options.onMoney === 'drop'
    && (new RegExp(percentSource, 'u').test(linkless) || new RegExp(groupedSource, 'u').test(linkless))) {
    return '';
  }
  const scrubbed = linkless
    // Percent first: `999%` would otherwise lose its digits to the money rule and leave a bare `%`.
    .replace(new RegExp(percentSource, 'gu'), SCRUB_MASK)
    .replace(new RegExp(groupedSource, 'gu'), SCRUB_MASK)
    .replace(/\s+/g, ' ')
    .trim();
  // Nothing but punctuation left is not a name — the caller's neutral fallback reads better than
  // printed debris.
  // `slice` counts UTF-16 units, so the bound can land between the halves of an emoji and leave a
  // lone high surrogate at the end — not a character any channel can send. Drop the half-glyph.
  return /[\p{L}\p{N}]/u.test(scrubbed) ? scrubbed.slice(0, maxLength).replace(/[\ud800-\udbff]$/u, '') : '';
}

/**
 * A document number is not prose: its DIGITS are the value. Masking them the way a label is
 * masked leaves "ใบเสร็จ-…", which tells the reader nothing.
 *
 * So an identifier is defined by SHAPE, not by subtraction: ONE token, no spaces, at most
 * `maxLength` characters, starting with a letter or digit and continuing with letters, digits,
 * `-`, `/`, `_` or `#`. Anything else answers null and the caller prints "ยังไม่ระบุ".
 *
 * `.` is deliberately NOT in the charset. Admitting it admits `99.999,00`, `1789.04` and
 * `192.168.1.1/pay` - the exact money and host shapes the label scrubber exists to remove, walked
 * straight through the field that is allowed to keep its digits. No real document number needs a
 * dot badly enough to reopen that hole.
 *
 * `\\p{M}` is in the class on purpose: Thai tone marks and vowel signs are separate combining code
 * points, so `\\p{L}\\p{N}` alone deletes the marks out of "ใบกำกับ-12" and hands back mangled Thai.
 * Digits are folded to ASCII first, so a Thai- or fullwidth-numeral identifier cannot smuggle a
 * different alphabet past a later comparison.
 */
const IDENTIFIER_SHAPE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9\-/_#]*$/u;

export function scrubRecordIdentifier(value: string | null | undefined, maxLength = 32): string | null {
  if (typeof value !== 'string') return null;
  const token = normalizeScrubDigits(value)
    .replace(SCRUB_INVISIBLE, ' ')
    .trim();
  if (token.length === 0 || token.length > maxLength) return null;
  return IDENTIFIER_SHAPE.test(token) ? token : null;
}

/**
 * Digits normalised to ASCII, so a comparison against a server figure cannot be fooled by the
 * alphabet it was written in. Callers that must compare untrusted text with a computed number
 * normalise BOTH sides through this.
 */
export function normalizeScrubDigits(value: string): string {
  return value.replace(new RegExp(`[${SCRUB_DIGIT}]`, 'gu'), (character) => {
    const code = character.codePointAt(0)!;
    if (code >= 0x0e50 && code <= 0x0e59) return String(code - 0x0e50);
    if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10);
    return character;
  }).replace(/[\uff0c\uff0e\uff05\u3000\u066b\u066c]/gu, (character) => SCRUB_FOLD[character] ?? character);
}

/** Why a draft edit could not even be previewed. Each maps to one deterministic Thai reply. */
export type LineDraftUpdateBlockedReason =
  | 'feature_disabled'
  | 'no_recent_record'
  | 'ambiguous_record'
  | 'mutation_blocked'
  | 'forbidden'
  | 'ambiguous_line'
  | 'ungrounded_value'
  | 'invalid_patch'
  | 'rate_limited';

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
  version: 1 | 2;
  /** Required by v2 and tied to the complete original turn, not a normalized prompt view. */
  inputDigest?: string;
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
  /** Present only when the gateway validated fields/classification against `documentText` with the
   * same receipt parser and gates as receipt OCR. Absence always means run the existing OCR path. */
  onePassReceipt?: LineIntakeOnePassReceipt;
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
  /** Exact approved-help ids selected from the server-offered allowlist, at most five. */
  selectedKnowledgeCardIds?: string[];
  howToActionId?: LineChatActionId;
  /** Present only under the trusted `responsePreference` capability, when the user explicitly asked to remember,
   *  see or forget how answers are given to them. Model advice: the API re-parses it with
   *  `parseLineAiResponsePreferenceCommand` and runs it through the owner-bound preference commands. */
  responsePreference?: LineAiResponsePreferenceCommand;
  /** V2 semantic inventory. Every user clause remains independently represented. */
  semanticSubrequests?: LineAiSemanticSubrequestV2[];
};

export type LineAiWebLink = {
  label: string;
  path: string;
};

export type LineAiAnswerCard = {
  /** Fixed registry entry; the API rechecks current action access before offering its command. */
  chatActionId?: LineChatActionId;
  /** Bounded navigation suggestions; the API rechecks every action against current access. */
  chatActionIds?: LineChatActionId[];
  title?: string;
  text: string;
  sourceLabels?: string[];
  webLink?: LineAiWebLink;
  /** Spec §13: one state badge rendered as its own row above the body. Additive — a card without
   *  one renders exactly as it did before, and an older gateway never sends one. */
  badge?: string;
  /** The locked System OA card design. Additive: absent, the card is its `text` as before. */
  layout?: LineAiAnswerCardLayout;
};

/**
 * What a structured answer shows on the locked System OA card (docs/specs/
 * line-system-oa-card-design-lock-spec-th.md) instead of a paragraph: two header lines and
 * `label : value` rows. The trusted gateway fills it from ONE successful, permission-checked tool
 * result — never from model text, and it is never Flex JSON. `text` stays the canonical answer: it is
 * the notification, the fallback, and what is sent wherever this cannot be drawn.
 */
export const LINE_AI_ANSWER_CARD_CONTEXTS = ['expense_summary', 'open_work', 'expense_record', 'payment', 'edit_command'] as const;
export type LineAiAnswerCardContext = (typeof LINE_AI_ANSWER_CARD_CONTEXTS)[number];
export type LineAiAnswerCardRow = {
  label: string;
  value: string;
  /** The one figure the card is about. */
  emphasis?: 'total';
  /** The value is a state, drawn as a pill. */
  tone?: 'ok' | 'pending' | 'closed';
};
export type LineAiAnswerCardLayout = {
  context: LineAiAnswerCardContext;
  /** Exactly two lines: the context, then the state or period. */
  header: [string, string];
  /** Empty for `edit_command`, whose body is the card's `text`. */
  rows: LineAiAnswerCardRow[];
  banner?: { tone: 'ok' | 'pending'; text: string };
  notes?: string[];
  /** Words of the card's one button. Where it leads is the card's `webLink`, which the API checks. */
  linkLabel?: string;
};

const CARD_ROW_TONES = ['ok', 'pending', 'closed'] as const;
// eslint-disable-next-line no-control-regex
const CARD_LINE_REFUSED = /[\u0000-\u001f\u007f]|https?:\/\//iu;
/** One line a card may print: bounded, no control character, and never a link. */
const cardLine = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && Array.from(value).length <= max && !CARD_LINE_REFUSED.test(value);

/** Receiver-boundary validator: every receiver re-parses and drops what does not parse, so a card
 *  with a malformed layout is simply its `text`. Exact keys, bounded strings, allowlisted enums. */
export function parseLineAiAnswerCardLayout(value: unknown): LineAiAnswerCardLayout | undefined {
  if (!recordValue(value) || !exactKeys(value, ['context', 'header', 'rows', 'banner', 'notes', 'linkLabel'])) return undefined;
  const { context, header, rows, banner, notes, linkLabel } = value;
  if (!(LINE_AI_ANSWER_CARD_CONTEXTS as readonly unknown[]).includes(context)) return undefined;
  if (!Array.isArray(header) || header.length !== 2 || !header.every((line) => cardLine(line, 40))) return undefined;
  if (!Array.isArray(rows) || rows.length > 16 || (context === 'edit_command') !== (rows.length === 0)) return undefined;
  for (const row of rows) {
    if (!recordValue(row) || !exactKeys(row, ['label', 'value', 'emphasis', 'tone'])
      || !cardLine(row['label'], 40) || !cardLine(row['value'], 200)
      || (row['emphasis'] !== undefined && row['emphasis'] !== 'total')
      || (row['tone'] !== undefined && !(CARD_ROW_TONES as readonly unknown[]).includes(row['tone']))) return undefined;
  }
  if (banner !== undefined && (!recordValue(banner) || !exactKeys(banner, ['tone', 'text'])
    || (banner['tone'] !== 'ok' && banner['tone'] !== 'pending') || !cardLine(banner['text'], 120))) return undefined;
  if (notes !== undefined && (!Array.isArray(notes) || notes.length > 4 || !notes.every((note) => cardLine(note, 300)))) return undefined;
  if (linkLabel !== undefined && !cardLine(linkLabel, 40)) return undefined;
  return {
    context: context as LineAiAnswerCardContext,
    header: [header[0] as string, header[1] as string],
    rows: (rows as Array<Record<string, unknown>>).map((row) => ({
      label: row['label'] as string, value: row['value'] as string,
      ...(row['emphasis'] === 'total' ? { emphasis: 'total' as const } : {}),
      ...(row['tone'] !== undefined ? { tone: row['tone'] as LineAiAnswerCardRow['tone'] } : {}),
    })),
    ...(banner !== undefined ? { banner: { tone: (banner as Record<string, unknown>)['tone'] as 'ok' | 'pending', text: (banner as Record<string, unknown>)['text'] as string } } : {}),
    ...(notes !== undefined && (notes as string[]).length ? { notes: [...notes as string[]] } : {}),
    ...(linkLabel !== undefined ? { linkLabel: linkLabel as string } : {}),
  };
}

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
  /** Server-observed read ask-back; never mutation authority. */
  reasonCode?: 'READ_FILTER_NOT_UNDERSTOOD';
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

/** Read-only grounding selects answered entries, or the sole open question when no ids were emitted. */
export function lineAiReplyClarifications(open: readonly LineAiOpenClarification[] | undefined, ids?: readonly string[]): LineAiOpenClarification[] {
  return (open ?? []).filter(entry => ids ? ids.includes(entry.id) : open?.length === 1);
}

/** AgentCore is a separate JSON boundary; keep the existing question data bounded on that hop. */
export function parseLineAiOpenClarifications(value: unknown): LineAiOpenClarification[] | undefined {
  if (!Array.isArray(value) || value.length > 5) return undefined;
  const out: LineAiOpenClarification[] = [];
  for (const item of value) {
    if (!recordValue(item) || typeof item['id'] !== 'string' || !item['id'] || item['id'].length > 200
      || typeof item['text'] !== 'string' || item['text'].length > 12000
      || typeof item['question'] !== 'string' || item['question'].length > 2000
      || typeof item['askedAt'] !== 'string' || !Number.isFinite(Date.parse(item['askedAt']))) return undefined;
    const clarifyForIntent = asIntakeRouteIntent(item['clarifyForIntent']);
    const candidates = item['candidateExpenseIds'];
    const media = item['pendingMedia'];
    if (item['clarifyForIntent'] !== undefined && !clarifyForIntent
      || candidates !== undefined && (!Array.isArray(candidates) || candidates.length > 5 || candidates.some(id => typeof id !== 'string' || !id || id.length > 200))
      || media !== undefined && (!recordValue(media) || ['pendingMediaId', 'attachmentId', 'mimeType'].some(key => typeof media[key] !== 'string' || !media[key] || String(media[key]).length > 200))) return undefined;
    out.push({ id: item['id'], text: item['text'], question: item['question'], askedAt: item['askedAt'],
      ...(LINE_AI_BUSINESS_SUBJECTS.includes(item['subject'] as LineAiBusinessSubject) ? { subject: item['subject'] as LineAiBusinessSubject } : {}),
      ...(item['reasonCode'] === 'READ_FILTER_NOT_UNDERSTOOD' ? { reasonCode: item['reasonCode'] } : {}),
      ...(clarifyForIntent ? { clarifyForIntent } : {}), ...(candidates ? { candidateExpenseIds: [...candidates as string[]] } : {}),
      ...(media ? { pendingMedia: { pendingMediaId: (media as Record<string, string>)['pendingMediaId']!, attachmentId: (media as Record<string, string>)['attachmentId']!, mimeType: (media as Record<string, string>)['mimeType']! } } : {}) });
  }
  return out;
}

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

/** Strict v2 result coverage, indexed against the API-preserved semantic subrequest inventory. */
export type LineAiSemanticCoverageV2 = {
  index: number;
  status: 'handled' | 'denied' | 'unsupported' | 'needs_user';
  reasonCode?: string;
  question?: string;
  sourceRefIds?: string[];
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
  /** Set only when the expense-summary reply was rendered deterministically from every included result. */
  deterministicExpenseSummary?: boolean;
  /** Set only for a fixed read-free answer about the expense summary exclusion rule. */
  deterministicExpenseCriterionConfirmation?: boolean;
  /** Item 10F: critic verdicts per sub-request (native loop path only). Drives the API-side
   *  ledger acks/appends; absent on the 10B paths. */
  coverage?: LineAiCoverageItem[];
  /** V2 coverage, complete and indexed against `LineAiTurnRequest.semanticSubrequests`. */
  semanticCoverage?: LineAiSemanticCoverageV2[];
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
  | 'PROVIDER_CONTRACT_UNSUPPORTED'
  | 'PROVIDER_THROTTLED'
  | 'PROVIDER_ACCESS_NOT_READY'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_OUTPUT_INCOMPLETE'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_TOOL_ARGUMENT_INVALID'
  /** The company's monthly AI MONEY refused the call (spec §9.4). Distinct from `PROVIDER_THROTTLED`:
   *  no amount of waiting opens it this month, so it is never offered as retryable. */
  | 'PROVIDER_BUDGET_EXHAUSTED'
  | 'PROVIDER_UNKNOWN';

export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  /** Set only with `PROVIDER_BUDGET_EXHAUSTED`, and only when the gate reported it. */
  budgetScope?: AiBudgetScope;
  /**
   * Set only with `PROVIDER_BUDGET_EXHAUSTED`: WHICH money answer stopped this invocation, so a
   * chain that is refused mid-way surfaces the seam's own vocabulary (spec §9.1) instead of a
   * generic provider failure. Every route maps `budgetCode ?? code` into its existing error
   * envelope, which is what keeps "เหลือไม่พอ" from being reported as "ลองใหม่อีกครั้ง".
   */
  budgetCode?: AiBudgetRefusalCode;
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
  /** Selected source evidence for a v2 prepared call; advisory until the executor re-checks the
   * authoritative candidate set and permission-checked tool contract. */
  candidateIds?: string[];
  sourceRefs?: import('./line-ai-input-evidence.js').LineAiSourceRefV2[];
};

export type LineAiPreparedPlan = {
  version: 1 | 2;
  /** Required by version 2 and bound to the complete raw turn evidence. */
  inputDigest?: string;
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
  toolData?: Array<{ tool: string; data: unknown; input?: Record<string, unknown> }>;
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

/** Sold deterministic workflows. The existing chat-action ids remain the wire ids. */
export const LINE_WORKFLOW_IDS = [
  'reimbursement_claim', 'reimbursement_submit', 'reimbursement_cancel', 'approvals',
  'reimbursement_reject', 'reimbursement_pay', 'expense_submit', 'expense_confirm',
  'expense_delete', 'expense_void', 'expense_pay', 'payment_voucher', 'wht_certificate',
  'substitute_receipt',
] as const;
export type LineWorkflowId = typeof LINE_WORKFLOW_IDS[number];

export type LineWorkflowClassifyRequest = {
  requestId: string; companyId: string; userId: string; locale: 'th-TH' | 'en-GB';
  messageText: string; inputEvidence: LineAiInputEvidenceV2;
  budgetGrantV2: AiBudgetGrantV2;
  contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'];
};
export type LineWorkflowLabel = LineWorkflowId | 'read' | 'howto' | 'open' | 'smalltalk' | 'multi' | 'unclear';
export type LineWorkflowClassifyResponse =
  | { status: 'CLASSIFIED'; label: LineWorkflowLabel; secondLabel: LineWorkflowLabel | 'none';
      confidence: number; secondConfidence: number;
      slots: { reference: 'this' | 'last_shown' | 'named' | 'none'; ordinal: number; personName: string; vendorName: string;
               descriptionText: string; amountText: string; dateText: string; reasonText: string; categoryText: string };
      schemaEnforcement: 'output_config' | 'strict_tool'; usage: AiUsageEntry[]; modelId: string }
  | { status: 'UNAVAILABLE'; errorCode: string; budgetCode?: string; usage: AiUsageEntry[] };

export const LINE_WORKFLOW_OPEN_ACTIONS = [
  'MARK_READY', 'CONFIRM', 'DELETE_DRAFT', 'VOID', 'REIMBURSEMENT_SUBMIT', 'REIMBURSEMENT_CANCEL',
  'REIMBURSEMENT_APPROVE', 'REIMBURSEMENT_REJECT', 'REIMBURSEMENT_RECORD_PAYMENT', 'RECORD_PAYMENT',
  'VOUCHER_CREATE', 'VOUCHER_SUBMIT', 'VOUCHER_APPROVE', 'VOUCHER_RETURN', 'VOUCHER_PAY',
  'VOUCHER_CANCEL', 'WHT_CERTIFICATE_ISSUE',
] as const;
export type LineWorkflowControl =
  | { action: 'wf_open'; act: typeof LINE_WORKFLOW_OPEN_ACTIONS[number]; id: string; pm?: string; pd?: string; pa?: string; sig: string }
  | { action: 'wf_choice'; token: string; pick: LineWorkflowId | 'other' };
export type LineFixedReadControl = { id: 'expense_month' };

export function parseLineFixedReadControl(data: string | undefined): LineFixedReadControl | null {
  if (!data || data.length > 300) return null;
  const params = new URLSearchParams(data);
  return [...params.keys()].length === 2 && params.getAll('action').length === 1 && params.getAll('id').length === 1
    && params.get('action') === 'fixed-read' && params.get('id') === 'expense_month' ? { id: 'expense_month' } : null;
}

/** User politeness is never a collected business field. */
const LINE_FIELD_PARTICLE = /^(?:(?:ค่ะ|คะ|ค่า|ครับ|คับ|ค้าบ|งับ|จ้ะ|จ๊ะ|จ้า|จ๋า|จา|ฮะ|นะ|น้า|เด้อ)[าะ]*)+$/u;
const lineFieldWords = new Intl.Segmenter('th', { granularity: 'word' });
// Thai has no spaces, so a particle is dropped only when the word segmenter reads it as its own
// word: "บังคับ", "หน้า", "มูลค่า", "เจ้า" and "ชนะ" keep their last syllable.
export function stripLineFieldParticles(text: string): string {
  const words = [...lineFieldWords.segment(text.trim())].map(part => part.segment);
  let removed = false;
  for (;;) {
    while (words.length && /^[\s.!?,…ๆ]+$/u.test(words.at(-1)!)) words.pop();
    const last = words.at(-1);
    if (last === undefined) break;
    if (/^[าะ]+$/u.test(last) && words.length > 1 && LINE_FIELD_PARTICLE.test(words.at(-2)!)) { words.pop(); continue; }
    if (last === 'ผม' && words.at(-2) === 'ครับ') { words.splice(-2); removed = true; continue; }
    if (!LINE_FIELD_PARTICLE.test(last)) break;
    words.pop(); removed = true;
  }
  // Punctuation alone is kept ("หจก."); it goes only together with a removed particle.
  return removed ? words.join('').trim() : text.trim();
}

/** A put-off is a task control, never a collected field. */
export function isLineWorkflowPutOff(text: string): boolean {
  const value = stripLineFieldParticles(text.normalize('NFC'));
  return !/[?？]|ไหม|มั้ย/u.test(value) && /^(?:(?:เอา|ขอ|งั้น|ก็|โอเค|ok)\s*)*(?:ไว้ก่อน|พัก(?:เรื่องนี้|งานนี้|ใบรับรองแทนใบเสร็จ|ใบรับรอง)?(?:ไว้)?ก่อน|พัก\S{0,30}?ไว้(?=$|\s|ก่อน|ค่ะ|คะ|ครับ|คับ|ฮะ|จ้ะ|จ๊ะ|จ้า|นะ)|ไว้ทำทีหลัง|เดี๋ยว(?:กลับมา|ค่อยมา|ค่อย)?ทำ|ยังไม่ทำตอนนี้|(?:ไม่ทำต่อ|ไม่ต่อ|ไม่ทำ|ไม่เอา|ไม่ต้องทำ)$|ขอไปถาม[^\n]*ก่อน|รอก่อน|pause(?: the)?(?: substitute receipt)?(?: for now)?(?:$|\s))/iu.test(value);
}

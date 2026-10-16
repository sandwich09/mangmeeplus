// ---- Item 17: AI Draft and Suggestion Layer ----
//
// A safe AI draft/suggestion layer. AI may suggest and draft; web-reviewed source
// modules decide. Final money, stock, tax, accounting, approval, export, permission,
// and external publishing mutations stay blocked for AI. Every suggestion is
// permission-aware, source-cited, auditable, and reviewable in web before it can
// create any source-module draft record. LINE may request/summarize/deep-link only.

import type { AiUsageEntry } from './ai-lineage.js';
import type { AiBudgetEnvelope } from './ai-budget-bounds.js';
import type { AiBudgetScope } from './line-ai.js';

// ---- Enums (string unions, repo convention) ----

export type AiSuggestionDomain = 'CFO' | 'SALES_CRM' | 'INVENTORY' | 'TAX_ACCOUNTING' | 'WORKFLOW';

export type AiSuggestionAgent = 'CFO' | 'SALES' | 'CRM' | 'INVENTORY' | 'TAX' | 'ACCOUNTING' | 'WORKFLOW';

export type AiDraftRequestOrigin = 'WEB' | 'LINE' | 'WORKFLOW' | 'SCHEDULE' | 'SYSTEM';

export type AiDraftRequestStatus =
  | 'QUEUED'
  | 'GENERATING'
  | 'READY'
  | 'NEEDS_DATA'
  | 'PROVIDER_UNAVAILABLE'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED';

export type AiSuggestionStatus =
  | 'NEW'
  | 'IN_REVIEW'
  | 'ACCEPTED_FOR_SOURCE_DRAFT'
  | 'SOURCE_DRAFT_CREATED'
  | 'DISMISSED'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'BLOCKED_BY_PERMISSION'
  | 'BLOCKED_BY_SOURCE_STATE'
  | 'FAILED';

export type AiDraftArtifactStatus =
  | 'DRAFT'
  | 'REGENERATED'
  | 'LOCKED_FOR_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'EXPIRED';

export type AiDraftArtifactType = 'TEXT' | 'JSON_PAYLOAD' | 'CHECKLIST' | 'SOURCE_DRAFT_PAYLOAD';

export type AiReviewDecision =
  | 'ACCEPT_AS_SOURCE_DRAFT'
  | 'REQUEST_REGENERATION'
  | 'EDIT_AND_ACCEPT'
  | 'DISMISS'
  | 'MARK_NEEDS_DATA'
  | 'MARK_NOT_USEFUL'
  | 'ESCALATE_TO_OWNER';

// Closed allowlist of candidate actions. There is deliberately NO final-mutation
// action type: AI cannot express posting, paying, issuing, filing, or approving.
export type AiCandidateActionType =
  | 'CREATE_CRM_FOLLOW_UP_DRAFT'
  | 'CREATE_ACCOUNTING_QUOTATION_DRAFT'
  | 'CREATE_INVENTORY_REORDER_REVIEW'
  | 'CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST'
  | 'CREATE_TAX_EVIDENCE_CHECKLIST'
  | 'CREATE_TAX_CERTIFICATE_DRAFT'
  | 'CREATE_WORKFLOW_TASK'
  | 'CREATE_REVIEW_CHECKLIST'
  | 'NO_SOURCE_DRAFT_AVAILABLE';

export type AiCandidateActionStatus =
  | 'PROPOSED'
  | 'VALIDATED'
  | 'VALIDATION_FAILED'
  | 'SOURCE_DRAFT_CREATED'
  | 'REJECTED'
  | 'BLOCKED';

export type AiRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

// The AI suggestion pages and the AI suggestion report use these words.
export const AI_SUGGESTION_STATUS_LABELS: Record<AiSuggestionStatus, string> = {
  NEW: 'ใหม่',
  IN_REVIEW: 'กำลังตรวจสอบ',
  ACCEPTED_FOR_SOURCE_DRAFT: 'อนุมัติให้สร้างร่าง',
  SOURCE_DRAFT_CREATED: 'สร้างร่างแล้ว',
  DISMISSED: 'ปิดแล้ว',
  SUPERSEDED: 'มีคำแนะนำใหม่กว่า',
  EXPIRED: 'หมดอายุ',
  BLOCKED_BY_SOURCE_STATE: 'ข้อมูลต้นทางเปลี่ยน',
  BLOCKED_BY_PERMISSION: 'สิทธิ์ไม่เพียงพอ',
  FAILED: 'สร้างไม่สำเร็จ',
};

export const AI_RISK_LEVEL_LABELS: Record<AiRiskLevel, string> = {
  LOW: 'ปกติ',
  MEDIUM: 'ควรตรวจสอบ',
  HIGH: 'ต้องระวัง',
};

/** A suggestion the AI could not complete without more data (`needsData`). */
export const AI_SUGGESTION_NEEDS_DATA_LABEL = 'ต้องการข้อมูล';

export type AiSuggestionTemplateStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'DEPRECATED';

export type AiProviderMode = 'deterministic' | 'fake' | 'bedrock' | 'openai' | 'disabled';

// AI tool categories (tool policy). `final_mutation` is always blocked for AI.
export type AiToolCategory =
  | 'read_summary'
  | 'read_detail'
  | 'read_evidence_pack'
  | 'draft_generate'
  | 'draft_validate'
  | 'source_draft_create'
  | 'review_decision'
  | 'notification_request'
  | 'final_mutation';

// ---- Read DTOs ----

export type AiSuggestionCitation = {
  id: string;
  sourceModule: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourceField?: string;
  label: string;
  valuePreview?: string;
  webDeepLink?: string;
  capturedAt: string;
};

export type AiCandidateAction = {
  id: string;
  actionType: AiCandidateActionType;
  targetModule: string;
  targetRecordType?: string;
  targetRecordId?: string;
  draftPayloadJson: Record<string, unknown>;
  requiredPermissions: string[];
  riskLevel: AiRiskLevel;
  status: AiCandidateActionStatus;
  validationResultJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AiDraftArtifact = {
  id: string;
  version: number;
  artifactType: AiDraftArtifactType;
  language: string;
  contentPreview?: string;
  structuredContentJson?: Record<string, unknown>;
  status: AiDraftArtifactStatus;
  modelProvider?: string;
  modelName?: string;
  createdAt: string;
};

export type AiSuggestionReview = {
  id: string;
  candidateActionId?: string;
  reviewerUserId: string;
  decision: AiReviewDecision;
  note?: string;
  createdSourceModule?: string;
  createdSourceRecordType?: string;
  createdSourceRecordId?: string;
  sourceDraftDeepLink?: string;
  createdAt: string;
};

export type AiSuggestionSummary = {
  id: string;
  agent: AiSuggestionAgent;
  domain: AiSuggestionDomain;
  title: string;
  summary: string;
  riskLevel: AiRiskLevel;
  confidence: number;
  status: AiSuggestionStatus;
  needsData: boolean;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  citationCount: number;
  candidateActionCount: number;
  reviewOwnerUserId?: string;
  assignedRole?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiSuggestionDetail = AiSuggestionSummary & {
  recommendation: string;
  needsDataReasons: string[];
  blockedReasons: string[];
  sourceStateHash?: string;
  sourceStateChanged: boolean;
  citations: AiSuggestionCitation[];
  artifacts: AiDraftArtifact[];
  candidateActions: AiCandidateAction[];
  reviews: AiSuggestionReview[];
};

export type AiSuggestionTemplateSummary = {
  id: string;
  key: string;
  domain: AiSuggestionDomain;
  defaultAgent: AiSuggestionAgent;
  title: string;
  description: string;
  triggerModes: string[];
  requiredSourceModules: string[];
  requiredPermissions: string[];
  riskLevel: AiRiskLevel;
  defaultTtlMinutes: number;
  enabled: boolean;
  status: AiSuggestionTemplateStatus;
  unavailableReason?: string;
};

export type AiProviderStatus = {
  mode: AiProviderMode;
  available: boolean;
  reason?: string;
};

// ---- Request DTOs ----

export type CreateAiDraftRequestDto = {
  templateKey: string;
  origin?: AiDraftRequestOrigin;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  sourceRefsJson?: Record<string, unknown>;
  promptText?: string;
  language?: string;
  idempotencyKey?: string;
  workflowRunId?: string;
};

export type AiDraftRequestSummary = {
  id: string;
  origin: AiDraftRequestOrigin;
  agent: AiSuggestionAgent;
  templateKey: string;
  status: AiDraftRequestStatus;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  suggestionId?: string;
  expiresAt?: string;
  createdAt: string;
};

export type ListAiSuggestionsFilter = {
  status?: AiSuggestionStatus;
  domain?: AiSuggestionDomain;
  agent?: AiSuggestionAgent;
  riskLevel?: AiRiskLevel;
  sourceModule?: string;
  scope?: 'own' | 'all';
  page?: number;
  pageSize?: number;
};

export type ReviewAiSuggestionDto = {
  decision: AiReviewDecision;
  note?: string;
  candidateActionId?: string;
};

export type CreateSourceDraftDto = {
  acknowledgeSourceStateChanged?: boolean;
  editedPayloadJson?: Record<string, unknown>;
};

// ---- Draft generation contract (API <-> AI Gateway) ----
//
// The API gathers grounded evidence (source reads = tools) and asks the AI Gateway to
// AUTHOR the suggestion content from that evidence. The model never invents source ids
// or citations — those come from the evidence pack. Output is parsed/validated before
// persistence; unparseable/uncited/unsafe output is rejected (needs-data/failed).

export type AiDraftEvidenceCitation = { label: string; valuePreview?: string };

export type AiDraftGenerationRequest = {
  templateKey: string;
  language: string;
  agent: AiSuggestionAgent;
  domain: AiSuggestionDomain;
  defaultTitle: string;
  facts: string[];
  citations: AiDraftEvidenceCitation[];
  wantsChecklist: boolean;
  /**
   * Tenant of the request, sent only under a SPLIT budget envelope: the gateway's receiver boundary
   * validates that `budgetEnvelope.invocationKey` belongs to THIS company (ADR 0013 §11.1), which
   * it cannot do without knowing which company asked. Absent for every SHARED request, so the body
   * of one is unchanged.
   */
  companyId?: string;
  /**
   * The invocation this draft runs inside (ADR 0013 §6). Optional and additive: an older gateway
   * ignores it, and this seam only sends it when the API actually holds money for the call, so the
   * gateway can enforce the bounds that hold was priced at instead of running unbounded.
   */
  budgetEnvelope?: AiBudgetEnvelope;
};

export type AiDraftGenerationError = {
  code: string;
  message: string;
  retryable: boolean;
  /** Set only when `code` is one of `AI_BUDGET_REFUSAL_CODES` (spec §9.1). */
  budgetScope?: AiBudgetScope;
};

/** `usage` rides the intersection so both arms carry what the gateway measured (metering §7.1). */
export type AiDraftGenerationResult = { usage?: AiUsageEntry[] } & (
  | {
      ok: true;
      provider: string;
      model?: string;
      title?: string;
      summary: string;
      recommendation: string;
      riskLevel?: AiRiskLevel;
      confidence?: number; // 0..1
      actionTitle?: string;
      checklistItems?: string[];
    }
  | { ok: false; error: AiDraftGenerationError }
);

// ---- Permission keys (spec section 12) ----

export const AI_PERMISSION_KEYS = {
  SUGGESTION_READ: 'ai.suggestion.read',
  SUGGESTION_READ_OWN: 'ai.suggestion.read_own',
  SUGGESTION_REQUEST: 'ai.suggestion.request',
  SUGGESTION_GENERATE: 'ai.suggestion.generate',
  SUGGESTION_REVIEW: 'ai.suggestion.review',
  SUGGESTION_DISMISS: 'ai.suggestion.dismiss',
  SUGGESTION_ADMIN: 'ai.suggestion.admin',
  DRAFT_READ: 'ai.draft.read',
  DRAFT_REQUEST: 'ai.draft.request',
  DRAFT_REVIEW: 'ai.draft.review',
  DRAFT_CREATE_SOURCE_DRAFT: 'ai.draft.create_source_draft',
  TEMPLATE_READ: 'ai.template.read',
  TEMPLATE_MANAGE: 'ai.template.manage',
  TOOL_INVOCATION_READ: 'ai.tool_invocation.read',
} as const;

/** Source access used by the template catalog and the shop web entry points. */
export const AI_SUGGESTION_TEMPLATE_SOURCE_PERMISSIONS = {
  cfo_cash_risk_summary: ['bank.cash.read'],
  crm_followup_next_action: ['crm.customer.read'],
  inventory_reorder_review: ['inventory.report.read'],
  tax_evidence_checklist: ['tax.review_issue.read'],
  workflow_review_checklist: ['workflow.task.read'],
} as const;

export function hasAiSuggestionSourceAccess(permissions: readonly string[]): boolean {
  return Object.values(AI_SUGGESTION_TEMPLATE_SOURCE_PERMISSIONS).some(required => required.every(permission => permissions.includes(permission)));
}

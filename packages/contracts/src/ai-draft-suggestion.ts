// ---- Item 17: AI Draft and Suggestion Layer ----
//
// A safe AI draft/suggestion layer. AI may suggest and draft; web-reviewed source
// modules decide. Final money, stock, tax, accounting, approval, export, permission,
// and external publishing mutations stay blocked for AI. Every suggestion is
// permission-aware, source-cited, auditable, and reviewable in web before it can
// create any source-module draft record. LINE may request/summarize/deep-link only.

import type { AiUsageEntry } from './ai-lineage.js';

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
};

export type AiDraftGenerationError = { code: string; message: string; retryable: boolean };

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

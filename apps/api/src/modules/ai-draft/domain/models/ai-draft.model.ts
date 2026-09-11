import type {
  AiSuggestionDomain,
  AiSuggestionAgent,
  AiDraftRequestOrigin,
  AiDraftRequestStatus,
  AiSuggestionStatus,
  AiDraftArtifactStatus,
  AiDraftArtifactType,
  AiCandidateActionType,
  AiCandidateActionStatus,
  AiReviewDecision,
  AiRiskLevel,
} from '@watchdog-bms/contracts';

// Domain records (plain types, no framework/Prisma imports).

export type AiDraftRequestRecord = {
  id: string;
  companyId: string;
  requesterUserId: string;
  origin: AiDraftRequestOrigin;
  agent: AiSuggestionAgent;
  templateKey: string;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  sourceRefsJson: Record<string, unknown>;
  requestedPromptPreview?: string;
  requestedPromptHash?: string;
  language: string;
  status: AiDraftRequestStatus;
  idempotencyKey: string;
  workflowRunId?: string;
  suggestionId?: string;
  errorCode?: string;
  errorMessage?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AiSuggestionRecord = {
  /** Branch scope used to generate the retained content; absent for legacy artifacts. */
  sourceBranchIds?: string[] | null;
  id: string;
  companyId: string;
  draftRequestId: string;
  templateKey: string;
  agent: AiSuggestionAgent;
  domain: AiSuggestionDomain;
  title: string;
  summary: string;
  recommendation: string;
  riskLevel: AiRiskLevel;
  confidence: number;
  status: AiSuggestionStatus;
  needsDataReasonsJson: string[];
  blockedReasonsJson: string[];
  sourceStateHash?: string;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  candidateActionCount: number;
  reviewOwnerUserId?: string;
  assignedRole?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AiSuggestionCitationRecord = {
  id: string;
  suggestionId: string;
  companyId: string;
  sourceModule: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourceField?: string;
  label: string;
  valuePreview?: string;
  valueHash?: string;
  webDeepLink?: string;
  capturedAt: Date;
};

export type AiDraftArtifactRecord = {
  id: string;
  suggestionId: string;
  companyId: string;
  version: number;
  artifactType: AiDraftArtifactType;
  language: string;
  contentPreview?: string;
  contentHash?: string;
  structuredContentJson?: Record<string, unknown>;
  status: AiDraftArtifactStatus;
  modelProvider?: string;
  modelName?: string;
  modelVersion?: string;
  tokenUsageJson?: Record<string, unknown>;
  createdAt: Date;
};

export type AiCandidateActionRecord = {
  id: string;
  suggestionId: string;
  artifactId?: string;
  companyId: string;
  actionType: AiCandidateActionType;
  targetModule: string;
  targetRecordType?: string;
  targetRecordId?: string;
  draftPayloadJson: Record<string, unknown>;
  payloadHash?: string;
  requiredPermissions: string[];
  riskLevel: AiRiskLevel;
  idempotencyKey: string;
  status: AiCandidateActionStatus;
  validationResultJson?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type AiSuggestionReviewRecord = {
  id: string;
  suggestionId: string;
  candidateActionId?: string;
  companyId: string;
  reviewerUserId: string;
  decision: AiReviewDecision;
  note?: string;
  editedPayloadJson?: Record<string, unknown>;
  createdSourceModule?: string;
  createdSourceRecordType?: string;
  createdSourceRecordId?: string;
  sourceDraftDeepLink?: string;
  createdAt: Date;
};

export type AiToolInvocationLogRecord = {
  id: string;
  companyId: string;
  userId: string;
  requestId: string;
  suggestionId?: string;
  agent: AiSuggestionAgent;
  toolName: string;
  toolCategory: string;
  inputPreview?: string;
  inputHash?: string;
  outputPreview?: string;
  outputHash?: string;
  sourceRefsJson?: Record<string, unknown>;
  status: string;
  durationMs?: number;
  errorCode?: string;
  createdAt: Date;
};

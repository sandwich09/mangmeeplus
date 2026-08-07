import type {
  AiSuggestionSummary,
  AiSuggestionDetail,
  AiSuggestionCitation,
  AiDraftArtifact,
  AiCandidateAction,
  AiSuggestionReview,
  AiDraftRequestSummary,
  AiSuggestionTemplateSummary,
} from '@watchdog-bms/contracts';
import type {
  AiSuggestionRecord,
  AiSuggestionCitationRecord,
  AiDraftArtifactRecord,
  AiCandidateActionRecord,
  AiSuggestionReviewRecord,
  AiDraftRequestRecord,
} from '../../domain/models/ai-draft.model';
import type { AiSuggestionTemplateDef } from '../../domain/ai-draft-template-catalog';
import { computeTemplateAvailability } from '../../domain/ai-draft-template-catalog';

const iso = (d?: Date): string | undefined => (d ? d.toISOString() : undefined);

export function toSuggestionSummary(s: AiSuggestionRecord, citationCount: number): AiSuggestionSummary {
  return {
    id: s.id,
    agent: s.agent,
    domain: s.domain,
    title: s.title,
    summary: s.summary,
    riskLevel: s.riskLevel,
    confidence: s.confidence / 100,
    status: s.status,
    needsData: s.needsDataReasonsJson.length > 0,
    sourceModule: s.sourceModule,
    sourceRecordType: s.sourceRecordType,
    sourceRecordId: s.sourceRecordId,
    citationCount,
    candidateActionCount: s.candidateActionCount,
    reviewOwnerUserId: s.reviewOwnerUserId,
    assignedRole: s.assignedRole,
    expiresAt: iso(s.expiresAt),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toCitation(c: AiSuggestionCitationRecord): AiSuggestionCitation {
  return {
    id: c.id,
    sourceModule: c.sourceModule,
    sourceRecordType: c.sourceRecordType,
    sourceRecordId: c.sourceRecordId,
    sourceField: c.sourceField,
    label: c.label,
    valuePreview: c.valuePreview,
    webDeepLink: c.webDeepLink,
    capturedAt: c.capturedAt.toISOString(),
  };
}

export function toArtifact(a: AiDraftArtifactRecord): AiDraftArtifact {
  return {
    id: a.id,
    version: a.version,
    artifactType: a.artifactType,
    language: a.language,
    contentPreview: a.contentPreview,
    structuredContentJson: a.structuredContentJson,
    status: a.status,
    modelProvider: a.modelProvider,
    modelName: a.modelName,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toCandidateAction(a: AiCandidateActionRecord): AiCandidateAction {
  return {
    id: a.id,
    actionType: a.actionType,
    targetModule: a.targetModule,
    targetRecordType: a.targetRecordType,
    targetRecordId: a.targetRecordId,
    draftPayloadJson: a.draftPayloadJson,
    requiredPermissions: a.requiredPermissions,
    riskLevel: a.riskLevel,
    status: a.status,
    validationResultJson: a.validationResultJson,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toReview(r: AiSuggestionReviewRecord): AiSuggestionReview {
  return {
    id: r.id,
    candidateActionId: r.candidateActionId,
    reviewerUserId: r.reviewerUserId,
    decision: r.decision,
    note: r.note,
    createdSourceModule: r.createdSourceModule,
    createdSourceRecordType: r.createdSourceRecordType,
    createdSourceRecordId: r.createdSourceRecordId,
    sourceDraftDeepLink: r.sourceDraftDeepLink,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toSuggestionDetail(input: {
  suggestion: AiSuggestionRecord;
  citations: AiSuggestionCitationRecord[];
  artifacts: AiDraftArtifactRecord[];
  candidateActions: AiCandidateActionRecord[];
  reviews: AiSuggestionReviewRecord[];
  sourceStateChanged: boolean;
}): AiSuggestionDetail {
  const s = input.suggestion;
  return {
    ...toSuggestionSummary(s, input.citations.length),
    recommendation: s.recommendation,
    needsDataReasons: s.needsDataReasonsJson,
    blockedReasons: s.blockedReasonsJson,
    sourceStateHash: s.sourceStateHash,
    sourceStateChanged: input.sourceStateChanged,
    citations: input.citations.map(toCitation),
    artifacts: input.artifacts.map(toArtifact),
    candidateActions: input.candidateActions.map(toCandidateAction),
    reviews: input.reviews.map(toReview),
  };
}

export function toRequestSummary(r: AiDraftRequestRecord): AiDraftRequestSummary {
  return {
    id: r.id,
    origin: r.origin,
    agent: r.agent,
    templateKey: r.templateKey,
    status: r.status,
    sourceModule: r.sourceModule,
    sourceRecordType: r.sourceRecordType,
    sourceRecordId: r.sourceRecordId,
    suggestionId: r.suggestionId,
    expiresAt: iso(r.expiresAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toTemplateSummary(def: AiSuggestionTemplateDef): AiSuggestionTemplateSummary {
  const availability = computeTemplateAvailability(def);
  return {
    id: def.key,
    key: def.key,
    domain: def.domain,
    defaultAgent: def.defaultAgent,
    title: def.title,
    description: def.description,
    triggerModes: def.triggerModes,
    requiredSourceModules: def.requiredSourceModules,
    requiredPermissions: def.requiredPermissions,
    riskLevel: def.riskLevel,
    defaultTtlMinutes: def.defaultTtlMinutes,
    enabled: availability.status === 'AVAILABLE',
    status: availability.status,
    unavailableReason: availability.unavailableReason,
  };
}

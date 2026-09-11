import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  AiDraftRequestOrigin,
  AiDraftRequestStatus,
  AiSuggestionAgent,
  AiSuggestionDomain,
  AiSuggestionStatus,
  AiDraftArtifactType,
  AiCandidateActionType,
  AiCandidateActionStatus,
  AiReviewDecision,
  AiRiskLevel,
} from '@watchdog-bms/contracts';
import type {
  AiDraftRequestRecord,
  AiSuggestionRecord,
  AiSuggestionCitationRecord,
  AiDraftArtifactRecord,
  AiCandidateActionRecord,
  AiSuggestionReviewRecord,
} from '../domain/models/ai-draft.model';

function opt<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export type CreateRequestData = {
  companyId: string;
  requesterUserId: string;
  origin: AiDraftRequestOrigin;
  agent: AiSuggestionAgent;
  templateKey: string;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  sourceRefsJson?: Record<string, unknown>;
  requestedPromptPreview?: string;
  requestedPromptHash?: string;
  language: string;
  idempotencyKey: string;
  workflowRunId?: string;
  expiresAt?: Date;
};

export type PersistCitationInput = Omit<AiSuggestionCitationRecord, 'id' | 'suggestionId' | 'companyId' | 'capturedAt'>;

export type PersistCandidateActionInput = {
  actionType: AiCandidateActionType;
  targetModule: string;
  targetRecordType?: string;
  targetRecordId?: string;
  draftPayloadJson: Record<string, unknown>;
  payloadHash?: string;
  requiredPermissions: string[];
  riskLevel: AiRiskLevel;
  idempotencyKey: string;
};

export type PersistSuggestionInput = {
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
  needsDataReasons: string[];
  blockedReasons: string[];
  sourceStateHash?: string;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  reviewOwnerUserId?: string;
  assignedRole?: string;
  expiresAt?: Date;
  artifact: {
    artifactType: AiDraftArtifactType;
    language: string;
    contentPreview?: string;
    contentHash?: string;
    structuredContentJson?: Record<string, unknown>;
    modelProvider?: string;
    modelName?: string;
  };
  citations: PersistCitationInput[];
  candidateActions: PersistCandidateActionInput[];
};

@Injectable()
export class PrismaAiDraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Requests ----

  async createRequest(data: CreateRequestData): Promise<AiDraftRequestRecord> {
    const row = await this.prisma.client.aiDraftRequest.create({
      data: {
        companyId: data.companyId,
        requesterUserId: data.requesterUserId,
        origin: data.origin,
        agent: data.agent,
        templateKey: data.templateKey,
        sourceModule: data.sourceModule,
        sourceRecordType: data.sourceRecordType,
        sourceRecordId: data.sourceRecordId,
        sourceRefsJson: (data.sourceRefsJson ?? {}) as object,
        requestedPromptPreview: data.requestedPromptPreview,
        requestedPromptHash: data.requestedPromptHash,
        language: data.language,
        idempotencyKey: data.idempotencyKey,
        workflowRunId: data.workflowRunId,
        expiresAt: data.expiresAt,
      },
      include: { suggestion: { select: { id: true } } },
    });
    return this.toRequest(row);
  }

  async findRequestById(companyId: string, id: string): Promise<AiDraftRequestRecord | null> {
    const row = await this.prisma.client.aiDraftRequest.findFirst({
      where: { id, companyId },
      include: { suggestion: { select: { id: true } } },
    });
    return row ? this.toRequest(row) : null;
  }

  async findRequestByIdempotencyKey(companyId: string, idempotencyKey: string): Promise<AiDraftRequestRecord | null> {
    const row = await this.prisma.client.aiDraftRequest.findFirst({
      where: { companyId, idempotencyKey },
      include: { suggestion: { select: { id: true } } },
    });
    return row ? this.toRequest(row) : null;
  }

  async updateRequestStatus(
    id: string,
    status: AiDraftRequestStatus,
    extra: { errorCode?: string; errorMessage?: string } = {},
  ): Promise<void> {
    await this.prisma.client.aiDraftRequest.update({
      where: { id },
      data: { status, errorCode: extra.errorCode ?? null, errorMessage: extra.errorMessage ?? null },
    });
  }

  async listQueuedRequestIds(limit: number): Promise<Array<{ id: string; companyId: string }>> {
    const rows = await this.prisma.client.aiDraftRequest.findMany({
      where: { status: 'QUEUED' },
      select: { id: true, companyId: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows;
  }

  // ---- Suggestions ----

  // Persist a whole generated suggestion (suggestion + artifact + citations + actions)
  // and flip the request to its terminal generation status, atomically.
  async persistGeneratedSuggestion(
    requestId: string,
    requestStatus: AiDraftRequestStatus,
    input: PersistSuggestionInput,
  ): Promise<AiSuggestionRecord> {
    const suggestion = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.aiSuggestion.create({
        data: {
          companyId: input.companyId,
          draftRequestId: input.draftRequestId,
          templateKey: input.templateKey,
          agent: input.agent,
          domain: input.domain,
          title: input.title,
          summary: input.summary,
          recommendation: input.recommendation,
          riskLevel: input.riskLevel,
          confidence: input.confidence,
          status: input.status,
          needsDataReasonsJson: input.needsDataReasons as object,
          blockedReasonsJson: input.blockedReasons as object,
          sourceStateHash: input.sourceStateHash,
          sourceModule: input.sourceModule,
          sourceRecordType: input.sourceRecordType,
          sourceRecordId: input.sourceRecordId,
          candidateActionCount: input.candidateActions.length,
          reviewOwnerUserId: input.reviewOwnerUserId,
          assignedRole: input.assignedRole,
          expiresAt: input.expiresAt,
        },
      });
      const artifact = await tx.aiDraftArtifact.create({
        data: {
          suggestionId: created.id,
          companyId: input.companyId,
          version: 1,
          artifactType: input.artifact.artifactType,
          language: input.artifact.language,
          contentPreview: input.artifact.contentPreview,
          contentHash: input.artifact.contentHash,
          structuredContentJson: (input.artifact.structuredContentJson ?? {}) as object,
          status: 'LOCKED_FOR_REVIEW',
          modelProvider: input.artifact.modelProvider,
          modelName: input.artifact.modelName,
        },
      });
      if (input.citations.length > 0) {
        await tx.aiSuggestionCitation.createMany({
          data: input.citations.map((c) => ({
            suggestionId: created.id,
            companyId: input.companyId,
            sourceModule: c.sourceModule,
            sourceRecordType: c.sourceRecordType,
            sourceRecordId: c.sourceRecordId,
            sourceField: c.sourceField,
            label: c.label,
            valuePreview: c.valuePreview,
            valueHash: c.valueHash,
            webDeepLink: c.webDeepLink,
          })),
        });
      }
      for (const a of input.candidateActions) {
        await tx.aiCandidateAction.create({
          data: {
            suggestionId: created.id,
            artifactId: artifact.id,
            companyId: input.companyId,
            actionType: a.actionType,
            targetModule: a.targetModule,
            targetRecordType: a.targetRecordType,
            targetRecordId: a.targetRecordId,
            draftPayloadJson: a.draftPayloadJson as object,
            payloadHash: a.payloadHash,
            requiredPermissions: a.requiredPermissions as object,
            riskLevel: a.riskLevel,
            idempotencyKey: a.idempotencyKey,
          },
        });
      }
      await tx.aiDraftRequest.update({ where: { id: requestId }, data: { status: requestStatus } });
      return created;
    });
    return this.toSuggestion(suggestion);
  }

  async findSuggestionById(companyId: string, id: string): Promise<{
    suggestion: AiSuggestionRecord;
    citations: AiSuggestionCitationRecord[];
    artifacts: AiDraftArtifactRecord[];
    candidateActions: AiCandidateActionRecord[];
    reviews: AiSuggestionReviewRecord[];
  } | null> {
    const row = await this.prisma.client.aiSuggestion.findFirst({
      where: { id, companyId },
      include: {
        citations: { orderBy: { capturedAt: 'asc' } },
        artifacts: { orderBy: { version: 'desc' } },
        candidateActions: { orderBy: { createdAt: 'asc' } },
        reviews: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) return null;
    return {
      suggestion: this.toSuggestion(row),
      citations: row.citations.map((c) => this.toCitation(c)),
      artifacts: row.artifacts.map((a) => this.toArtifact(a)),
      candidateActions: row.candidateActions.map((a) => this.toCandidateAction(a)),
      reviews: row.reviews.map((r) => this.toReview(r)),
    };
  }

  async findSuggestionByRequestId(companyId: string, requestId: string): Promise<AiSuggestionRecord | null> {
    const row = await this.prisma.client.aiSuggestion.findFirst({ where: { companyId, draftRequestId: requestId } });
    return row ? this.toSuggestion(row) : null;
  }

  async listSuggestions(where: {
    companyId: string;
    reviewOwnerUserId?: string;
    status?: AiSuggestionStatus;
    domain?: AiSuggestionDomain;
    agent?: AiSuggestionAgent;
    riskLevel?: AiRiskLevel;
    sourceModule?: string;
  }): Promise<Array<AiSuggestionRecord & { citationCountActual: number }>> {
    const rows = await this.prisma.client.aiSuggestion.findMany({
      where: {
        companyId: where.companyId,
        reviewOwnerUserId: where.reviewOwnerUserId,
        status: where.status,
        domain: where.domain,
        agent: where.agent,
        riskLevel: where.riskLevel,
        sourceModule: where.sourceModule,
      },
      include: { _count: { select: { citations: true } }, artifacts: { orderBy: { version: 'desc' }, take: 1, select: { structuredContentJson: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.toSuggestion(r), citationCountActual: r._count.citations }));
  }

  async updateSuggestionStatus(
    companyId: string,
    id: string,
    status: AiSuggestionStatus,
    extra: { reviewOwnerUserId?: string; blockedReasons?: string[] } = {},
  ): Promise<AiSuggestionRecord> {
    const data: Record<string, unknown> = { status };
    if (extra.reviewOwnerUserId !== undefined) data.reviewOwnerUserId = extra.reviewOwnerUserId;
    if (extra.blockedReasons !== undefined) data.blockedReasonsJson = extra.blockedReasons;
    const row = await this.prisma.client.aiSuggestion.update({ where: { id }, data });
    return this.toSuggestion(row);
  }

  // ---- Candidate actions ----

  async findCandidateActionById(companyId: string, id: string): Promise<AiCandidateActionRecord | null> {
    const row = await this.prisma.client.aiCandidateAction.findFirst({ where: { id, companyId } });
    return row ? this.toCandidateAction(row) : null;
  }

  async updateCandidateAction(
    id: string,
    data: { status?: AiCandidateActionStatus; validationResultJson?: Record<string, unknown> },
  ): Promise<AiCandidateActionRecord> {
    const row = await this.prisma.client.aiCandidateAction.update({
      where: { id },
      data: {
        status: data.status,
        validationResultJson: data.validationResultJson === undefined ? undefined : (data.validationResultJson as object),
      },
    });
    return this.toCandidateAction(row);
  }

  // ---- Reviews ----

  async createReview(data: {
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
  }): Promise<AiSuggestionReviewRecord> {
    const row = await this.prisma.client.aiSuggestionReview.create({
      data: {
        suggestionId: data.suggestionId,
        candidateActionId: data.candidateActionId,
        companyId: data.companyId,
        reviewerUserId: data.reviewerUserId,
        decision: data.decision,
        note: data.note,
        editedPayloadJson: data.editedPayloadJson === undefined ? undefined : (data.editedPayloadJson as object),
        createdSourceModule: data.createdSourceModule,
        createdSourceRecordType: data.createdSourceRecordType,
        createdSourceRecordId: data.createdSourceRecordId,
        sourceDraftDeepLink: data.sourceDraftDeepLink,
      },
    });
    return this.toReview(row);
  }

  // ---- Tool invocation log ----

  async createToolLog(data: {
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
  }): Promise<void> {
    await this.prisma.client.aiToolInvocationLog.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        requestId: data.requestId,
        suggestionId: data.suggestionId,
        agent: data.agent,
        toolName: data.toolName,
        toolCategory: data.toolCategory,
        inputPreview: data.inputPreview,
        inputHash: data.inputHash,
        outputPreview: data.outputPreview,
        outputHash: data.outputHash,
        sourceRefsJson: data.sourceRefsJson === undefined ? undefined : (data.sourceRefsJson as object),
        status: data.status,
        durationMs: data.durationMs,
        errorCode: data.errorCode,
      },
    });
  }

  async listToolLogs(companyId: string, suggestionId: string): Promise<Array<{ toolName: string; toolCategory: string; status: string; createdAt: string }>> {
    const rows = await this.prisma.client.aiToolInvocationLog.findMany({
      where: { companyId, suggestionId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((r) => ({ toolName: r.toolName, toolCategory: r.toolCategory, status: r.status, createdAt: r.createdAt.toISOString() }));
  }

  // ---- Mappers ----

  private toRequest(row: {
    id: string; companyId: string; requesterUserId: string; origin: string; agent: string; templateKey: string;
    sourceModule: string | null; sourceRecordType: string | null; sourceRecordId: string | null; sourceRefsJson: unknown;
    requestedPromptPreview: string | null; requestedPromptHash: string | null; language: string; status: string;
    idempotencyKey: string; workflowRunId: string | null; errorCode: string | null; errorMessage: string | null;
    expiresAt: Date | null; createdAt: Date; updatedAt: Date; suggestion?: { id: string } | null;
  }): AiDraftRequestRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      requesterUserId: row.requesterUserId,
      origin: row.origin as AiDraftRequestOrigin,
      agent: row.agent as AiSuggestionAgent,
      templateKey: row.templateKey,
      sourceModule: opt(row.sourceModule),
      sourceRecordType: opt(row.sourceRecordType),
      sourceRecordId: opt(row.sourceRecordId),
      sourceRefsJson: asObject(row.sourceRefsJson),
      requestedPromptPreview: opt(row.requestedPromptPreview),
      requestedPromptHash: opt(row.requestedPromptHash),
      language: row.language,
      status: row.status as AiDraftRequestStatus,
      idempotencyKey: row.idempotencyKey,
      workflowRunId: opt(row.workflowRunId),
      suggestionId: row.suggestion?.id,
      errorCode: opt(row.errorCode),
      errorMessage: opt(row.errorMessage),
      expiresAt: opt(row.expiresAt),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toSuggestion(row: {
    artifacts?: Array<{ structuredContentJson: unknown }>;
    id: string; companyId: string; draftRequestId: string; templateKey: string; agent: string; domain: string;
    title: string; summary: string; recommendation: string; riskLevel: string; confidence: number; status: string;
    needsDataReasonsJson: unknown; blockedReasonsJson: unknown; sourceStateHash: string | null;
    sourceModule: string | null; sourceRecordType: string | null; sourceRecordId: string | null;
    candidateActionCount: number; reviewOwnerUserId: string | null; assignedRole: string | null;
    expiresAt: Date | null; createdAt: Date; updatedAt: Date;
  }): AiSuggestionRecord {
    return {
      sourceBranchIds: asObject(row.artifacts?.[0]?.structuredContentJson)['sourceBranchIds'] as string[] | null | undefined,
      id: row.id,
      companyId: row.companyId,
      draftRequestId: row.draftRequestId,
      templateKey: row.templateKey,
      agent: row.agent as AiSuggestionAgent,
      domain: row.domain as AiSuggestionDomain,
      title: row.title,
      summary: row.summary,
      recommendation: row.recommendation,
      riskLevel: row.riskLevel as AiRiskLevel,
      confidence: row.confidence,
      status: row.status as AiSuggestionStatus,
      needsDataReasonsJson: asStringArray(row.needsDataReasonsJson),
      blockedReasonsJson: asStringArray(row.blockedReasonsJson),
      sourceStateHash: opt(row.sourceStateHash),
      sourceModule: opt(row.sourceModule),
      sourceRecordType: opt(row.sourceRecordType),
      sourceRecordId: opt(row.sourceRecordId),
      candidateActionCount: row.candidateActionCount,
      reviewOwnerUserId: opt(row.reviewOwnerUserId),
      assignedRole: opt(row.assignedRole),
      expiresAt: opt(row.expiresAt),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toCitation(row: {
    id: string; suggestionId: string; companyId: string; sourceModule: string; sourceRecordType: string;
    sourceRecordId: string; sourceField: string | null; label: string; valuePreview: string | null;
    valueHash: string | null; webDeepLink: string | null; capturedAt: Date;
  }): AiSuggestionCitationRecord {
    return {
      id: row.id,
      suggestionId: row.suggestionId,
      companyId: row.companyId,
      sourceModule: row.sourceModule,
      sourceRecordType: row.sourceRecordType,
      sourceRecordId: row.sourceRecordId,
      sourceField: opt(row.sourceField),
      label: row.label,
      valuePreview: opt(row.valuePreview),
      valueHash: opt(row.valueHash),
      webDeepLink: opt(row.webDeepLink),
      capturedAt: row.capturedAt,
    };
  }

  private toArtifact(row: {
    id: string; suggestionId: string; companyId: string; version: number; artifactType: string; language: string;
    contentPreview: string | null; contentHash: string | null; structuredContentJson: unknown; status: string;
    modelProvider: string | null; modelName: string | null; modelVersion: string | null; tokenUsageJson: unknown; createdAt: Date;
  }): AiDraftArtifactRecord {
    return {
      id: row.id,
      suggestionId: row.suggestionId,
      companyId: row.companyId,
      version: row.version,
      artifactType: row.artifactType as AiDraftArtifactType,
      language: row.language,
      contentPreview: opt(row.contentPreview),
      contentHash: opt(row.contentHash),
      structuredContentJson: row.structuredContentJson ? asObject(row.structuredContentJson) : undefined,
      status: row.status as AiDraftArtifactRecord['status'],
      modelProvider: opt(row.modelProvider),
      modelName: opt(row.modelName),
      modelVersion: opt(row.modelVersion),
      tokenUsageJson: row.tokenUsageJson ? asObject(row.tokenUsageJson) : undefined,
      createdAt: row.createdAt,
    };
  }

  private toCandidateAction(row: {
    id: string; suggestionId: string; artifactId: string | null; companyId: string; actionType: string;
    targetModule: string; targetRecordType: string | null; targetRecordId: string | null; draftPayloadJson: unknown;
    payloadHash: string | null; requiredPermissions: unknown; riskLevel: string; idempotencyKey: string;
    status: string; validationResultJson: unknown; createdAt: Date; updatedAt: Date;
  }): AiCandidateActionRecord {
    return {
      id: row.id,
      suggestionId: row.suggestionId,
      artifactId: opt(row.artifactId),
      companyId: row.companyId,
      actionType: row.actionType as AiCandidateActionType,
      targetModule: row.targetModule,
      targetRecordType: opt(row.targetRecordType),
      targetRecordId: opt(row.targetRecordId),
      draftPayloadJson: asObject(row.draftPayloadJson),
      payloadHash: opt(row.payloadHash),
      requiredPermissions: asStringArray(row.requiredPermissions),
      riskLevel: row.riskLevel as AiRiskLevel,
      idempotencyKey: row.idempotencyKey,
      status: row.status as AiCandidateActionStatus,
      validationResultJson: row.validationResultJson ? asObject(row.validationResultJson) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toReview(row: {
    id: string; suggestionId: string; candidateActionId: string | null; companyId: string; reviewerUserId: string;
    decision: string; note: string | null; editedPayloadJson: unknown; createdSourceModule: string | null;
    createdSourceRecordType: string | null; createdSourceRecordId: string | null; sourceDraftDeepLink: string | null; createdAt: Date;
  }): AiSuggestionReviewRecord {
    return {
      id: row.id,
      suggestionId: row.suggestionId,
      candidateActionId: opt(row.candidateActionId),
      companyId: row.companyId,
      reviewerUserId: row.reviewerUserId,
      decision: row.decision as AiReviewDecision,
      note: opt(row.note),
      editedPayloadJson: row.editedPayloadJson ? asObject(row.editedPayloadJson) : undefined,
      createdSourceModule: opt(row.createdSourceModule),
      createdSourceRecordType: opt(row.createdSourceRecordType),
      createdSourceRecordId: opt(row.createdSourceRecordId),
      sourceDraftDeepLink: opt(row.sourceDraftDeepLink),
      createdAt: row.createdAt,
    };
  }
}

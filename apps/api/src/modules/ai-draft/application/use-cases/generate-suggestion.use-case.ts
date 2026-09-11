import { Inject, Injectable, Logger, Optional, ForbiddenException } from '@nestjs/common';
import type { RequestContext, AiDraftGenerationResult, AiRiskLevel, AiSuggestionAgent } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { RedisRateLimitService } from '../../../../common/security/redis-rate-limit.service';
import { recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../../line-ai/application/company-ai-usage-meter';
import { PrismaAiDraftRepository } from '../../infrastructure/prisma-ai-draft.repository';
import type { PersistCandidateActionInput } from '../../infrastructure/prisma-ai-draft.repository';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { AuditService } from '../../../audit/application/audit.service';
import { SuggestionGeneratorService } from '../generators/suggestion-generator.service';
import type { EvidencePack } from '../generators/suggestion-generator.service';
import { LLM_DRAFT_PORT } from '../../infrastructure/provider/llm-draft.port';
import type { LlmDraftPort } from '../../infrastructure/provider/llm-draft.port';
import { evaluateCitationRequirement, assertSafeCandidateAction, defaultRiskForAction } from '../../domain/logic/ai-draft-safety.logic';
import { canRequestSuggestions, requiredSourcePermissionsForAction } from '../../domain/logic/ai-draft-permission.logic';
import {
  buildSourceStateHash,
  buildCandidateActionIdempotencyKey,
  previewText,
  hashText,
} from '../../domain/logic/ai-draft-idempotency.logic';

import { canAccessTemplateSources } from '../../domain/ai-draft-template-catalog';

export type GenerateResult = {
  requestId: string;
  status: string;
  suggestionId?: string;
};

const ALLOWED_RISK = new Set<AiRiskLevel>(['LOW', 'MEDIUM', 'HIGH']);

@Injectable()
export class GenerateSuggestionUseCase {
  private readonly logger = new Logger(GenerateSuggestionUseCase.name);

  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly resolver: PermissionResolverService,
    private readonly generator: SuggestionGeneratorService,
    private readonly audit: AuditService,
    @Inject(LLM_DRAFT_PORT) private readonly provider: LlmDraftPort,
    // Metering only. AiDraftGenerationRequest carries no tenant, so the draft lane is
    // attributed here — the one seam holding both the companyId and the usage-bearing result.
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: AppConfigService,
    @Optional() private readonly rateLimits?: RedisRateLimitService,
  ) {}

  async execute(companyId: string, requestId: string): Promise<GenerateResult> {
    const request = await this.repo.findRequestById(companyId, requestId);
    if (!request) return { requestId, status: 'NOT_FOUND' };

    // Job idempotency: a request that already produced a suggestion is not regenerated.
    const existingSuggestion = await this.repo.findSuggestionByRequestId(companyId, requestId);
    if (existingSuggestion) return { requestId, status: request.status, suggestionId: existingSuggestion.id };

    if (!['QUEUED', 'NEEDS_DATA', 'PROVIDER_UNAVAILABLE', 'FAILED'].includes(request.status)) {
      return { requestId, status: request.status };
    }

    await this.repo.updateRequestStatus(request.id, 'GENERATING');

    try {
      // Reconstruct the requester's permission context so source reads are re-checked.
      const access = await this.resolver.resolveAccess(request.requesterUserId, companyId);
      const ctx: RequestContext = {
        requestId: `ai-generate:${request.id}`,
        authSubject: request.requesterUserId,
        userId: request.requesterUserId,
        companyId,
        membershipId: access.membershipId,
        roles: access.roles,
        permissions: access.permissions,
        scopes: access.scopes,
        authProvider: 'watchdog',
      };

      if (!canRequestSuggestions(ctx.permissions) || !canAccessTemplateSources(request.templateKey, ctx.permissions)) {
        throw new ForbiddenException('Missing current AI or source permission');
      }
      const evidence = await this.generator.collectEvidence(request.templateKey, ctx, request);

      // Not enough source evidence: persist a visible needs-data record; no model call.
      if (evidence.needsDataReasons.length > 0) {
        return await this.persistNeedsData(companyId, request, ctx, evidence);
      }

      // AI-authored generation only: if no provider is available, stay provider-unavailable.
      if (!this.provider.available) {
        await this.repo.updateRequestStatus(request.id, 'PROVIDER_UNAVAILABLE', {
          errorCode: 'PROVIDER_DISABLED',
          errorMessage: 'AI draft provider is not configured; suggestion not generated.',
        });
        await this.logTool(ctx, request.id, request.agent, undefined, 'draft_generate', 'provider_unavailable', 'PROVIDER_DISABLED');
        return { requestId, status: 'PROVIDER_UNAVAILABLE' };
      }

      const generateAndMeter = async (budgetMonthKey?: string): Promise<AiDraftGenerationResult> => {
        const generated = await this.provider.generate({
          templateKey: request.templateKey,
          language: request.language,
          agent: evidence.agent,
          domain: evidence.domain,
          defaultTitle: evidence.defaultTitle,
          facts: evidence.facts,
          citations: evidence.citations.map((c) => ({ label: c.label, valuePreview: c.valuePreview })),
          wantsChecklist: evidence.wantsChecklist,
        });
        // Keep the admission lease through the ledger write so the next action reads this cost.
        if (this.prisma && this.config) {
          try {
            await recordCompanyAiUsage(
              this.prisma,
              this.config,
              { companyId, sourceRoute: 'draft-generate', requestId: request.id, monthKey: budgetMonthKey },
              generated.usage,
            );
          } catch (err) {
            this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.id, error: (err as Error).message });
          }
        }
        return generated;
      };

      const admission = this.prisma && this.config
        ? await runWithCompanyAiBudgetAdmission(this.prisma, this.config, this.rateLimits, companyId, generateAndMeter)
        : ({ allowed: true, value: await generateAndMeter() } as const);

      // A real exhaustion is terminal. Admission contention is transient and stays in the
      // provider-unavailable retry lane; no model ran and no spend occurred for the refused job.
      const result: AiDraftGenerationResult = admission.allowed
        ? admission.value
        : {
          ok: false,
          error: admission.reason === 'exceeded'
            ? { code: 'AI_MONTHLY_BUDGET_EXCEEDED', message: 'Monthly AI budget exhausted for this company.', retryable: false }
            : admission.reason === 'busy'
              ? { code: 'AI_BUDGET_BUSY', message: 'Another AI action is being metered for this company.', retryable: true }
              : { code: 'AI_BUDGET_UNAVAILABLE', message: 'AI budget meter is unavailable.', retryable: false },
        };

      if (!result.ok) {
        // Provider disabled/unreachable/transient -> provider-unavailable (retryable);
        // parse/validation errors -> failed.
        const providerDown = result.error.retryable || ['PROVIDER_DISABLED', 'GATEWAY_UNREACHABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_THROTTLED', 'NO_EVIDENCE'].includes(result.error.code);
        const status = providerDown ? 'PROVIDER_UNAVAILABLE' : 'FAILED';
        await this.repo.updateRequestStatus(request.id, status, { errorCode: result.error.code, errorMessage: result.error.message });
        await this.logTool(ctx, request.id, request.agent, undefined, 'draft_generate', status.toLowerCase(), result.error.code);
        return { requestId, status };
      }

      // Assemble: model authors title/summary/recommendation/risk/confidence; the API keeps
      // grounded citations and the allowlisted, id-fixed candidate action.
      const title = (result.title ?? '').trim() || evidence.defaultTitle;
      const summary = result.summary.trim();
      let recommendation = result.recommendation.trim();
      const riskLevel: AiRiskLevel = result.riskLevel && ALLOWED_RISK.has(result.riskLevel) ? result.riskLevel : 'MEDIUM';
      const confidence = result.confidence != null ? Math.round(Math.max(0, Math.min(1, result.confidence)) * 100) : 50;

      const action = { ...evidence.candidateAction, draftPayloadJson: { ...evidence.candidateAction.draftPayloadJson } };
      if (action.actionType === 'CREATE_CRM_FOLLOW_UP_DRAFT') {
        action.draftPayloadJson['title'] = (result.actionTitle ?? '').trim() || title;
      } else if (action.actionType === 'CREATE_REVIEW_CHECKLIST') {
        action.draftPayloadJson['title'] = (result.actionTitle ?? '').trim() || (action.draftPayloadJson['title'] as string) || title;
        if (result.checklistItems && result.checklistItems.length > 0) action.draftPayloadJson['items'] = result.checklistItems;
      }

      const needsDataReasons: string[] = [];
      const citationCheck = evaluateCitationRequirement({ hasRecommendation: recommendation !== '', citationCount: evidence.citations.length });
      if (!citationCheck.ok) {
        needsDataReasons.push(citationCheck.reason!);
        recommendation = ''; // an uncited recommendation cannot stand
      }
      const requestStatus = needsDataReasons.length > 0 ? 'NEEDS_DATA' : 'READY';
      const sourceStateHash = evidence.sourceStateParts.length > 0 ? buildSourceStateHash(evidence.sourceStateParts) : undefined;

      assertSafeCandidateAction(action);
      const candidateActions: PersistCandidateActionInput[] = [{
        actionType: action.actionType,
        targetModule: action.targetModule,
        targetRecordType: action.targetRecordType,
        targetRecordId: action.targetRecordId,
        draftPayloadJson: action.draftPayloadJson,
        payloadHash: hashText(JSON.stringify(action.draftPayloadJson)),
        requiredPermissions: requiredSourcePermissionsForAction(action.actionType),
        riskLevel: action.riskLevel ?? defaultRiskForAction(action.actionType),
        idempotencyKey: buildCandidateActionIdempotencyKey(`${request.id}:0`, action.actionType, action.targetRecordId),
      }];

      const suggestion = await this.repo.persistGeneratedSuggestion(request.id, requestStatus, {
        companyId,
        draftRequestId: request.id,
        templateKey: request.templateKey,
        agent: evidence.agent,
        domain: evidence.domain,
        title,
        summary: summary || title,
        recommendation,
        riskLevel,
        confidence,
        status: 'NEW',
        needsDataReasons,
        blockedReasons: [],
        sourceStateHash,
        sourceModule: evidence.sourceModule,
        sourceRecordType: evidence.sourceRecordType,
        sourceRecordId: evidence.sourceRecordId,
        reviewOwnerUserId: request.requesterUserId,
        assignedRole: evidence.agent,
        expiresAt: request.expiresAt,
        artifact: {
          artifactType: evidence.artifactType,
          language: request.language,
          contentPreview: previewText(recommendation || summary),
          contentHash: hashText(recommendation || summary),
          structuredContentJson: { sourceBranchIds: ctx.scopes?.branchIds ?? null, facts: evidence.facts, checklistItems: result.checklistItems },
          modelProvider: result.provider,
          modelName: result.model,
        },
        citations: evidence.citations.map((c) => ({
          sourceModule: c.sourceModule,
          sourceRecordType: c.sourceRecordType,
          sourceRecordId: c.sourceRecordId,
          sourceField: c.sourceField,
          label: c.label,
          valuePreview: previewText(c.valuePreview),
          valueHash: c.valuePreview ? hashText(c.valuePreview) : undefined,
          webDeepLink: c.webDeepLink,
        })),
        candidateActions,
      });

      await this.logTool(ctx, request.id, request.agent, suggestion.id, 'read_evidence_pack', 'ok');
      await this.logTool(ctx, request.id, request.agent, suggestion.id, 'draft_generate', requestStatus === 'READY' ? 'ok' : 'needs_data');
      void this.audit.log({
        companyId, actorUserId: request.requesterUserId, action: 'ai.suggestion.generate',
        targetType: 'ai_suggestion', targetId: suggestion.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM',
        metadataJson: { templateKey: request.templateKey, status: requestStatus, provider: result.provider, citations: evidence.citations.length },
      });
      return { requestId, status: requestStatus, suggestionId: suggestion.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateRequestStatus(request.id, 'FAILED', { errorCode: 'GENERATION_FAILED', errorMessage: message });
      void this.audit.log({
        companyId, actorUserId: request.requesterUserId, action: 'ai.suggestion.generate',
        targetType: 'ai_draft_request', targetId: request.id, requestId: `ai-generate:${request.id}`,
        result: 'FAILED', riskLevel: 'MEDIUM', metadataJson: { error: message },
      });
      return { requestId, status: 'FAILED' };
    }
  }

  // Persist a visible "needs data" suggestion without calling the model.
  private async persistNeedsData(companyId: string, request: { id: string; templateKey: string; language: string; requesterUserId: string; agent: AiSuggestionAgent; expiresAt?: Date }, ctx: RequestContext, evidence: EvidencePack): Promise<GenerateResult> {
    const suggestion = await this.repo.persistGeneratedSuggestion(request.id, 'NEEDS_DATA', {
      companyId,
      draftRequestId: request.id,
      templateKey: request.templateKey,
      agent: evidence.agent,
      domain: evidence.domain,
      title: evidence.defaultTitle,
      summary: evidence.needsDataReasons.join('; '),
      recommendation: '',
      riskLevel: 'LOW',
      confidence: 0,
      status: 'NEW',
      needsDataReasons: evidence.needsDataReasons,
      blockedReasons: [],
      sourceModule: evidence.sourceModule,
      sourceRecordType: evidence.sourceRecordType,
      sourceRecordId: evidence.sourceRecordId,
      reviewOwnerUserId: request.requesterUserId,
      assignedRole: evidence.agent,
      expiresAt: request.expiresAt,
      artifact: { artifactType: 'CHECKLIST', language: request.language, structuredContentJson: { sourceBranchIds: ctx.scopes?.branchIds ?? null, needsData: evidence.needsDataReasons } },
      citations: [],
      candidateActions: [{
        actionType: 'NO_SOURCE_DRAFT_AVAILABLE',
        targetModule: 'ai-draft',
        draftPayloadJson: {},
        requiredPermissions: [],
        riskLevel: 'LOW',
        idempotencyKey: buildCandidateActionIdempotencyKey(`${request.id}:0`, 'NO_SOURCE_DRAFT_AVAILABLE'),
      }],
    });
    await this.logTool(ctx, request.id, request.agent, suggestion.id, 'read_evidence_pack', 'needs_data');
    return { requestId: request.id, status: 'NEEDS_DATA', suggestionId: suggestion.id };
  }

  private async logTool(ctx: RequestContext, requestId: string, agent: AiSuggestionAgent, suggestionId: string | undefined, category: string, status: string, errorCode?: string): Promise<void> {
    await this.repo.createToolLog({
      companyId: ctx.companyId, userId: ctx.userId, requestId, suggestionId, agent,
      toolName: `ai.${category}`, toolCategory: category, status, errorCode,
    });
  }
}

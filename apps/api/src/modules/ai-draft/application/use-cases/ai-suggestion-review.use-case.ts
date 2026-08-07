import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import type {
  RequestContext,
  AiCandidateAction,
  AiSuggestionReview,
  ReviewAiSuggestionDto,
  CreateSourceDraftDto,
} from '@watchdog-bms/contracts';
import { AI_PERMISSION_KEYS } from '@watchdog-bms/contracts';
import { PrismaAiDraftRepository } from '../../infrastructure/prisma-ai-draft.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { SourceStateService } from '../source-state.service';
import { SourceDraftAdapterService } from '../adapters/source-draft-adapter.service';
import { CreateDraftRequestUseCase } from './create-draft-request.use-case';
import {
  canReviewSuggestions,
  canValidateCandidateAction,
  evaluateCanCreateSourceDraft,
} from '../../domain/logic/ai-draft-permission.logic';
import {
  AI_SOURCE_DRAFT_UNAVAILABLE_ERROR,
  AI_SUGGESTION_NEEDS_DATA_ERROR,
  assertSafeCandidateAction,
} from '../../domain/logic/ai-draft-safety.logic';
import { isSuggestionActionable, isSuggestionExpired } from '../../domain/logic/ai-draft-status.logic';
import { toCandidateAction, toReview } from '../dto/ai-draft.mapper';
import type { AiCandidateActionRecord, AiSuggestionRecord } from '../../domain/models/ai-draft.model';

type ValidationResult = { ok: boolean; errors: string[]; warnings: string[]; editableFields: string[] };

function assertSuggestionHasDraftableEvidence(suggestion: AiSuggestionRecord, action: AiCandidateActionRecord): void {
  if (suggestion.needsDataReasonsJson.length > 0) {
    throw new UnprocessableEntityException(AI_SUGGESTION_NEEDS_DATA_ERROR);
  }
  if (action.actionType === 'NO_SOURCE_DRAFT_AVAILABLE') {
    throw new UnprocessableEntityException(AI_SOURCE_DRAFT_UNAVAILABLE_ERROR);
  }
}

// Deterministic, source-shaped payload validation (a dry run; creates no record).
function validateActionPayload(action: AiCandidateActionRecord, editedPayload?: Record<string, unknown>): ValidationResult {
  const payload = { ...action.draftPayloadJson, ...(editedPayload ?? {}) };
  const errors: string[] = [];
  if (action.actionType === 'CREATE_CRM_FOLLOW_UP_DRAFT') {
    if (!payload['customerId']) errors.push('customerId is required');
    if (!payload['title'] || String(payload['title']).trim() === '') errors.push('title is required');
    if (!payload['dueAt']) errors.push('dueAt is required');
    return { ok: errors.length === 0, errors, warnings: [], editableFields: ['title', 'dueAt', 'channel', 'priority'] };
  }
  // Self-owned checklist actions are always valid.
  return { ok: true, errors: [], warnings: [], editableFields: ['title'] };
}

@Injectable()
export class ValidateCandidateActionUseCase {
  constructor(private readonly repo: PrismaAiDraftRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, suggestionId: string, actionId: string): Promise<AiCandidateAction> {
    if (!canReviewSuggestions(ctx.permissions)) throw new ForbiddenException('Missing permission: ai.draft.review');
    const found = await this.repo.findSuggestionById(ctx.companyId, suggestionId);
    if (!found) throw new NotFoundException('Suggestion not found');
    const action = found.candidateActions.find((candidate) => candidate.id === actionId);
    if (!action) throw new NotFoundException('Candidate action not found');
    assertSuggestionHasDraftableEvidence(found.suggestion, action);
    assertSafeCandidateAction(action);
    if (!canValidateCandidateAction(ctx.permissions, action.actionType)) {
      throw new ForbiddenException(`Missing source permission to validate ${action.actionType}`);
    }
    const result = validateActionPayload(action);
    const updated = await this.repo.updateCandidateAction(action.id, {
      status: result.ok ? 'VALIDATED' : 'VALIDATION_FAILED',
      validationResultJson: result as unknown as Record<string, unknown>,
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ai.candidate_action.validate',
      targetType: 'ai_candidate_action', targetId: action.id, requestId: ctx.requestId,
      result: result.ok ? 'SUCCESS' : 'FAILED', riskLevel: 'LOW', metadataJson: { actionType: action.actionType },
    });
    return toCandidateAction(updated);
  }
}

@Injectable()
export class CreateSourceDraftUseCase {
  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly audit: AuditService,
    private readonly sourceState: SourceStateService,
    private readonly adapter: SourceDraftAdapterService,
  ) {}

  async execute(
    ctx: RequestContext,
    suggestionId: string,
    actionId: string,
    dto: CreateSourceDraftDto,
  ): Promise<{ review: AiSuggestionReview; status: string }> {
    // Web-only: LINE and other non-web surfaces can never create source drafts.
    if (ctx.authProvider === 'line') throw new ForbiddenException('Source draft creation is web-only');

    const found = await this.repo.findSuggestionById(ctx.companyId, suggestionId);
    if (!found) throw new NotFoundException('Suggestion not found');
    const suggestion = found.suggestion;
    const action = found.candidateActions.find((a) => a.id === actionId);
    if (!action) throw new NotFoundException('Candidate action not found');

    assertSuggestionHasDraftableEvidence(suggestion, action);
    assertSafeCandidateAction(action);
    if (!isSuggestionActionable(suggestion.status)) {
      throw new UnprocessableEntityException(`Suggestion is not actionable (status ${suggestion.status})`);
    }
    if (isSuggestionExpired(suggestion.expiresAt, new Date())) {
      await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'EXPIRED');
      throw new UnprocessableEntityException('Suggestion has expired');
    }
    if (action.status === 'SOURCE_DRAFT_CREATED') {
      throw new ConflictException('A source draft was already created for this action');
    }

    const permission = evaluateCanCreateSourceDraft(ctx.permissions, action.actionType);
    if (!permission.allowed) {
      throw new ForbiddenException(`Missing permission(s): ${permission.missing.join(', ')}`);
    }

    // Source-state guard: block unless the reviewer acknowledges a detected change.
    const changed = await this.sourceState.isChanged(ctx, suggestion);
    if (changed && !dto.acknowledgeSourceStateChanged) {
      await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'BLOCKED_BY_SOURCE_STATE', {
        blockedReasons: ['Source record changed after generation; regenerate or acknowledge to proceed'],
      });
      throw new ConflictException('Source record changed after generation; regenerate or acknowledge');
    }

    // Source module validates and creates the draft (re-checks source permission).
    const created = await this.adapter.createDraft(ctx, action, dto.editedPayloadJson);

    await this.repo.updateCandidateAction(action.id, {
      status: 'SOURCE_DRAFT_CREATED',
      validationResultJson: { ok: true, createdSourceRecordId: created.createdSourceRecordId },
    });
    if (suggestion.status === 'NEW') {
      await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'IN_REVIEW');
    }
    await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'SOURCE_DRAFT_CREATED');

    const review = await this.repo.createReview({
      suggestionId: suggestion.id,
      candidateActionId: action.id,
      companyId: ctx.companyId,
      reviewerUserId: ctx.userId,
      decision: 'ACCEPT_AS_SOURCE_DRAFT',
      note: dto.acknowledgeSourceStateChanged ? 'Acknowledged source-state change' : undefined,
      editedPayloadJson: dto.editedPayloadJson,
      createdSourceModule: created.createdSourceModule,
      createdSourceRecordType: created.createdSourceRecordType,
      createdSourceRecordId: created.createdSourceRecordId,
      sourceDraftDeepLink: created.deepLink,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ai.draft.create_source_draft',
      targetType: 'ai_candidate_action', targetId: action.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { actionType: action.actionType, createdSourceModule: created.createdSourceModule, createdSourceRecordId: created.createdSourceRecordId },
    });

    return { review: toReview(review), status: 'SOURCE_DRAFT_CREATED' };
  }
}

@Injectable()
export class ReviewSuggestionUseCase {
  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly audit: AuditService,
    private readonly createRequest: CreateDraftRequestUseCase,
  ) {}

  async execute(ctx: RequestContext, suggestionId: string, dto: ReviewAiSuggestionDto): Promise<AiSuggestionReview> {
    if (!canReviewSuggestions(ctx.permissions)) throw new ForbiddenException('Missing permission: ai.suggestion.review');
    const found = await this.repo.findSuggestionById(ctx.companyId, suggestionId);
    if (!found) throw new NotFoundException('Suggestion not found');
    const suggestion = found.suggestion;
    if (!isSuggestionActionable(suggestion.status)) {
      throw new UnprocessableEntityException(`Suggestion is not actionable (status ${suggestion.status})`);
    }
    if (
      suggestion.needsDataReasonsJson.length > 0 &&
      dto.decision !== 'REQUEST_REGENERATION' &&
      dto.decision !== 'DISMISS' &&
      dto.decision !== 'MARK_NOT_USEFUL'
    ) {
      throw new UnprocessableEntityException(AI_SUGGESTION_NEEDS_DATA_ERROR);
    }

    if ((dto.decision === 'DISMISS' || dto.decision === 'MARK_NOT_USEFUL') && !ctx.permissions.includes(AI_PERMISSION_KEYS.SUGGESTION_DISMISS)) {
      throw new ForbiddenException('Missing permission: ai.suggestion.dismiss');
    }

    const review = await this.repo.createReview({
      suggestionId: suggestion.id,
      candidateActionId: dto.candidateActionId,
      companyId: ctx.companyId,
      reviewerUserId: ctx.userId,
      decision: dto.decision,
      note: dto.note,
    });

    switch (dto.decision) {
      case 'DISMISS':
      case 'MARK_NOT_USEFUL':
        await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'DISMISSED');
        break;
      case 'ACCEPT_AS_SOURCE_DRAFT':
      case 'EDIT_AND_ACCEPT':
        await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'ACCEPTED_FOR_SOURCE_DRAFT');
        break;
      case 'REQUEST_REGENERATION':
        await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'SUPERSEDED');
        await this.createRequest.execute(ctx, {
          templateKey: suggestion.templateKey,
          origin: 'WEB',
          sourceModule: suggestion.sourceModule,
          sourceRecordType: suggestion.sourceRecordType,
          sourceRecordId: suggestion.sourceRecordId,
        });
        break;
      case 'MARK_NEEDS_DATA':
      case 'ESCALATE_TO_OWNER':
        if (suggestion.status === 'NEW') await this.repo.updateSuggestionStatus(ctx.companyId, suggestion.id, 'IN_REVIEW');
        break;
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ai.suggestion.review',
      targetType: 'ai_suggestion', targetId: suggestion.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { decision: dto.decision },
    });

    return toReview(review);
  }
}

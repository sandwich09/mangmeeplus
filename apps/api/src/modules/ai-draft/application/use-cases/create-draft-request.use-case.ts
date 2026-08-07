import { Injectable, ForbiddenException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, AiDraftRequestOrigin, AiDraftRequestSummary } from '@watchdog-bms/contracts';
import { PrismaAiDraftRepository } from '../../infrastructure/prisma-ai-draft.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { getTemplate, computeTemplateAvailability } from '../../domain/ai-draft-template-catalog';
import { canRequestSuggestions } from '../../domain/logic/ai-draft-permission.logic';
import { buildRequestIdempotencyKey, previewText, hashText } from '../../domain/logic/ai-draft-idempotency.logic';
import { toRequestSummary } from '../dto/ai-draft.mapper';

export type CreateDraftRequestInput = {
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

@Injectable()
export class CreateDraftRequestUseCase {
  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: CreateDraftRequestInput): Promise<AiDraftRequestSummary> {
    if (!canRequestSuggestions(ctx.permissions)) {
      throw new ForbiddenException('Missing permission: ai.suggestion.request');
    }
    const template = getTemplate(input.templateKey);
    if (!template) throw new BadRequestException(`Unknown template: ${input.templateKey}`);
    const availability = computeTemplateAvailability(template);
    if (availability.status !== 'AVAILABLE') {
      throw new UnprocessableEntityException(`Template unavailable: ${availability.unavailableReason ?? 'unavailable'}`);
    }
    // Enforce the template's required permissions server-side (AI + source read).
    const missing = template.requiredPermissions.filter((p) => !ctx.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }

    const origin: AiDraftRequestOrigin = input.origin ?? 'WEB';
    const idempotencyKey = buildRequestIdempotencyKey({
      companyId: ctx.companyId,
      origin,
      templateKey: input.templateKey,
      sourceRecordId: input.sourceRecordId,
      workflowRunId: input.workflowRunId,
      suppliedKey: input.idempotencyKey,
      uniqueSuffix: ctx.requestId,
    });

    // Idempotent: a duplicate (workflow/schedule) request returns the existing one.
    const existing = await this.repo.findRequestByIdempotencyKey(ctx.companyId, idempotencyKey);
    if (existing) return toRequestSummary(existing);

    const expiresAt = new Date(Date.now() + template.defaultTtlMinutes * 60_000);
    const created = await this.repo.createRequest({
      companyId: ctx.companyId,
      requesterUserId: ctx.userId,
      origin,
      agent: template.defaultAgent,
      templateKey: input.templateKey,
      sourceModule: input.sourceModule,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      sourceRefsJson: input.sourceRefsJson,
      requestedPromptPreview: previewText(input.promptText),
      requestedPromptHash: input.promptText ? hashText(input.promptText) : undefined,
      language: input.language ?? 'th-TH',
      idempotencyKey,
      workflowRunId: input.workflowRunId,
      expiresAt,
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'ai.suggestion.request',
      targetType: 'ai_draft_request',
      targetId: created.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { templateKey: input.templateKey, origin, agent: template.defaultAgent },
    });

    return toRequestSummary(created);
  }

  // Safe entry point for Workflow Automation (item 16 REQUEST_AI_DRAFT action). The
  // workflow is a trusted internal trigger and has no interactive permission set, so it
  // requests the draft on behalf of the configured requester; generation later
  // re-checks that requester's source permissions. The workflow can request but never
  // apply the draft — creation of any source draft stays web-only.
  async createFromWorkflow(input: {
    companyId: string;
    requesterUserId: string;
    templateKey: string;
    sourceModule?: string;
    sourceRecordType?: string;
    sourceRecordId?: string;
    workflowRunId: string;
  }): Promise<AiDraftRequestSummary> {
    const template = getTemplate(input.templateKey);
    if (!template) throw new BadRequestException(`Unknown template: ${input.templateKey}`);
    if (computeTemplateAvailability(template).status !== 'AVAILABLE') {
      throw new UnprocessableEntityException('Template unavailable');
    }
    const idempotencyKey = buildRequestIdempotencyKey({
      companyId: input.companyId,
      origin: 'WORKFLOW',
      templateKey: input.templateKey,
      sourceRecordId: input.sourceRecordId,
      workflowRunId: input.workflowRunId,
    });
    const existing = await this.repo.findRequestByIdempotencyKey(input.companyId, idempotencyKey);
    if (existing) return toRequestSummary(existing);

    const created = await this.repo.createRequest({
      companyId: input.companyId,
      requesterUserId: input.requesterUserId,
      origin: 'WORKFLOW',
      agent: template.defaultAgent,
      templateKey: input.templateKey,
      sourceModule: input.sourceModule,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      language: 'th-TH',
      idempotencyKey,
      workflowRunId: input.workflowRunId,
      expiresAt: new Date(Date.now() + template.defaultTtlMinutes * 60_000),
    });
    void this.audit.log({
      companyId: input.companyId,
      actorUserId: input.requesterUserId,
      action: 'ai.suggestion.request',
      targetType: 'ai_draft_request',
      targetId: created.id,
      requestId: `workflow-run:${input.workflowRunId}`,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { templateKey: input.templateKey, origin: 'WORKFLOW', workflowRunId: input.workflowRunId },
    });
    return toRequestSummary(created);
  }
}

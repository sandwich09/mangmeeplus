import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import type {
  RequestContext,
  ListAiSuggestionsFilter,
  AiSuggestionSummary,
  AiSuggestionDetail,
  AiSuggestionTemplateSummary,
  AiProviderStatus,
} from '@watchdog-bms/contracts';
import { AI_PERMISSION_KEYS } from '@watchdog-bms/contracts';
import { PrismaAiDraftRepository } from '../../infrastructure/prisma-ai-draft.repository';
import { SourceStateService } from '../source-state.service';
import { LLM_DRAFT_PORT } from '../../infrastructure/provider/llm-draft.port';
import type { LlmDraftPort } from '../../infrastructure/provider/llm-draft.port';
import { canReadSuggestions, hasBroadSuggestionRead } from '../../domain/logic/ai-draft-permission.logic';
import { AI_SUGGESTION_TEMPLATES } from '../../domain/ai-draft-template-catalog';
import { toSuggestionSummary, toSuggestionDetail, toTemplateSummary } from '../dto/ai-draft.mapper';

function paginate<T>(rows: T[], page?: number, pageSize?: number) {
  const p = page && page > 0 ? page : 1;
  const size = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total: rows.length, page: p, pageSize: size };
}

@Injectable()
export class ListSuggestionsUseCase {
  constructor(private readonly repo: PrismaAiDraftRepository) {}

  async execute(
    ctx: RequestContext,
    filter: ListAiSuggestionsFilter,
  ): Promise<{ items: AiSuggestionSummary[]; total: number; page: number; pageSize: number }> {
    if (!canReadSuggestions(ctx.permissions)) throw new ForbiddenException('Missing permission: ai.suggestion.read');
    // Own-only readers (and explicit scope=own) are narrowed to their own review queue.
    const broad = hasBroadSuggestionRead(ctx.permissions);
    const reviewOwnerUserId = broad && filter.scope !== 'own' ? undefined : ctx.userId;

    const rows = await this.repo.listSuggestions({
      companyId: ctx.companyId,
      reviewOwnerUserId,
      status: filter.status,
      domain: filter.domain,
      agent: filter.agent,
      riskLevel: filter.riskLevel,
      sourceModule: filter.sourceModule,
    });
    const page = paginate(rows, filter.page, filter.pageSize);
    return { ...page, items: page.items.map((r) => toSuggestionSummary(r, r.citationCountActual)) };
  }
}

@Injectable()
export class GetSuggestionDetailUseCase {
  constructor(
    private readonly repo: PrismaAiDraftRepository,
    private readonly sourceState: SourceStateService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<AiSuggestionDetail> {
    if (!canReadSuggestions(ctx.permissions)) throw new ForbiddenException('Missing permission: ai.suggestion.read');
    const found = await this.repo.findSuggestionById(ctx.companyId, id);
    if (!found) throw new NotFoundException('Suggestion not found');
    // Own-only readers can only see suggestions in their own review queue.
    if (!hasBroadSuggestionRead(ctx.permissions) && found.suggestion.reviewOwnerUserId !== ctx.userId) {
      throw new ForbiddenException('Not permitted to read this suggestion');
    }
    const sourceStateChanged = await this.sourceState.isChanged(ctx, found.suggestion);
    return toSuggestionDetail({ ...found, sourceStateChanged });
  }
}

@Injectable()
export class ListTemplatesUseCase {
  execute(ctx: RequestContext): AiSuggestionTemplateSummary[] {
    const canRead =
      ctx.permissions.includes(AI_PERMISSION_KEYS.TEMPLATE_READ) ||
      ctx.permissions.includes(AI_PERMISSION_KEYS.SUGGESTION_REQUEST) ||
      ctx.permissions.includes(AI_PERMISSION_KEYS.DRAFT_REQUEST) ||
      ctx.permissions.includes(AI_PERMISSION_KEYS.SUGGESTION_READ);
    if (!canRead) throw new ForbiddenException('Missing permission: ai.template.read');
    return AI_SUGGESTION_TEMPLATES.map(toTemplateSummary);
  }
}

@Injectable()
export class GetProviderStatusUseCase {
  constructor(@Inject(LLM_DRAFT_PORT) private readonly provider: LlmDraftPort) {}

  execute(ctx: RequestContext): AiProviderStatus {
    if (!canReadSuggestions(ctx.permissions) && !ctx.permissions.includes(AI_PERMISSION_KEYS.SUGGESTION_REQUEST)) {
      throw new ForbiddenException('Missing permission');
    }
    return {
      mode: this.provider.mode,
      available: this.provider.available,
      reason: this.provider.available
        ? undefined
        : 'AI draft model provider is not configured. Suggestions are AI-authored, so none are generated until a provider is enabled (no deterministic/canned fallback content).',
    };
  }
}

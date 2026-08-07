import { Controller, Get, Post, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateAiDraftRequestDto,
  ListAiSuggestionsFilter,
  ReviewAiSuggestionDto,
  CreateSourceDraftDto,
  AiSuggestionStatus,
  AiSuggestionDomain,
  AiSuggestionAgent,
  AiRiskLevel,
} from '@watchdog-bms/contracts';
import { CreateDraftRequestUseCase } from '../../application/use-cases/create-draft-request.use-case';
import {
  ListSuggestionsUseCase,
  GetSuggestionDetailUseCase,
} from '../../application/use-cases/ai-suggestion-query.use-case';
import {
  ValidateCandidateActionUseCase,
  CreateSourceDraftUseCase,
  ReviewSuggestionUseCase,
} from '../../application/use-cases/ai-suggestion-review.use-case';

@ApiTags('ai-draft')
@Controller('companies/:companyId/ai/suggestions')
export class AiSuggestionController {
  constructor(
    private readonly createRequest: CreateDraftRequestUseCase,
    private readonly list: ListSuggestionsUseCase,
    private readonly detail: GetSuggestionDetailUseCase,
    private readonly validate: ValidateCandidateActionUseCase,
    private readonly createSourceDraft: CreateSourceDraftUseCase,
    private readonly review: ReviewSuggestionUseCase,
  ) {}

  @Post('requests')
  @RequirePermissions('ai.suggestion.request')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request an AI suggestion/draft (web)' })
  request(@ReqCtx() ctx: RequestContext, @Body() body: CreateAiDraftRequestDto) {
    return this.createRequest.execute(ctx, { ...body, origin: 'WEB' });
  }

  @Get()
  @RequirePermissions('ai.suggestion.read_own')
  @ApiOperation({ summary: 'List AI suggestions (ABAC-scoped)' })
  listSuggestions(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'all',
    @Query('status') status?: AiSuggestionStatus,
    @Query('domain') domain?: AiSuggestionDomain,
    @Query('agent') agent?: AiSuggestionAgent,
    @Query('riskLevel') riskLevel?: AiRiskLevel,
    @Query('sourceModule') sourceModule?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListAiSuggestionsFilter = {
      scope, status, domain, agent, riskLevel, sourceModule,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.list.execute(ctx, filter);
  }

  @Get(':id')
  @RequirePermissions('ai.suggestion.read_own')
  @ApiOperation({ summary: 'Get AI suggestion detail with citations and candidate actions' })
  getDetail(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.detail.execute(ctx, id);
  }

  @Post(':id/actions/:actionId/validate')
  @RequirePermissions('ai.draft.review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a candidate action against source-module rules (no record created)' })
  validateAction(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('actionId') actionId: string) {
    return this.validate.execute(ctx, id, actionId);
  }

  @Post(':id/actions/:actionId/create-source-draft')
  @RequirePermissions('ai.draft.create_source_draft')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a source-module draft from a candidate action (web only)' })
  createDraft(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() body: CreateSourceDraftDto,
  ) {
    return this.createSourceDraft.execute(ctx, id, actionId, body ?? {});
  }

  @Post(':id/reviews')
  @RequirePermissions('ai.suggestion.review')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a review decision on an AI suggestion' })
  reviewSuggestion(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReviewAiSuggestionDto) {
    return this.review.execute(ctx, id, body);
  }
}

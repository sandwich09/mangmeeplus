import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { ListTemplatesUseCase, GetProviderStatusUseCase } from '../../application/use-cases/ai-suggestion-query.use-case';

@ApiTags('ai-draft')
@Controller('companies/:companyId/ai')
export class AiTemplateController {
  constructor(
    private readonly templates: ListTemplatesUseCase,
    private readonly providerStatus: GetProviderStatusUseCase,
  ) {}

  @Get('suggestion-templates')
  @RequirePermissions('ai.suggestion.read_own')
  @ApiOperation({ summary: 'List AI suggestion templates with availability' })
  listTemplates(@ReqCtx() ctx: RequestContext) {
    return this.templates.execute(ctx);
  }

  @Get('provider-status')
  @RequirePermissions('ai.suggestion.read_own')
  @ApiOperation({ summary: 'Read AI draft provider status' })
  provider(@ReqCtx() ctx: RequestContext) {
    return this.providerStatus.execute(ctx);
  }
}

/**
 * Internal AI Gateway endpoint for AI draft/suggestion authoring (Item 17).
 * Protected by X-Internal-Secret; called only by the ERP Core API. The gateway runs the
 * model (Bedrock via its provider port) on the bounded evidence the API supplies — it
 * never reads the database.
 */
import { Controller, Post, Body, Headers, BadRequestException, HttpCode, Inject, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageInterceptor } from '../../common/usage/ai-usage.interceptor';
import { Public } from '../../common/security/public.decorator';
import { assertInternalSecret } from '../../common/security/internal-secret';
import { AiGatewayConfigService } from '../../common/config/ai-gateway-config.service';
import { createProvider } from '../line-ai/infrastructure/provider/provider.factory';
import { GenerateDraftUseCase } from './generate-draft.use-case';
import type { AiDraftGenerationRequest, AiDraftGenerationResult } from '@watchdog-bms/contracts';

@ApiTags('internal')
@Controller('internal/ai')
@UseInterceptors(AiUsageInterceptor)
export class AiDraftInternalController {
  constructor(
    @Inject(AiGatewayConfigService) private readonly config: AiGatewayConfigService,
    @Inject(GenerateDraftUseCase) private readonly generateDraft: GenerateDraftUseCase,
  ) {}

  @Public()
  @Post('draft-generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: author an AI draft/suggestion from grounded evidence (API service only)' })
  async draftGenerate(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: AiDraftGenerationRequest,
  ): Promise<AiDraftGenerationResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!body?.templateKey || !Array.isArray(body?.facts)) {
      throw new BadRequestException('Invalid draft generation payload.');
    }
    const provider = createProvider(this.config);
    return this.generateDraft.execute(provider, body);
  }
}

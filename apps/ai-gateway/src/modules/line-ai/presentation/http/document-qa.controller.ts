import { Body, Controller, Headers, HttpCode, Post, UseInterceptors } from '@nestjs/common';
import { type LineDocumentQaGatewayRequest } from '@watchdog-bms/contracts';
import { AiUsageInterceptor } from '../../../../common/usage/ai-usage.interceptor';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { assertInternalSecret } from '../../../../common/security/internal-secret';
import { Public } from '../../../../common/security/public.decorator';
import { DocumentQaUseCase } from '../../application/document-qa.use-case';

@Public()
@Controller('internal/ai')
@UseInterceptors(AiUsageInterceptor)
export class DocumentQaController {
  constructor(private readonly config: AiGatewayConfigService, private readonly useCase: DocumentQaUseCase) {}

  @Post('line-document-qa')
  @HttpCode(200)
  async read(@Headers('x-internal-secret') secret: string | undefined, @Body() body: LineDocumentQaGatewayRequest) {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    return this.useCase.execute(body);
  }
}

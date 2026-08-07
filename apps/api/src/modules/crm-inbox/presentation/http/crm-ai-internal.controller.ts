/**
 * Worker-triggered CRM AI jobs, protected by X-Worker-Token like the
 * item 06 internal notification endpoints.
 */
import { Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { ScanCrmTrustScoresUseCase } from '../../application/use-cases/crm-ai-trust.use-case';

@Public()
@Controller('internal/crm')
export class CrmAiInternalController {
  constructor(private readonly scanTrustScores: ScanCrmTrustScoresUseCase) {}

  @Post('trust-score-scan')
  async trustScoreScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.scanTrustScores.execute();
  }
}

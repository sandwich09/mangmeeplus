import { Injectable } from '@nestjs/common';
import type { CrmTrustScoreRequest, CrmTrustScoreResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmTrustScoreAgent } from '../agents/crm-trust-score.agent';

// Seam where the API-computed signals meet the trust-score agent. B4 adds prompt
// assembly + score clamping/validation here; B1 forwards only.
@Injectable()
export class CrmTrustScoreUseCase {
  private readonly agent = new CrmTrustScoreAgent();

  execute(provider: IModelProvider, req: CrmTrustScoreRequest): Promise<CrmTrustScoreResult> {
    return this.agent.run(provider, req);
  }
}

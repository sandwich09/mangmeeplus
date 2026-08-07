import { Injectable } from '@nestjs/common';
import type { CrmInsightsRequest, CrmInsightsResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmInsightsAgent } from '../agents/crm-insights.agent';

@Injectable()
export class CrmInsightsUseCase {
  private readonly agent = new CrmInsightsAgent();

  execute(provider: IModelProvider, req: CrmInsightsRequest): Promise<CrmInsightsResult> {
    return this.agent.run(provider, req);
  }
}

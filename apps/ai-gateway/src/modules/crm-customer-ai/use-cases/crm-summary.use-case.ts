import { Injectable } from '@nestjs/common';
import type { CrmConversationSummaryRequest, CrmConversationSummaryResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmConversationSummaryAgent } from '../agents/crm-conversation-summary.agent';

@Injectable()
export class CrmSummaryUseCase {
  private readonly agent = new CrmConversationSummaryAgent();

  execute(provider: IModelProvider, req: CrmConversationSummaryRequest): Promise<CrmConversationSummaryResult> {
    return this.agent.run(provider, req);
  }
}

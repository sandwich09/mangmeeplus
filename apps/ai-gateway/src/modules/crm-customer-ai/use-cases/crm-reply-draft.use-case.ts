import { Injectable } from '@nestjs/common';
import type { CrmReplyDraftRequest, CrmReplyDraftResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmCustomerReplyAgent } from '../agents/crm-customer-reply.agent';

// Seam where the API-assembled brand context meets the reply agent. B3 adds prompt
// assembly (brand voice + template few-shot) + output validation here; B1 forwards only.
@Injectable()
export class CrmReplyDraftUseCase {
  private readonly agent = new CrmCustomerReplyAgent();

  execute(provider: IModelProvider, req: CrmReplyDraftRequest): Promise<CrmReplyDraftResult> {
    return this.agent.run(provider, req);
  }
}

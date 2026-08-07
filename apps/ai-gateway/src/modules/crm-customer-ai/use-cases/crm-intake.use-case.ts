import { Injectable } from '@nestjs/common';
import type { CrmCustomerIntakeRequest, CrmCustomerIntakeResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmCustomerIntakeAgent } from '../agents/crm-customer-intake.agent';

// Seam where the API-assembled bounded context meets the intake agent. B2 adds prompt
// assembly + output validation here (mirrors GenerateDraftUseCase); B1 forwards only.
@Injectable()
export class CrmIntakeUseCase {
  private readonly agent = new CrmCustomerIntakeAgent();

  execute(provider: IModelProvider, req: CrmCustomerIntakeRequest): Promise<CrmCustomerIntakeResult> {
    return this.agent.run(provider, req);
  }
}

import { Injectable } from '@nestjs/common';
import type {
  CrmCustomerProfileExtractRequest,
  CrmCustomerProfileExtractResult,
} from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmCustomerProfileExtractAgent } from '../agents/crm-customer-profile-extract.agent';

@Injectable()
export class CrmCustomerProfileExtractUseCase {
  private readonly agent = new CrmCustomerProfileExtractAgent();

  execute(
    provider: IModelProvider,
    request: CrmCustomerProfileExtractRequest,
  ): Promise<CrmCustomerProfileExtractResult> {
    return this.agent.run(provider, request);
  }
}

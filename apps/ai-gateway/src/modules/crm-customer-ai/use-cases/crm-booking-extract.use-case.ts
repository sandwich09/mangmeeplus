import { Injectable } from '@nestjs/common';
import type { CrmBookingExtractRequest, CrmBookingExtractResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmBookingExtractAgent } from '../agents/crm-booking-extract.agent';

@Injectable()
export class CrmBookingExtractUseCase {
  private readonly agent = new CrmBookingExtractAgent();

  execute(provider: IModelProvider, req: CrmBookingExtractRequest): Promise<CrmBookingExtractResult> {
    return this.agent.run(provider, req);
  }
}

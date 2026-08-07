import { Injectable } from '@nestjs/common';
import type { CrmBroadcastGenerateRequest } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CrmBroadcastAgent } from '../agents/crm-broadcast.agent';

@Injectable()
export class CrmBroadcastUseCase {
  execute(provider: IModelProvider, request: CrmBroadcastGenerateRequest) { return new CrmBroadcastAgent().run(provider, request); }
}

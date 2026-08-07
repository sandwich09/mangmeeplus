import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GenerateCrmBroadcastInput, RequestContext } from '@watchdog-bms/contracts';
import { CrmAiGatewayClient } from '../../infrastructure/crm-ai-gateway.client';

@Injectable()
export class CrmAiBroadcastUseCase {
  constructor(private readonly gateway: CrmAiGatewayClient) {}
  async execute(ctx: RequestContext, input: GenerateCrmBroadcastInput) {
    const topic = input?.topic?.trim();
    if (!topic || topic.length > 500) throw new UnprocessableEntityException('INVALID_BROADCAST_TOPIC');
    try {
      const result = await this.gateway.requestBroadcastGenerate({ ...input, topic, price: input.price?.trim().slice(0, 100), keyPoint: input.keyPoint?.trim().slice(0, 300), requestId: randomUUID(), companyId: ctx.companyId, locale: 'th-TH' });
      if (result.status !== 'ok') throw new ServiceUnavailableException('AI_BROADCAST_UNAVAILABLE');
      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('AI_BROADCAST_UNAVAILABLE');
    }
  }
}

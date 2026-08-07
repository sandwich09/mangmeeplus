import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';

@Injectable()
export class SumReceivedPaymentsByCounterpartyUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(
    ctx: RequestContext,
    counterpartyIds: string[],
  ): Promise<{ counterpartyId: string; amount: string; paymentCount: number; latestPaidAt: Date }[]> {
    const ids = [...new Set(counterpartyIds.filter(Boolean))];
    if (ids.length === 0) return [];
    // aggregate revenue exposed under the caller's crm.report.read gate (not raw financial documents)
    return this.repo.sumReceivedPaymentsByCounterparty(ctx.companyId, ids);
  }
}

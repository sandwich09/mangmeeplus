import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { ICrmChannelCapRepository } from '../domain/ports/crm-channel-cap-repository.port';

@Injectable()
export class PrismaCrmChannelCapRepository implements ICrmChannelCapRepository {
  constructor(private readonly prisma: PrismaService) {}

  async tryReserve(companyId: string, channelId: string, dayKey: string, cap: number): Promise<boolean> {
    if (cap <= 0) return false; // no capacity configured => nothing to reserve
    // Ensure the counter row exists without disturbing an already-running count
    // (empty update). Idempotent under concurrency via the (channelId, dayKey) unique.
    await this.prisma.client.crmChannelAutoReplyUsage.upsert({
      where: { channelId_dayKey: { channelId, dayKey } },
      update: {},
      create: { companyId, channelId, dayKey, count: 0 },
    });
    // CAS: the increment only lands while count < cap, so exactly one caller wins
    // per unit of remaining capacity. count === 1 => this reservation is ours.
    const { count } = await this.prisma.client.crmChannelAutoReplyUsage.updateMany({
      where: { companyId, channelId, dayKey, count: { lt: cap } },
      data: { count: { increment: 1 } },
    });
    return count === 1;
  }

  async release(companyId: string, channelId: string, dayKey: string): Promise<void> {
    // Floor at 0: only decrement a row that is above zero.
    await this.prisma.client.crmChannelAutoReplyUsage.updateMany({
      where: { companyId, channelId, dayKey, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  }
}

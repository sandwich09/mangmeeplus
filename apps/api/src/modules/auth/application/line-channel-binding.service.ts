import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class LineChannelBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async getBindingForChannel(messagingChannelId: string): Promise<{ companyId: string } | null> {
    const binding = await this.prisma.client.lineChannelBinding.findFirst({
      where: { messagingChannelId, status: 'ACTIVE' },
      select: { companyId: true },
    });
    return binding ?? null;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export type PartnerMemberLineUnlinkCommand = {
  companyId: string;
  memberUserId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class PartnerMemberLineUnlinkUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: PartnerMemberLineUnlinkCommand): Promise<{ unlinked: true }> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: cmd.companyId, userId: cmd.memberUserId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this partner company.');

    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId: cmd.memberUserId, provider: 'LINE', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('No active LINE identity linked.');

    await this.prisma.client.$transaction([
      this.prisma.client.externalIdentity.update({
        where: { id: identity.id },
        data: { status: 'UNLINKED', updatedAt: new Date() },
      }),
      this.prisma.client.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_member.line_unlink',
          targetType: 'ExternalIdentity',
          targetId: identity.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId },
        },
      }),
    ]);

    return { unlinked: true };
  }
}

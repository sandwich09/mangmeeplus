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
      select: { id: true, providerUserId: true },
    });
    if (!identity) throw new NotFoundException('No active LINE identity linked.');

    await this.prisma.client.$transaction([
      this.prisma.client.externalIdentity.update({
        where: { id: identity.id },
        data: { status: 'UNLINKED', updatedAt: new Date() },
      }),
      // line-support-request-spec-th §2.5, in the same transaction as the unlink: a context row
      // that outlives its identity names a shop this LINE account has left, and is what sent the
      // support notice to the wrong partner page in UAT. Nothing else keys on it — the intake
      // state and pending media are keyed by (companyId, userId), which the unlink does not touch.
      this.prisma.client.lineCompanyContext.deleteMany({
        where: { lineUserId: identity.providerUserId },
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

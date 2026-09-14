import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { revokePendingLineHandoffTokens } from '../../../auth/domain/logic/line-handoff.logic';

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
      select: { id: true, providerUserId: true, updatedAt: true },
    });
    if (!identity) throw new NotFoundException('No active LINE identity linked.');

    // Interactive rather than the array form because the audit row below reports a count the
    // revoke produces, and the array form cannot feed one statement's result into the next.
    await this.prisma.client.$transaction(async (tx) => {
      const changed = await tx.externalIdentity.updateMany({
        where: { id: identity.id, userId: cmd.memberUserId, status: 'ACTIVE', updatedAt: identity.updatedAt },
        data: { status: 'UNLINKED', updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'line_identity_changed', message: 'LINE binding changed. Reload and try again.' });
      await tx.passwordResetToken.updateMany({ where: { userId: cmd.memberUserId, status: 'PENDING' }, data: { status: 'REVOKED' } });
      // line-support-request-spec-th §2.5, in the same transaction as the unlink: a context row
      // that outlives its identity names a shop this LINE account has left, and is what sent the
      // support notice to the wrong partner page in UAT. Nothing else keys on it — the intake
      // state and pending media are keyed by (companyId, userId), which the unlink does not touch.
      await tx.lineCompanyContext.deleteMany({
        where: { lineUserId: identity.providerUserId },
      });
      // Owner decision 2026-09-06: an admin severing a member's LINE account has to sever the
      // unspent deep links already in that chat too, or the member keeps a way in for 15 minutes
      // after support believes the account is cut off.
      const handoffLinksRevoked = await revokePendingLineHandoffTokens(tx.lineWebHandoffToken, {
        lineUserId: identity.providerUserId,
        userId: cmd.memberUserId,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_member.line_unlink',
          targetType: 'ExternalIdentity',
          targetId: identity.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId, handoffLinksRevoked },
        },
      });
    });

    return { unlinked: true };
  }
}

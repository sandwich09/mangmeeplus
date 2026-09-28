import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { SetPartnerOwnerNameInput, SetPartnerOwnerNameResult } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PLATFORM_ROLE_KEYS } from '../../../auth/permission-registry';

type Command = SetPartnerOwnerNameInput & {
  companyId: string;
  memberUserId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class SetPartnerOwnerNameUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: Command): Promise<SetPartnerOwnerNameResult> {
    const displayName = typeof cmd.displayName === 'string' ? cmd.displayName.trim() : '';
    if (!displayName || displayName.length > 160 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(cmd.displayName)
      || typeof cmd.expectedDisplayName !== 'string') {
      throw new UnprocessableEntityException({ code: 'partner_owner_name_invalid' });
    }

    // The name belongs to User, so no employee profile or password is required.
    const target = {
      id: cmd.memberUserId,
      isSystemProtected: false,
      memberships: {
        some: { companyId: cmd.companyId, roles: { some: { role: { key: 'OWNER' } } } },
        none: { roles: { some: { role: { key: { in: [...PLATFORM_ROLE_KEYS] } } } } },
      },
    };
    return this.prisma.client.$transaction(async (tx) => {
      const owner = await tx.user.findFirst({ where: target, select: { displayName: true } });
      if (!owner) throw new NotFoundException({ code: 'partner_owner_name_unavailable' });
      if (owner.displayName !== cmd.expectedDisplayName) {
        throw new ConflictException({ code: 'partner_owner_name_conflict' });
      }
      if (owner.displayName === displayName) return { displayName };

      const updated = await tx.user.updateMany({
        where: { ...target, displayName: cmd.expectedDisplayName },
        data: { displayName },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'partner_owner_name_conflict' });
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_member.display_name_update',
          targetType: 'User',
          targetId: cmd.memberUserId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId },
        },
      });
      return { displayName };
    });
  }
}

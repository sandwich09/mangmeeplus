import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export type PartnerLifecycleCommand = {
  companyId: string;
  targetStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  reason?: string;
  requestingAdminUserId: string;
  requestId: string;
};

export type PartnerLifecycleResult = {
  id: string;
  status: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
};

// Timestamp rules per target status
function timestampData(targetStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'): Record<string, Date | null> {
  const now = new Date();
  if (targetStatus === 'ACTIVE')    return { activatedAt: now, disabledAt: null, archivedAt: null };
  if (targetStatus === 'DISABLED')  return { disabledAt: now, archivedAt: null };
  /* ARCHIVED */                    return { archivedAt: now };
}

@Injectable()
export class PartnerLifecycleTransitionUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: PartnerLifecycleCommand): Promise<PartnerLifecycleResult> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true, activatedAt: true, disabledAt: true, archivedAt: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    // SUSPENDED is a separate security state — not managed here
    if ((cmd.targetStatus as string) === 'SUSPENDED') {
      throw new UnprocessableEntityException('SUSPENDED is not a valid targetStatus for lifecycle management.');
    }

    const fromStatus = company.status;
    const tsData = timestampData(cmd.targetStatus);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.company.update({
        where: { id: cmd.companyId },
        data: { status: cmd.targetStatus, ...tsData },
        select: { id: true, status: true, activatedAt: true, disabledAt: true, archivedAt: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_company.lifecycle.transition',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { fromStatus, toStatus: cmd.targetStatus, reason: cmd.reason ?? null },
        },
      });

      return result;
    });

    return {
      id: updated.id,
      status: updated.status,
      activatedAt: updated.activatedAt?.toISOString(),
      disabledAt: updated.disabledAt?.toISOString(),
      archivedAt: updated.archivedAt?.toISOString(),
    };
  }
}

import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PLAN_TIER_PRESETS, type PackageChangeRequestDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';

export type CreatePackageChangeRequestCommand = {
  companyId: string;
  requestedByUserId: string;
  requestedTierKey: string;
  note?: string;
  requestId: string;
};

/** Postgres unique violation — here, only the partial "one OPEN request per company" index. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * P10-L §3.7/§8. A shop asking to move tier. This use-case OPENS a request and nothing else: the
 * tier itself still changes only through `PUT /system/partners/:id/plan-term`, so there stays
 * exactly one place where a customer's limits can move (H-01).
 */
@Injectable()
export class PackageChangeRequestUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async create(cmd: CreatePackageChangeRequestCommand): Promise<PackageChangeRequestDto> {
    if (!Object.hasOwn(PLAN_TIER_PRESETS, cmd.requestedTierKey)) {
      throw new UnprocessableEntityException(`tierKey "${cmd.requestedTierKey}" is not a known plan tier.`);
    }
    // Spec §4: OWNER of the company, not merely someone who can edit its settings. The route's
    // permission is `company.setup.manage`, which a default ADMIN also holds — asking to change
    // what the shop PAYS is the owner's decision, so the role is checked as well as the permission.
    await this.assertOwner(cmd.companyId, cmd.requestedByUserId);

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.packageChangeRequest.create({
          data: {
            companyId: cmd.companyId,
            requestedByUserId: cmd.requestedByUserId,
            requestedTierKey: cmd.requestedTierKey,
            ...(cmd.note?.trim() ? { note: cmd.note.trim() } : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: cmd.companyId,
            actorUserId: cmd.requestedByUserId,
            action: 'signup.line.package_change_requested',
            targetType: 'package_change_request',
            targetId: row.id,
            requestId: cmd.requestId,
            result: 'SUCCESS',
            riskLevel: 'MEDIUM',
            metadataJson: { requestedTierKey: cmd.requestedTierKey, hasNote: Boolean(cmd.note?.trim()) },
          },
        });
        return row;
      });
      return toDto(created);
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      // Idempotent by the partial unique index: a shop that taps twice — from the quota card and
      // again from the expiry message — has one request in the queue, not two, and is told so
      // rather than shown an error it cannot act on.
      const open = await this.prisma.client.packageChangeRequest.findFirst({
        where: { companyId: cmd.companyId, status: 'OPEN' },
      });
      if (!open) throw error;
      return toDto(open);
    }
  }

  /**
   * An ACTIVE membership, held by an OWNER, in a company that is ACTIVE or DISABLED.
   *
   * DISABLED belongs here (P10-L §3.7): a trial that ran out leaves the company DISABLED, and the
   * expiry message this flow sends carries a "ขอเปลี่ยนแพ็กเกจ" button — a shop that cannot ask
   * precisely when it most needs to would make that button decorative. Opening a queue row changes
   * nothing by itself; the tier still moves only through the partner page.
   *
   * SUSPENDED and ARCHIVED stay out: those are an operator's decision, and the way back is a
   * conversation with the operator, not a request in the same queue.
   */
  private async assertOwner(companyId: string, userId: string): Promise<void> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE', company: { status: { in: ['ACTIVE', 'DISABLED'] } } },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    if (!membership?.roles.some((entry) => entry.role.key === 'OWNER')) {
      throw new ForbiddenException('owner_role_required');
    }
  }

  /** What an admin sees for one shop, newest first. */
  async listForCompany(companyId: string): Promise<PackageChangeRequestDto[]> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toDto);
  }
}

function toDto(row: {
  id: string;
  companyId: string;
  requestedTierKey: string;
  status: string;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}): PackageChangeRequestDto {
  return {
    id: row.id,
    companyId: row.companyId,
    requestedTierKey: row.requestedTierKey,
    status: row.status as PackageChangeRequestDto['status'],
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}

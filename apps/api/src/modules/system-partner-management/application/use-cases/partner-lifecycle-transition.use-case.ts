import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { planTermLockReason, type PlanTermLockReason } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { lockPlanTermCompany } from '../lock-plan-term-company';

export type PartnerLifecycleCommand = {
  companyId: string;
  targetStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  reason?: string;
  /** null = no human pulled the lever (P29 term-expiry sweep); `reason` names the actor instead. */
  requestingAdminUserId: string | null;
  requestId: string;
};

export type PartnerLifecycleResult = {
  id: string;
  status: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
};

export const partnerActivationTermLocked = (reason: PlanTermLockReason) => new ConflictException({ code: 'partner_activation_term_locked',
  message: reason === 'no_package' ? 'ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ'
    : 'แพ็กเกจของร้านนี้หมดอายุแล้ว ต่ออายุในหมวดแพ็กเกจ หรือให้ลูกค้าซื้อเองจากหน้าแพ็กเกจ' });

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

  async execute(cmd: PartnerLifecycleCommand, transaction?: Prisma.TransactionClient): Promise<PartnerLifecycleResult> {
    if (!transaction) return this.prisma.client.$transaction(tx => this.execute(cmd, tx));
    const tx = transaction;
    await lockPlanTermCompany(tx, cmd.companyId);
    const company = await tx.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true, activatedAt: true, disabledAt: true, archivedAt: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    // SUSPENDED is a separate security state — not managed here
    if ((cmd.targetStatus as string) === 'SUSPENDED') {
      throw new UnprocessableEntityException('SUSPENDED is not a valid targetStatus for lifecycle management.');
    }

    // R-C6 (purchase-without-setup §18.2): a human re-activating a shop the TERM locked is undone by
    // the sweep within ~5 minutes (plan-term-sweep.use-case.ts picks ACTIVE + expired). The renewal
    // path is safe here: RenewCompanyPlanTermUseCase moves termEndsAt BEFORE it calls this use case
    // in the same transaction, so this read sees the new end.
    if (cmd.targetStatus === 'ACTIVE' && cmd.requestingAdminUserId !== null) {
      const term = await tx.companyPlanTerm.findUnique({ where: { companyId: cmd.companyId }, select: { termStartAt: true, termEndsAt: true, renewCount: true } });
      if (term && term.termEndsAt.getTime() <= Date.now()) throw partnerActivationTermLocked(planTermLockReason(term));
    }

    const fromStatus = company.status;
    const tsData = timestampData(cmd.targetStatus);

    // A human disable supersedes a term hold, including DISABLED -> DISABLED. A later
    // renewal must not mistake the old term marker for permission to lift this hold.
    if (cmd.requestingAdminUserId !== null && cmd.targetStatus !== 'ACTIVE') {
      await tx.companyPlanTerm.updateMany({
        where: { companyId: cmd.companyId }, data: { termDisabledAt: null },
      });
    }
    const updated = await tx.company.update({
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

    return {
      id: updated.id,
      status: updated.status,
      activatedAt: updated.activatedAt?.toISOString(),
      disabledAt: updated.disabledAt?.toISOString(),
      archivedAt: updated.archivedAt?.toISOString(),
    };
  }
}

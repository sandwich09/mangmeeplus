import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  PLAN_TIER_PRESETS,
  type AdminPackageChangeDecisionBody,
  type AdminPackageChangeDecisionDto,
  type AdminPackageChangeItemDto,
  type AdminPackageChangeQueueDto,
  type PackageChangeRequestStatus,
  type PlanTierKey,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { pushSystemLineMessage } from '../../../auth/infrastructure/system-line-push';
import { SetCompanyPlanTermUseCase } from './company-plan-term.use-cases';

export const PACKAGE_CHANGE_DECIDED_ACTION = 'signup.line.package_change_decided';

/** Owner copy (§7 register). No plus sign in customer text; write "และ". */
export function packageChangeApprovedMessageTh(tierKey: string, note?: string): string {
  const label = PLAN_TIER_PRESETS[tierKey as PlanTierKey]?.labelTh ?? tierKey;
  return `เปลี่ยนแพ็กเกจเป็น ${label} แล้วค่ะ${note ? ` ${note}` : ''}`;
}

export function packageChangeRejectedMessageTh(note?: string): string {
  return 'ตอนนี้ยังเปลี่ยนแพ็กเกจให้ไม่ได้ ต้องขออภัยด้วยนะคะ '
    + `ติดต่อทีมงานได้ที่ โทร 098-256-5628 (จันทร์–เสาร์ 9:00–18:00) ค่ะ${note ? ` ${note}` : ''}`;
}

/**
 * P10-L §8, the admin half of the package-change queue.
 *
 * APPROVE is deliberately not its own tier writer: it CLAIMS the row and then calls the very
 * use-case `PUT /system/partners/:id/plan-term` calls, so a customer's limits still move in exactly
 * one place (H-01) with the same CRITICAL before/after audit row. The claim is a CAS on `OPEN`, so
 * two operators tapping the same row produce one tier change, not two — and a failure inside the
 * tier write puts the row back where the next operator can find it.
 */
@Injectable()
export class PackageChangeDecisionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setPlanTerm: SetCompanyPlanTermUseCase,
    private readonly config: AppConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  async list(status: PackageChangeRequestStatus = 'OPEN'): Promise<AdminPackageChangeQueueDto> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        company: { select: { name: true, planTerm: { select: { tierKey: true } } } },
      },
    });
    if (rows.length === 0) return { items: [] };

    // One batched read rather than one per row: the requester's name is the only thing the row
    // itself cannot answer, and `requestedByUserId` is not a relation.
    const requesters = await this.prisma.client.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.requestedByUserId))] } },
      select: { id: true, displayName: true },
    });
    const nameByUserId = new Map(requesters.map((user) => [user.id, user.displayName]));

    return {
      items: rows.map((row): AdminPackageChangeItemDto => ({
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        requestedTierKey: row.requestedTierKey,
        ...(row.company.planTerm?.tierKey ? { currentTierKey: row.company.planTerm.tierKey } : {}),
        ...(nameByUserId.get(row.requestedByUserId)
          ? { requestedByDisplayName: nameByUserId.get(row.requestedByUserId)! }
          : {}),
        status: row.status as PackageChangeRequestStatus,
        ...(row.note ? { note: row.note } : {}),
        createdAt: row.createdAt.toISOString(),
        ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
      })),
    };
  }

  async decide(
    id: string,
    body: AdminPackageChangeDecisionBody,
    adminUserId: string,
    requestId: string,
  ): Promise<AdminPackageChangeDecisionDto> {
    const row = await this.prisma.client.packageChangeRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('package_change_request_not_found');
    // Idempotent by contract: a decided row answers with the decision it already carries. Repeating
    // APPROVE must never buy a second tier change.
    if (row.status !== 'OPEN') return { id, status: row.status as PackageChangeRequestStatus };

    const target: PackageChangeRequestStatus = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (body.action === 'APPROVE' && !Object.hasOwn(PLAN_TIER_PRESETS, row.requestedTierKey)) {
      throw new UnprocessableEntityException(`tierKey "${row.requestedTierKey}" is not a known plan tier.`);
    }

    // Claim first. The loser of a race sees a decided row above on its next read and changes nothing.
    const claimed = await this.prisma.client.packageChangeRequest.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: target, decidedByUserId: adminUserId, decidedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.client.packageChangeRequest.findUnique({ where: { id } });
      return { id, status: (current?.status ?? 'OPEN') as PackageChangeRequestStatus };
    }

    if (body.action === 'APPROVE') {
      const preset = PLAN_TIER_PRESETS[row.requestedTierKey as PlanTierKey];
      try {
        await this.setPlanTerm.execute({
          companyId: row.companyId,
          tierKey: row.requestedTierKey as PlanTierKey,
          branchLimit: preset.branchLimit,
          employeeLimit: preset.employeeLimit,
          monthlySlipLimit: preset.monthlySlipLimit,
          requestingAdminUserId: adminUserId,
          requestId,
        });
      } catch (error) {
        // The tier did not move, so the row must not claim it did — put it back in the queue.
        await this.prisma.client.packageChangeRequest.updateMany({
          where: { id, status: 'APPROVED' },
          data: { status: 'OPEN', decidedByUserId: null, decidedAt: null },
        });
        throw error;
      }
    }

    await this.prisma.client.auditLog.create({
      data: {
        companyId: row.companyId,
        actorUserId: adminUserId,
        action: PACKAGE_CHANGE_DECIDED_ACTION,
        targetType: 'package_change_request',
        targetId: id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          action: body.action,
          requestedTierKey: row.requestedTierKey,
          hasNote: Boolean(body.note?.trim()),
        },
      },
    });

    await this.notifyShop(row.companyId, body, row.requestedTierKey);
    return { id, status: target };
  }

  /**
   * Best-effort by contract: the tier has already moved, and a dead LINE OA must not undo it. The
   * notice goes to the shop's OWNERs, which is who asked — never to every member.
   */
  private async notifyShop(
    companyId: string,
    body: AdminPackageChangeDecisionBody,
    requestedTierKey: string,
  ): Promise<void> {
    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) return;
    const note = body.note?.trim() || undefined;
    const text = body.action === 'APPROVE'
      ? packageChangeApprovedMessageTh(requestedTierKey, note)
      : packageChangeRejectedMessageTh(note);
    for (const providerUserId of await ownerLineUserIds(this.prisma, companyId)) {
      if (!await pushSystemLineMessage(token, providerUserId, text)) {
        this.logger.warn(
          { event: 'signup.line.package_change_notice_failed', riskLevel: 'LOW' },
          'signup.line.package_change_notice_failed',
        );
      }
    }
  }
}

/**
 * The LINE identities of a shop's active OWNERs. Shared with the admin message box (SEC-05): both
 * answer "who speaks for this shop", and one definition keeps them from drifting apart.
 */
export async function ownerLineUserIds(prisma: PrismaService, companyId: string): Promise<string[]> {
  const owners = await prisma.client.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
    select: { userId: true },
  });
  if (owners.length === 0) return [];
  const identities = await prisma.client.externalIdentity.findMany({
    where: { userId: { in: owners.map((owner) => owner.userId) }, provider: 'LINE', status: 'ACTIVE' },
    select: { providerUserId: true },
  });
  // One owner may hold more than one identity row; the shop wants one message, not two.
  return [...new Set(identities.map((identity) => identity.providerUserId))];
}

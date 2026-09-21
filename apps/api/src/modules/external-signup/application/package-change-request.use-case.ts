import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  PLAN_TIER_PRESETS,
  type PackageChangeDealOffer,
  type PackageChangeRequestDto,
  type PackageChangeRequestKind,
  type PlanTierKey,
  type SalesDealSnapshot,
} from '@watchdog-bms/contracts';
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
 * tier changes through the reviewed Admin writer or verified Stripe paid application. Opening
 * a request never authorizes either mutation.
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
   * nothing by itself; the reviewed Admin or verified payment path must apply the tier.
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

  /**
   * What this shop sees, newest first: its OWN package-change requests, plus the one sales deal
   * that is currently on offer to it (R10).
   *
   * A deal that is still DRAFT, waiting for approval, rejected or cancelled is deliberately NOT
   * here — the shop must never learn that an offer was being considered and then dropped, and the
   * console's internal states are not a customer-facing vocabulary.
   */
  async listForCompany(companyId: string): Promise<PackageChangeRequestDto[]> {
    const now = new Date();
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: {
        companyId,
        OR: [
          { kind: { not: 'SALES_DEAL' } },
          { kind: 'SALES_DEAL', status: 'APPROVED', offerExpiresAt: { gt: now } },
        ],
      },
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
  paymentState?: string;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  kind?: string;
  offerSnapshotJson?: unknown;
  offerExpiresAt?: Date | null;
}): PackageChangeRequestDto {
  const kind = (row.kind ?? 'CUSTOMER_REQUEST') as PackageChangeRequestKind;
  return {
    id: row.id,
    companyId: row.companyId,
    requestedTierKey: row.requestedTierKey,
    status: row.status as PackageChangeRequestDto['status'],
    kind,
    ...(kind === 'SALES_DEAL' ? dealOffer(row.id, row.offerSnapshotJson, row.offerExpiresAt ?? null) : {}),
    ...(row.status==='APPROVED'&&row.paymentState==='STRIPE_APPLIED'?{resolutionSource:'PAID_PURCHASE' as const}:{}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}

/**
 * The customer-facing half of a deal snapshot. `internalReason` and `salesUserId` stay behind in
 * the row: the note the team wrote each other is not part of the offer (S24).
 */
function dealOffer(
  dealId: string, snapshotJson: unknown, offerExpiresAt: Date | null,
): { deal: PackageChangeDealOffer } | Record<string, never> {
  const snapshot = snapshotJson as SalesDealSnapshot | null;
  if (!snapshot || !offerExpiresAt) return {};
  return {
    deal: {
      dealId,
      base: snapshot.base,
      baseLabel: PLAN_TIER_PRESETS[snapshot.base as PlanTierKey]?.labelTh ?? snapshot.base,
      priceSatang: snapshot.priceSatang,
      months: snapshot.months,
      branchLimit: snapshot.branchLimit,
      employeeLimit: snapshot.employeeLimit,
      monthlySlipLimit: snapshot.monthlySlipLimit,
      featureKeys: snapshot.featureKeys,
      aiMonthlyBudgetSatang: snapshot.aiMonthlyBudgetSatang,
      description: snapshot.description,
      offerExpiresAt: offerExpiresAt.toISOString(),
    },
  };
}

/**
 * D6 sales-code attribution (spec §17.1).
 *
 * Phase 2 RECORDS attribution and nothing else. The counting formula, the self-referral check, the
 * repeat-shop rule and the "20 shops a day" anomaly flag are Phase 4 — spec §17.1 calls them
 * mandatory in the first round, and the delivery briefs place them in Phase 4; the controller owns
 * that resolution.
 */
import { Injectable } from '@nestjs/common';
import { SALES_REFERRAL_ADMIN_WINDOW_DAYS } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { normalizeSalesCode } from '../domain/sales-deal.logic';
import { salesBadRequest, salesError, salesNotFound } from './sales-context';

export const SALES_CODE_UNKNOWN_MESSAGE_TH = 'ไม่พบรหัสเซลล์นี้ ตรวจสอบกับเซลล์ของคุณ';

@Injectable()
export class SalesReferralService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Resolve a typed code to an ACTIVE agent, for both signup paths.
   *
   * A SUSPENDED agent's code stops resolving (anti-gaming rule 1) and is reported exactly like an
   * unknown one — a customer must not be able to probe which codes exist but are switched off.
   * Returns null for "no code given"; throws for "a code was given and it is not usable".
   */
  async resolveCode(raw: unknown): Promise<{ salesCode: string; userId: string } | null> {
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return null;
    const salesCode = normalizeSalesCode(raw);
    if (!salesCode) throw salesBadRequest('SALES_CODE_UNKNOWN', SALES_CODE_UNKNOWN_MESSAGE_TH);
    const agent = await this.prisma.client.salesAgentProfile.findUnique({
      where: { salesCode },
      select: { userId: true, status: true },
    });
    if (!agent || agent.status !== 'ACTIVE') {
      throw salesBadRequest('SALES_CODE_UNKNOWN', SALES_CODE_UNKNOWN_MESSAGE_TH);
    }
    return { salesCode, userId: agent.userId };
  }

  /** The queue line: "รู้จักเราจากเซลล์: <ชื่อ> (<รหัส>)". */
  async displayFor(userIds: readonly string[]): Promise<Map<string, { displayName: string; salesCode: string }>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const [profiles, users] = await Promise.all([
      this.prisma.client.salesAgentProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, salesCode: true } }),
      this.prisma.client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
    ]);
    const nameById = new Map(users.map((user) => [user.id, user.displayName]));
    return new Map(profiles.map((profile) => [
      profile.userId,
      { displayName: nameById.get(profile.userId) ?? '', salesCode: profile.salesCode },
    ]));
  }

  /**
   * SYSTEM_ADMIN repair, inside the window and always with a reason (§17.1: an agent must never be
   * able to claim a shop after the fact, so this is the only way a referral changes post-signup).
   */
  async setCompanyReferral(
    ctx: RequestContext, companyId: string, rawCode: string | null, rawReason: string,
  ): Promise<{ companyId: string; referralSalesUserId: string | null }> {
    const reason = (rawReason ?? '').trim();
    if (!reason || reason.length > 500) {
      throw salesBadRequest('SALES_CODE_INVALID', 'ต้องระบุเหตุผลในการแก้ผู้แนะนำ (ไม่เกิน 500 ตัวอักษร)');
    }
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true, createdAt: true, referralSalesUserId: true },
    });
    if (!company) throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบร้านนี้ในระบบ');

    const windowEndsAt = company.createdAt.getTime() + SALES_REFERRAL_ADMIN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > windowEndsAt) {
      throw salesError(
        'SALES_REFERRAL_WINDOW_CLOSED',
        `แก้ผู้แนะนำได้ภายใน ${SALES_REFERRAL_ADMIN_WINDOW_DAYS} วันนับจากวันเปิดร้านเท่านั้น`,
      );
    }
    const resolved = rawCode === null ? null : await this.resolveCode(rawCode);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          referralSalesUserId: resolved?.userId ?? null,
          referralSource: resolved ? 'ADMIN' : null,
          // Kept as the original provisioning moment when one exists: the 14-day counting window
          // of §17.1 is anchored to when the shop opened, not to when an admin corrected the row.
          ...(resolved ? {} : { referredAt: null }),
        },
      });
      await this.audit.log({
        actorUserId: ctx.userId, companyId, action: 'sales.referral.changed',
        targetType: 'Company', targetId: companyId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          previousSalesUserId: company.referralSalesUserId,
          salesUserId: resolved?.userId ?? null,
          salesCode: resolved?.salesCode ?? null,
          reason,
        },
      }, tx);
    });
    return { companyId, referralSalesUserId: resolved?.userId ?? null };
  }
}

/**
 * Phase 4 reports and the Owner's anti-gaming queue (spec §17.1/§17.2, R13, S21).
 *
 * `SalesAttribution` is the ONLY source. There is nothing to reconcile with Stripe here and no
 * financial document of any kind reaches a sales user (S21): the report answers "how many shops
 * did this agent open and for how much", never "what did that shop pay for what".
 */
import { Injectable } from '@nestjs/common';
import {
  type SalesAttributionFlag,
  type SalesAttributionFlagListDto,
  type SalesAttributionFlagRow,
  type SalesAttributionSource,
  type SalesReportSummary,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import {
  aggregateReport,
  reportRange,
  SalesReportRangeError,
  type AttributionReportRow,
} from '../domain/sales-attribution.logic';
import { canSeeAllDeals, salesBadRequest, salesNotFound } from './sales-context';

/** One request can never scan more than this; the console pages by month, not by row. */
const REPORT_ROW_LIMIT = 5_000;
const FLAG_ROW_LIMIT = 200;

export type SalesReportQuery = { from?: string; to?: string; teamLeadUserId?: string; salesUserId?: string };

@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * R11/R13: an agent is forced onto their own rows whatever they ask for; a lead and the Owner
   * see every team, optionally narrowed. The narrowing is a filter, never an escalation.
   */
  async summary(ctx: RequestContext, query: SalesReportQuery): Promise<SalesReportSummary> {
    let range;
    try { range = reportRange(query.from, query.to, new Date()); }
    catch (error) {
      if (error instanceof SalesReportRangeError) {
        throw salesBadRequest('SALES_REPORT_RANGE_INVALID', 'ช่วงเดือนไม่ถูกต้อง ใช้รูปแบบ ปี-เดือน และไม่เกิน 24 เดือน');
      }
      throw error;
    }
    const salesUserIds = await this.visibleAgents(ctx, query);
    const rows = salesUserIds === null ? [] : await this.prisma.client.salesAttribution.findMany({
      where: { paidAt: { gte: range.start, lt: range.end }, ...(salesUserIds ? { salesUserId: { in: salesUserIds } } : {}) },
      select: { salesUserId: true, source: true, amountSatang: true, refundedSatang: true, paidAt: true,
        flags: true, flagReviewedAt: true },
      orderBy: { paidAt: 'desc' },
      take: REPORT_ROW_LIMIT,
    });
    const agents = await this.agentIndex(rows.map((row) => row.salesUserId));
    const report: AttributionReportRow[] = rows.map((row) => ({
      salesUserId: row.salesUserId, source: row.source as SalesAttributionSource,
      amountSatang: row.amountSatang, refundedSatang: row.refundedSatang, paidAt: row.paidAt,
      flags: row.flags, flagReviewedAt: row.flagReviewedAt,
    }));
    return {
      from: range.from, to: range.to,
      months: aggregateReport(report, (userId) => agents.get(userId) ?? { displayName: '', teamLeadUserId: null, teamLeadDisplayName: null }),
    };
  }

  /**
   * `null` = "this caller can see nothing" (an agent asking for someone else). `undefined` = every
   * agent. An array narrows. Keeping the three cases distinct is what stops an empty `in: []`
   * filter from silently meaning "no filter".
   */
  private async visibleAgents(ctx: RequestContext, query: SalesReportQuery): Promise<string[] | null | undefined> {
    if (!canSeeAllDeals(ctx)) {
      if (query.salesUserId && query.salesUserId !== ctx.userId) return null;
      return [ctx.userId];
    }
    if (query.salesUserId) return [query.salesUserId];
    if (query.teamLeadUserId) {
      const team = await this.prisma.client.salesAgentProfile.findMany({
        where: { OR: [{ teamLeadUserId: query.teamLeadUserId }, { userId: query.teamLeadUserId }] },
        select: { userId: true },
      });
      return team.map((row) => row.userId);
    }
    return undefined;
  }

  private async agentIndex(userIds: readonly string[]): Promise<Map<string, { displayName: string;
    teamLeadUserId: string | null; teamLeadDisplayName: string | null }>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const profiles = await this.prisma.client.salesAgentProfile.findMany({
      where: { userId: { in: ids } }, select: { userId: true, teamLeadUserId: true } });
    const leadByUser = new Map(profiles.map((profile) => [profile.userId, profile.teamLeadUserId]));
    // Phase 4 leftover: leads are looked up in the SAME query as their agents, so the report can
    // print "ทีมของ <หัวหน้า>" without a second round trip and without a lead-only read path.
    const leadIds = [...new Set([...leadByUser.values()].filter((id): id is string => !!id && !ids.includes(id)))];
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: [...ids, ...leadIds] } }, select: { id: true, displayName: true } });
    const nameById = new Map(users.map((user) => [user.id, user.displayName]));
    return new Map(ids.map((id) => {
      const teamLeadUserId = leadByUser.get(id) ?? null;
      return [id, { displayName: nameById.get(id) ?? '', teamLeadUserId,
        teamLeadDisplayName: teamLeadUserId ? nameById.get(teamLeadUserId) ?? null : null }];
    }));
  }

  // ── the Owner's flag queue (§17.1 "ธง ... ให้ Owner ตรวจ") ──────────────────────────

  async flagged(): Promise<SalesAttributionFlagListDto> {
    const rows = await this.prisma.client.salesAttribution.findMany({
      where: { flaggedAt: { not: null } },
      orderBy: [{ flagReviewedAt: { sort: 'asc', nulls: 'first' } }, { paidAt: 'desc' }],
      take: FLAG_ROW_LIMIT,
    });
    if (rows.length === 0) return { items: [] };
    const [companies, agents] = await Promise.all([
      this.prisma.client.company.findMany({ where: { id: { in: rows.map((row) => row.companyId) } }, select: { id: true, name: true } }),
      this.agentIndex(rows.map((row) => row.salesUserId)),
    ]);
    const nameByCompany = new Map(companies.map((company) => [company.id, company.name]));
    return {
      items: rows.map((row): SalesAttributionFlagRow => ({
        companyId: row.companyId, companyName: nameByCompany.get(row.companyId) ?? '',
        salesUserId: row.salesUserId, salesDisplayName: agents.get(row.salesUserId)?.displayName ?? '',
        source: row.source as SalesAttributionSource, amountSatang: row.amountSatang,
        refundedSatang: row.refundedSatang, paidAt: row.paidAt.toISOString(),
        flags: row.flags as SalesAttributionFlag[], flaggedAt: row.flaggedAt?.toISOString() ?? null,
        reviewedAt: row.flagReviewedAt?.toISOString() ?? null, reviewNote: row.flagReviewNote,
      })),
    };
  }

  /**
   * "ยืนยันว่าไม่ผิดปกติ" (`keep: false`) clears the flags and the row starts counting; "ตัดออก"
   * (`keep: true`) leaves them in place and records that a human decided so. Either way the row and
   * its money stay — nothing here deletes evidence.
   */
  async reviewFlag(ctx: RequestContext, companyId: string, keep: boolean, rawReason: string): Promise<SalesAttributionFlagListDto> {
    const reason = (rawReason ?? '').trim();
    if (!reason || reason.length > 500) {
      throw salesBadRequest('SALES_FLAG_REVIEW_INVALID', 'ต้องระบุเหตุผล (ไม่เกิน 500 ตัวอักษร)');
    }
    const row = await this.prisma.client.salesAttribution.findUnique({ where: { companyId } });
    if (!row || !row.flaggedAt) throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบรายการที่ติดธงของร้านนี้');
    await this.prisma.client.$transaction(async (tx) => {
      await tx.salesAttribution.update({
        where: { companyId },
        data: { ...(keep ? {} : { flags: [] }), flagReviewedAt: new Date(), flagReviewedByUserId: ctx.userId, flagReviewNote: reason },
      });
      await this.audit.log({
        actorUserId: ctx.userId, companyId, action: 'sales.attribution.flag_reviewed',
        targetType: 'SalesAttribution', targetId: row.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { keep, flags: row.flags, salesUserId: row.salesUserId, amountSatang: row.amountSatang, reason },
      }, tx);
    });
    return this.flagged();
  }
}

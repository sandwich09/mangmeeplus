/**
 * D3 renewal offers and the Owner's morning digest (spec §17 D3, §17.2, §17.3 "D3 ใช้เฉพาะดีลแบบ
 * จ่ายครั้งเดียว").
 *
 * 14 days before a deal-funded term ends the system writes the NEXT round as a PENDING_APPROVAL
 * deal with the same snapshot, so the lead only has to press approve. Nothing here charges anyone,
 * and a renewal never credits the agent — §17.2 counts first activations only.
 */
import { Injectable } from '@nestjs/common';
import type { SalesDealSnapshot } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { bangkokDateKey } from '../domain/sales-attribution.logic';
import { DEAL_KIND } from '../domain/sales-deal.logic';
import { PLATFORM_TENANT_ID, SALES_LEAD_ROLE } from './sales-context';

/** Trigger keys — must also be listed in IMPLEMENTED_TRIGGER_KEYS or LINE delivery is suppressed. */
export const SALES_RENEWAL_PENDING_TRIGGER = 'sales_deal_renewal_pending';
export const SALES_RENEWAL_OVERDUE_TRIGGER = 'sales_deal_renewal_overdue';
export const SALES_SLIP_PENDING_TRIGGER = 'sales_deal_slip_pending';
export const SALES_DAILY_DIGEST_TRIGGER = 'sales_daily_digest';

const DAY_MS = 24 * 60 * 60 * 1000;
/** D3: the renewal offer is written 14 days out and chased again at 7. */
export const RENEWAL_LEAD_DAYS = 14;
export const RENEWAL_REMINDER_DAYS = 7;
const SWEEP_BATCH_LIMIT = 200;

export type SalesRenewalSweepResult = { created: number; reminded: number; failures: number };

@Injectable()
export class SalesRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async sweep(now = new Date()): Promise<SalesRenewalSweepResult> {
    const created = await this.createRenewals(now);
    const reminded = await this.remindOverdue(now);
    return { created: created.count, reminded: reminded.count, failures: created.failures + reminded.failures };
  }

  /**
   * Terms that came from an APPLIED deal and end inside the window. `billingReceiptAccountId` is
   * what marks a term as paid-for rather than admin-granted, and the deal row is the proof that the
   * money came through the sales lane.
   */
  private async createRenewals(now: Date): Promise<{ count: number; failures: number }> {
    const terms = await this.prisma.client.companyPlanTerm.findMany({
      where: { termEndsAt: { gt: now, lte: new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY_MS) },
        billingReceiptAccountId: { not: null }, termDisabledAt: null },
      select: { companyId: true, termEndsAt: true },
      take: SWEEP_BATCH_LIMIT,
    });
    let count = 0, failures = 0;
    for (const term of terms) {
      try { if (await this.createOne(term.companyId, term.termEndsAt)) count += 1; }
      catch (error) { failures += 1; logSweepFailure('sales_renewal_create_failed', term.companyId, error); }
    }
    return { count, failures };
  }

  private async createOne(companyId: string, termEndsAt: Date): Promise<boolean> {
    const applied = await this.prisma.client.packageChangeRequest.findFirst({
      where: { companyId, kind: DEAL_KIND, status: 'APPLIED' },
      orderBy: { decidedAt: 'desc' },
    });
    if (!applied?.salesUserId || !applied.offerSnapshotJson) return false;
    // One renewal per applied deal, ever. Checked before the lock so the common "already done"
    // pass costs a single indexed read.
    if (await this.prisma.client.packageChangeRequest.findFirst({
      where: { renewalOfRequestId: applied.id }, select: { id: true },
    })) return false;

    const salesUserId = await this.activeOwnerOf(applied.salesUserId);
    const created = await this.prisma.client.$transaction(async (tx) => {
      // Same fence the plan-term sweep uses: two workers claiming the same company serialise here,
      // and the partial unique index refuses the second row even if they somehow do not.
      await lockPlanTermCompany(tx, companyId);
      if (await tx.packageChangeRequest.findFirst({ where: { renewalOfRequestId: applied.id }, select: { id: true } })) return null;
      // R3/S18: one non-final deal per shop. A deal the team is already working on IS the renewal.
      if (await tx.packageChangeRequest.findFirst({
        where: { companyId, kind: DEAL_KIND, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } }, select: { id: true },
      })) return null;
      const snapshot = applied.offerSnapshotJson as SalesDealSnapshot;
      const row = await tx.packageChangeRequest.create({
        data: {
          companyId, requestedByUserId: salesUserId, requestedTierKey: snapshot.base, kind: DEAL_KIND,
          status: 'PENDING_APPROVAL', salesUserId,
          offerSnapshotJson: applied.offerSnapshotJson as Prisma.InputJsonValue,
          amountSatang: snapshot.priceSatang,
          internalReason: `ต่ออายุอัตโนมัติจากดีล ${applied.id}`,
          renewalOfRequestId: applied.id, version: 1,
        },
      });
      await tx.auditLog.create({ data: { companyId, actorType: 'SYSTEM', actorRefId: 'sales-deal-renewal-sweep',
        action: 'sales.deal.renewal_created', targetType: 'package_change_request', targetId: row.id,
        requestId: `sales-renewal-${applied.id}`, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { renewalOfRequestId: applied.id, salesUserId, originalSalesUserId: applied.salesUserId,
          termEndsAt: termEndsAt.toISOString() } } });
      await this.notifySalesTeam(tx, {
        trigger: SALES_RENEWAL_PENDING_TRIGGER, dealId: row.id, salesUserId, severity: 'info',
        title: 'มีข้อเสนอต่ออายุรอการอนุมัติ',
        body: `ระบบสร้างข้อเสนอรอบถัดไปให้แล้ว รออนุมัติก่อนส่งให้ร้าน (สิทธิ์เดิมหมด ${bangkokDateKey(termEndsAt)})`,
        periodKey: row.id,
      });
      return row;
    });
    return Boolean(created);
  }

  /**
   * D3: still unapproved with 7 days to go — chase the team and tell the Owner. `renewalRemindedAt`
   * makes it exactly once; the sweep runs every 15 minutes.
   */
  private async remindOverdue(now: Date): Promise<{ count: number; failures: number }> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, status: 'PENDING_APPROVAL', renewalOfRequestId: { not: null }, renewalRemindedAt: null,
        company: { planTerm: { termEndsAt: { gt: now, lte: new Date(now.getTime() + RENEWAL_REMINDER_DAYS * DAY_MS) } } } },
      select: { id: true, companyId: true, salesUserId: true },
      take: SWEEP_BATCH_LIMIT,
    });
    let count = 0, failures = 0;
    for (const row of rows) {
      try {
        const claimed = await this.prisma.client.packageChangeRequest.updateMany({
          where: { id: row.id, status: 'PENDING_APPROVAL', renewalRemindedAt: null },
          data: { renewalRemindedAt: now },
        });
        if (claimed.count === 0) continue;
        await this.prisma.client.$transaction(async (tx) => {
          await this.notifySalesTeam(tx, {
            trigger: SALES_RENEWAL_OVERDUE_TRIGGER, dealId: row.id, salesUserId: row.salesUserId, severity: 'warning',
            title: 'ข้อเสนอต่ออายุยังไม่ได้อนุมัติ',
            body: 'เหลือเวลาไม่ถึง 7 วันก่อนสิทธิ์ของร้านหมด ถ้าไม่อนุมัติ ร้านจะถูกปิดใช้งานเมื่อครบกำหนด',
            periodKey: row.id, alsoSystemAdmin: true,
          });
        });
        count += 1;
      } catch (error) { failures += 1; logSweepFailure('sales_renewal_remind_failed', row.companyId, error); }
    }
    return { count, failures };
  }

  /** §17.1: a suspended agent stops receiving work; their team lead picks the renewal up. */
  private async activeOwnerOf(salesUserId: string): Promise<string> {
    const profile = await this.prisma.client.salesAgentProfile.findUnique({
      where: { userId: salesUserId }, select: { status: true, teamLeadUserId: true },
    });
    if (!profile || profile.status === 'ACTIVE' || !profile.teamLeadUserId) return salesUserId;
    return profile.teamLeadUserId;
  }

  /**
   * Sales notices are events on the PLATFORM tenant: agents and leads are members there, and
   * `executeInTransaction` only creates recipient rows for ACTIVE members of `companyId`.
   * No shop name, no price — the console links to the deal for both (R14/S24).
   */
  private async notifySalesTeam(tx: Prisma.TransactionClient, message: { trigger: string; dealId: string;
    salesUserId: string | null; severity: string; title: string; body: string; periodKey: string;
    alsoSystemAdmin?: boolean }): Promise<void> {
    const leads = await tx.companyMembership.findMany({
      where: { companyId: PLATFORM_TENANT_ID, status: 'ACTIVE',
        roles: { some: { role: { key: { in: message.alsoSystemAdmin ? [SALES_LEAD_ROLE, 'SYSTEM_ADMIN'] : [SALES_LEAD_ROLE] } } } } },
      select: { userId: true },
    });
    const recipientUserIds = [...new Set([...(message.salesUserId ? [message.salesUserId] : []), ...leads.map((lead) => lead.userId)])];
    if (recipientUserIds.length === 0) return;
    await this.notifications.executeInTransaction({
      companyId: PLATFORM_TENANT_ID,
      triggerKey: message.trigger,
      sourceModule: 'sales_console',
      sourceType: 'package_change_request',
      sourceId: message.dealId,
      severity: message.severity,
      title: message.title,
      body: message.body,
      deepLinkHref: `/sales/deals/${message.dealId}`,
      recipientUserIds,
      periodKey: message.periodKey,
    }, tx);
  }

  /** Q9: a customer transfer is waiting. Only the Owner can confirm one, so only they are told. */
  async notifySlipPending(dealId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const admins = await tx.companyMembership.findMany({
        where: { companyId: PLATFORM_TENANT_ID, status: 'ACTIVE', roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } },
        select: { userId: true },
      });
      if (admins.length === 0) return;
      await this.notifications.executeInTransaction({
        companyId: PLATFORM_TENANT_ID, triggerKey: SALES_SLIP_PENDING_TRIGGER, sourceModule: 'sales_console',
        sourceType: 'package_change_request', sourceId: dealId, severity: 'warning',
        title: 'มีสลิปโอนเงินรอตรวจสอบ',
        body: 'ลูกค้าแจ้งโอนเงินตามข้อเสนอพิเศษ ตรวจสลิปและยืนยันเพื่อเปิดใช้งานให้ร้าน',
        deepLinkHref: '/system/sales-slips',
        recipientUserIds: admins.map((admin) => admin.userId), periodKey: dealId,
      }, tx);
    });
  }

  // ── §17.2 daily digest (console only — no LINE, no email) ────────────────────────────

  /**
   * One SYSTEM_ADMIN event per admin company, keyed on the Bangkok day so the 07:00 cron is
   * exactly-once even when it is retried. Counts only: no shop names, no agent names, no PII.
   */
  async dailyDigest(now = new Date()): Promise<{ notified: number; periodKey: string }> {
    const periodKey = bangkokDateKey(new Date(now.getTime() - DAY_MS));
    const dayStart = new Date(`${periodKey}T00:00:00+07:00`);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const [attributions, flagged, renewalsPending, renewalsOverdue, slipsPending, admins] = await Promise.all([
      this.prisma.client.salesAttribution.findMany({ where: { createdAt: { gte: dayStart, lt: dayEnd } },
        select: { source: true, amountSatang: true } }),
      this.prisma.client.salesAttribution.count({ where: { flaggedAt: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.client.packageChangeRequest.count({ where: { kind: DEAL_KIND, status: 'PENDING_APPROVAL', renewalOfRequestId: { not: null } } }),
      this.prisma.client.packageChangeRequest.count({ where: { kind: DEAL_KIND, status: 'PENDING_APPROVAL',
        renewalOfRequestId: { not: null }, renewalRemindedAt: { not: null } } }),
      this.prisma.client.packageChangeRequest.count({ where: { kind: DEAL_KIND, paymentState: 'SLIP_PENDING' } }),
      this.prisma.client.companyMembership.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } },
        select: { companyId: true, userId: true } }),
    ]);
    const body = digestBodyTh({
      deals: attributions.filter((row) => row.source === 'DEAL').length,
      referrals: attributions.filter((row) => row.source === 'REFERRAL').length,
      amountSatang: attributions.reduce((sum, row) => sum + row.amountSatang, 0),
      flagged, renewalsPending, renewalsOverdue, slipsPending,
    });
    const byCompany = new Map<string, string[]>();
    for (const admin of admins) byCompany.set(admin.companyId, [...(byCompany.get(admin.companyId) ?? []), admin.userId]);
    let notified = 0;
    for (const [companyId, recipientUserIds] of byCompany) {
      await this.prisma.client.$transaction(async (tx) => {
        await this.notifications.executeInTransaction({
          companyId, triggerKey: SALES_DAILY_DIGEST_TRIGGER, sourceModule: 'sales_console',
          sourceType: 'sales_daily_digest', sourceId: periodKey, severity: 'info',
          title: `สรุปทีมขาย ${periodKey}`, body, deepLinkHref: '/system/sales-team',
          recipientUserIds, periodKey,
        }, tx);
      });
      notified += recipientUserIds.length;
    }
    return { notified, periodKey };
  }
}

/**
 * The digest body. Counts and one baht total — nothing that identifies a shop, an owner or an
 * agent, because this text reaches a dashboard and a notification list (S24).
 */
export function digestBodyTh(counts: { deals: number; referrals: number; amountSatang: number; flagged: number;
  renewalsPending: number; renewalsOverdue: number; slipsPending: number }): string {
  const baht = (counts.amountSatang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  return [
    `ร้านเปิดใหม่เมื่อวาน ${counts.deals + counts.referrals} ร้าน (ดีล ${counts.deals} · แนะนำ ${counts.referrals}) รวม ${baht} บาท`,
    `รายการที่ต้องตรวจ ${counts.flagged} รายการ`,
    `ข้อเสนอต่ออายุรออนุมัติ ${counts.renewalsPending} รายการ (เลยกำหนดเตือน ${counts.renewalsOverdue})`,
    `สลิปรอตรวจ ${counts.slipsPending} รายการ`,
  ].join(' · ');
}

/** One company's failure never aborts the batch; the row keeps its unsent state for the next pass. */
function logSweepFailure(event: string, companyId: string, error: unknown): void {
  console.error(JSON.stringify({ event, companyId, error: error instanceof Error ? error.message : String(error) }));
}

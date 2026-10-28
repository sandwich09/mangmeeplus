import { isFreeExpenseDraftCompany } from '../free-expense-access';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { lockPlanTermCompany } from '../lock-plan-term-company';
import { planManagersOf } from '../../../access-control/domain/logic/plan-manager.logic';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import {
  LADDER_SENT_COLUMN,
  WARNING_LADDER_DAYS,
  derivePlanTermState,
  expiredMessageTh,
  planTermLockReason,
  warningLadderPoint,
  warningMessageTh,
} from '../../domain/logic/plan-term.logic';
import { PartnerLifecycleTransitionUseCase } from './partner-lifecycle-transition.use-case';

/** Trigger keys — must also be listed in IMPLEMENTED_TRIGGER_KEYS or LINE delivery is suppressed. */
export const PLAN_TERM_EXPIRING_TRIGGER = 'plan_term_expiring';
export const PLAN_TERM_EXPIRED_TRIGGER = 'plan_term_expired';

const SWEEP_BATCH_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanTermSweepResult = {
  expired: number;
  warned: number;
  failures: number;
};

/**
 * P29 §4B. Runs every ~5 minutes. Two independent passes, both idempotent and both bounded.
 *
 * The sweep is NOT the enforcement: the on-access check in AuthGuard already refuses an expired
 * company to the millisecond. This pass exists to flip the visible status, stamp `termDisabledAt`
 * (which is what makes a renew re-enable the company), and tell people.
 *
 * Companies with no `CompanyPlanTerm` row are never selected by either query, so a grandfathered
 * customer is untouched by every line below.
 */
@Injectable()
export class PlanTermSweepUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: PartnerLifecycleTransitionUseCase,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
    @Optional() @Inject(AppConfigService) private readonly config: AppConfigService | null = null,
  ) {}

  private get selfServeBilling(): boolean {
    return this.config?.billingMode === 'test' || this.config?.billingMode === 'live';
  }

  async execute(limit = SWEEP_BATCH_LIMIT): Promise<PlanTermSweepResult> {
    const now = new Date();
    const expiry = await this.sweepExpiry(now, limit);
    const warnings = await this.sweepWarnings(now, limit);
    return {
      expired: expiry.count,
      warned: warnings.count,
      failures: expiry.failures + warnings.failures,
    };
  }

  /** Candidate selection is not authority: renew/admin writes take the same Company lock. */
  private async sweepExpiry(now: Date, limit: number): Promise<{ count: number; failures: number }> {
    const due = await this.prisma.client.companyPlanTerm.findMany({
      where: { termEndsAt: { lte: now }, company: { status: 'ACTIVE' } },
      select: { companyId: true }, orderBy: { termEndsAt: 'asc' }, take: limit,
    });
    let count = 0;
    let failures = 0;
    for (const candidate of due) {
      try {
        const changed = await this.prisma.client.$transaction(async (tx) => {
          await lockPlanTermCompany(tx, candidate.companyId);
          const row = await tx.companyPlanTerm.findUnique({
            where: { companyId: candidate.companyId }, include: { company: { select: { status: true, name: true } } },
          });
          if (!row || row.company.status !== 'ACTIVE' || row.termEndsAt > now) return false;
          // Sales-deals spec R2 (Owner 2026-09-20): a zero-day term nobody renewed never had a
          // package, so it never "expired" and its owner earns no such notice.
          const lockReason = planTermLockReason(row);
          const billing = row.billingReceiptAccountId ? await tx.billingAccount.findUnique({ where: { id: row.billingReceiptAccountId } }) : null;
          const nextStep = !this.selfServeBilling ? '' : ['CARD_ONCE', 'PROMPTPAY_ONCE'].includes(billing?.renewalMode ?? '')
            ? ' แพ็กเกจแบบชำระครั้งเดียวซื้อแพ็กเกจใหม่ได้ในหน้าการชำระเงินค่ะ' : billing?.renewalMode === 'PROMPTPAY_RENEW'
              ? ' เปิดบิลและสแกน QR ในหน้าการชำระเงินได้ค่ะ' : '';
          await this.lifecycle.execute({
            companyId: row.companyId, targetStatus: 'DISABLED',
            reason: lockReason === 'no_package' ? 'no_package' : 'term_expired',
            requestingAdminUserId: null, requestId: `plan-term-expired-${row.companyId}-${row.termEndsAt.getTime()}`,
          }, tx);
          await tx.companyPlanTerm.update({ where: { companyId: row.companyId }, data: {
            termDisabledAt: now, expiredNotifiedAt: now,
          } });
          if (lockReason !== 'no_package' && !await isFreeExpenseDraftCompany(tx, row.companyId, now)) {
            // NotificationEvent/Recipient/Delivery are already a durable queue. Commit them
            // with the claim; the existing delivery worker owns all later network attempts.
            await this.notify(row.companyId, row.company.name, {
              trigger: PLAN_TERM_EXPIRED_TRIGGER, severity: 'critical', title: 'แพ็กเกจหมดอายุแล้ว',
              body: expiredMessageTh(row.company.name, this.selfServeBilling, nextStep),
              periodKey: `expired:${row.termEndsAt.toISOString()}`,
            }, tx);
          }
          return true;
        });
        if (changed) count++;
      } catch (error) {
        failures++;
        logSweepFailure('plan_term_expiry_failed', candidate.companyId, error);
      }
    }
    return { count, failures };
  }

  /** Claim plus durable delivery creation is atomic, including concurrent/stale warning passes. */
  private async sweepWarnings(now: Date, limit: number): Promise<{ count: number; failures: number }> {
    const widest = Math.max(...WARNING_LADDER_DAYS);
    const upcoming = await this.prisma.client.companyPlanTerm.findMany({
      where: { termEndsAt: { gt: now, lte: new Date(now.getTime() + widest * DAY_MS) }, company: { status: 'ACTIVE' } },
      select: { companyId: true }, orderBy: { termEndsAt: 'asc' }, take: limit,
    });
    let count = 0;
    let failures = 0;
    for (const candidate of upcoming) {
      try {
        const changed = await this.prisma.client.$transaction(async (tx) => {
          await lockPlanTermCompany(tx, candidate.companyId);
          const row = await tx.companyPlanTerm.findUnique({
            where: { companyId: candidate.companyId }, include: { company: { select: { status: true, name: true } } },
          });
          if (!row || row.company.status !== 'ACTIVE' || row.termEndsAt <= now) return false;
          const billing = row.billingReceiptAccountId ? await tx.billingAccount.findUnique({ where: { id: row.billingReceiptAccountId } }) : null;
          const nextStep = !this.selfServeBilling ? '' : ['CARD_ONCE', 'PROMPTPAY_ONCE'].includes(billing?.renewalMode ?? '')
            ? ' แพ็กเกจแบบชำระครั้งเดียวซื้อแพ็กเกจใหม่ได้ในหน้าการชำระเงินค่ะ' : billing?.renewalMode === 'PROMPTPAY_RENEW'
              ? ' เปิดบิลและสแกน QR ในหน้าการชำระเงินได้ค่ะ' : '';
          const point = warningLadderPoint(row.termEndsAt, now);
          if (point === null) return false;
          const column = LADDER_SENT_COLUMN[point];
          if (row[column] !== null) return false;
          await tx.companyPlanTerm.update({ where: { companyId: row.companyId }, data: { [column]: now } });
          const { daysLeft } = derivePlanTermState(row.termEndsAt, row.warningDays, now);
          await this.notify(row.companyId, row.company.name, {
            trigger: PLAN_TERM_EXPIRING_TRIGGER, severity: 'action', title: 'แพ็กเกจใกล้หมดอายุ',
            body: warningMessageTh(row.company.name, row.termEndsAt, daysLeft, this.selfServeBilling, nextStep),
            periodKey: `${row.termEndsAt.toISOString()}:${point}`,
          }, tx);
          return true;
        });
        if (changed) count++;
      } catch (error) {
        failures++;
        logSweepFailure('plan_term_warning_failed', candidate.companyId, error);
      }
    }
    return { count, failures };
  }

  /**
   * Two audiences, one machinery. The company's plan managers (R-C11: `company.plan.manage`, not
   * only OWNER) get WEB + LINE through the notification event of their OWN company; System Admins
   * get the same news as a dashboard notification inside the platform company they are members of —
   * a recipient is only ever created for a user who holds an ACTIVE membership in the event's
   * company, so the two cannot be one event.
   */
  private async notify(
    companyId: string,
    companyName: string,
    message: {
      trigger: string;
      severity: string;
      title: string;
      body: string;
      periodKey: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // R-C11: the same people the web lets buy get the warning/expiry notice, inside this transaction.
    const owners = await planManagersOf(tx, companyId);
    if (owners.length > 0) {
      await this.notifications.executeInTransaction({
        companyId,
        triggerKey: message.trigger,
        sourceModule: 'plan_term',
        sourceType: 'company_plan_term',
        sourceId: companyId,
        severity: message.severity,
        title: message.title,
        body: message.body,
        deepLinkHref: `/companies/${companyId}/${this.selfServeBilling ? 'billing' : 'dashboard'}`,
        recipientUserIds: owners.map((owner) => owner.userId),
        periodKey: message.periodKey,
      }, tx);
    }

    const admins = await tx.companyMembership.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } },
      select: { companyId: true, userId: true },
    });
    const byAdminCompany = new Map<string, string[]>();
    for (const admin of admins) {
      byAdminCompany.set(admin.companyId, [...(byAdminCompany.get(admin.companyId) ?? []), admin.userId]);
    }
    for (const [adminCompanyId, userIds] of byAdminCompany) {
      await this.notifications.executeInTransaction({
        companyId: adminCompanyId,
        triggerKey: message.trigger,
        sourceModule: 'plan_term',
        sourceType: 'company_plan_term',
        // The AFFECTED company, so one admin event per customer rather than one per sweep.
        sourceId: companyId,
        severity: message.severity,
        title: `${message.title}: ${companyName}`,
        body: message.body,
        deepLinkHref: `/system/partners/${companyId}`,
        recipientUserIds: userIds,
        periodKey: message.periodKey,
      }, tx);
    }
  }
}

// One company's failure never aborts the batch; the row keeps its unsent state and the next
// pass retries it.
function logSweepFailure(event: string, companyId: string, error: unknown): void {
  console.error(JSON.stringify({
    event,
    companyId,
    error: error instanceof Error ? error.message : String(error),
  }));
}

import { Injectable } from '@nestjs/common';
import { addCivilDays, billingPlanLabel, civilDate, type SourceRef, type ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { PrismaService } from '../../../../common/database/prisma.service';
import { BillingService } from '../../../billing/application/billing.service';
import { isReceiptAddOnKind, visibleReceiptLots } from '../../../billing/application/billing-receipt-grants';
import { PLAN_MANAGE_PERMISSION_KEY } from '../../../access-control/domain/logic/plan-manager.logic';
import { effectivePlanCapacity } from '../../../system-partner-management/domain/logic/plan-capacity';
import { planCapacityUsed } from '../../../system-partner-management/application/plan-term-limit';
import { PACKAGE_PACE_FORMULA, packagePace, singlePaidCycle } from '../../domain/logic/package-usage-pace.logic';

/** Advisor spec §5.1 / P8: the typed refusal the gateway answers with the fixed "ask the owner" line. */
export const PACKAGE_MANAGER_REQUIRED = 'PACKAGE_MANAGER_REQUIRED';

/** Why there is no projection, in the words the answer may repeat. */
const PACE_NOTES = {
  too_early: 'รอบนี้เพิ่งเริ่มไม่ถึง 7 วัน ยังเร็วเกินไปที่จะคาดการณ์',
  unlimited: 'ใบเสร็จไม่จำกัดจำนวน จึงไม่ต้องคาดการณ์',
  no_single_cycle: 'ใบเสร็จที่ใช้ได้มาจากหลายรอบหรือมีส่วนที่ผู้ดูแลเพิ่มให้ จึงคาดการณ์จากอัตราการใช้รอบเดียวไม่ได้',
} as const;

const room = (used: number, limit: number | null) => ({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used) });

/**
 * `billing.get_package_usage` (advisor spec §5.1, slice S2a). THIS company's package, branch and member
 * room, and receipt reads with an API-computed projection — the numbers the package page shows
 * (BillingService.usage, effectivePlanCapacity, the plan-limit counts). Read-only: never
 * BillingService.status() (it calls Stripe and throws for a non-manager) or capacity() (it locks the
 * company row), never a price, never another package. Every value is a number, a civil date or plain
 * Thai an answer may quote. No renewal mode: it is not among the figures the owner approved for chat
 * (spec §10 item 1), and in the 2026-09-30 eval it drew unasked renewal notes that became buy/change
 * nudges.
 */
@Injectable()
export class BillingGetPackageUsageTool implements ErpReadToolPort {
  toolName = 'billing.get_package_usage';

  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    // Owner decision 2026-09-30 (§10 item 2): figures only for whoever may manage the package — the
    // permission canManagePlan and BillingService.assertOwner check. The registry offers this tool to
    // every assistant user so everyone else reaches this refusal instead of "the package lacks this".
    if (!ctx.permissions.includes(PLAN_MANAGE_PERMISSION_KEY)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: PACKAGE_MANAGER_REQUIRED };
    }
    const now = new Date(asOf), today = civilDate(now);
    const [term, usage, branches, members] = await Promise.all([
      this.prisma.client.companyPlanTerm.findUnique({ where: { companyId: ctx.companyId }, select: { tierKey: true, branchLimit: true,
        employeeLimit: true, capacityOverride: true, billingReceiptAccountId: true, termEndsAt: true, termDisabledAt: true } }),
      this.billing.usage(ctx.companyId),
      planCapacityUsed.branches(this.prisma.client, ctx.companyId),
      planCapacityUsed.members(this.prisma.client, ctx.companyId),
    ]);
    const capacity = term ? effectivePlanCapacity(term, now) : null;
    const termEndsOn = term ? civilDate(term.termEndsAt) : null;
    const monthly = usage.cadence === 'LEGACY_MONTH';
    // A monthly allowance counts the calendar month (a team gift beside it keeps its own expiry, so that
    // mix has no single cycle); a paid one counts the period of the lots it spends, the same lots
    // BillingService.usage() counts.
    let cycle: { startOn: string; endOn: string } | null = null;
    if (monthly && !usage.monthlyAllowance && usage.resetsAt) cycle = { startOn: `${today.slice(0, 7)}-01`, endOn: civilDate(new Date(usage.resetsAt)) };
    if (!monthly) {
      const lots = await this.prisma.client.billingReceiptGrant.findMany({
        where: visibleReceiptLots(ctx.companyId, term?.billingReceiptAccountId ?? null, now), select: { kind: true, serviceStart: true, serviceEnd: true } });
      cycle = singlePaidCycle(lots.filter((lot) => !isReceiptAddOnKind(lot.kind)));
    }
    const pace = usage.limit === null ? 'unlimited' as const
      : cycle ? packagePace({ used: usage.used, limit: usage.limit, ...cycle, today }) : 'no_single_cycle' as const;
    // The package page's own notes: when the monthly allowance restarts, and paid receipts that expire
    // before the package does.
    const resetsOn = monthly && usage.resetsAt && term && Date.parse(usage.resetsAt) < term.termEndsAt.getTime()
      ? civilDate(new Date(usage.resetsAt)) : null;
    const expiresOn = usage.expiresAt ? civilDate(new Date(usage.expiresAt)) : null;
    const sourceRefs: SourceRef[] = [{
      label: 'แพ็กเกจของร้าน', module: 'billing', entityType: 'package_usage',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/billing`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        package: { label: billingPlanLabel(term?.tierKey), termEndsOn },
        capacity: { branches: room(branches, capacity?.branchLimit ?? null), members: room(members, capacity?.employeeLimit ?? null) },
        receipts: {
          used: usage.used, limit: usage.limit, remaining: usage.remaining, cadence: monthly ? 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน' : 'ตามรอบที่ชำระ',
          // A month ends on its last day; a paid period on the day it runs until, as the package page prints it.
          periodStartOn: cycle?.startOn ?? null, periodEndsOn: cycle && (monthly ? addCivilDays(cycle.endOn, -1) : cycle.endOn),
          resetsOn, expiresOn: expiresOn !== termEndsOn ? expiresOn : null,
          additional: usage.monthlyAllowance ? { remaining: usage.monthlyAllowance.additionalRemaining,
            expiresOn: usage.monthlyAllowance.additionalExpiresAt ? civilDate(new Date(usage.monthlyAllowance.additionalExpiresAt)) : null } : null,
          pace: typeof pace === 'object' ? pace : null,
          paceNote: typeof pace === 'string' ? PACE_NOTES[pace] : null,
        },
      },
      sourceRefs,
      asOf,
      basisVersion: PACKAGE_PACE_FORMULA,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'bangkok_civil_day', statusBasis: 'current_package_term',
        dataset: 'billing.package_usage', accessScope: 'company' },
    };
  }
}

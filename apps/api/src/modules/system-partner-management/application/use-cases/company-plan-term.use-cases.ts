import { isFreeExpenseDraftCompany } from '../free-expense-access';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CompanyPlanTermViewDto,
  PlanTermNoticeDto,
  PlanTierKey,
  RenewCompanyPlanTermBody,
  SetCompanyPlanTermBody,
} from '@watchdog-bms/contracts';
import { PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  DEFAULT_TERM_DAYS,
  DEFAULT_WARNING_DAYS,
  addDays,
  derivePlanTermState,
  isPlanTierKey,
  planTermLockReason,
  toPlanTermDto,
  type PlanTermRow,
} from '../../domain/logic/plan-term.logic';
import { PartnerLifecycleTransitionUseCase } from './partner-lifecycle-transition.use-case';
import { lockPlanTermCompany } from '../lock-plan-term-company';
import { checkPlanTermAdjustment, planTermSourceVersion } from '../plan-term-adjustment';
import { planCapacityUsed } from '../plan-term-limit';
import { partnerPlanAdjustmentHistory } from '../partner-plan-adjustment-history';

export const paidPlanReviewRequired = () => new ConflictException({code:'paid_plan_review_required', message:'แพ็กเกจนี้มีรายการชำระเงิน กรุณาใช้หน้าปรับแพ็กเกจชั่วคราวเพื่อตรวจและอนุมัติ'});
export const PLAN_TERM_SET_ACTION = 'system.company_plan_term.set';
export const PLAN_TERM_RENEW_ACTION = 'system.company_plan_term.renew';
/** P10-L §9: an operator looked at the shop and lifted its first-week ceiling early. */
export const PLAN_TERM_WARMUP_END_ACTION = 'system.company_plan_term.warmup_ended';
/** 403 code the web client routes to the renewal page on (spec §4B). */
export const COMPANY_TERM_EXPIRED_CODE = 'company_term_expired';

const TERM_SELECT = {
  updatedAt: true,
  capacityOverride: true,
  billingReceiptAccountId: true,
  companyId: true,
  tierKey: true,
  branchLimit: true,
  employeeLimit: true,
  monthlySlipLimit: true,
  termStartAt: true,
  termEndsAt: true,
  warningDays: true,
  renewCount: true,
  lastRenewedAt: true,
  termDisabledAt: true,
  // P10-L §9: the operator has to see whether a trial shop is still inside its first-week ceiling
  // before deciding to lift it ("ตรวจแล้ว"), so the read carries it like any other limit.
  warmupUntil: true,
  warmupSlipLimit: true,
} as const;

@Injectable()
export class GetPartnerPlanAdjustmentHistoryUseCase {
  constructor(private readonly prisma: PrismaService) {}
  execute(companyId: string, cursor?: string) { return partnerPlanAdjustmentHistory(this.prisma.client, companyId, cursor); }
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new UnprocessableEntityException(`${field} must be a whole number of at least 1.`);
  }
  return value;
}

function parseDate(value: string | undefined, field: string, fallback: Date): Date {
  if (value === undefined) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new UnprocessableEntityException(`${field} is not a valid date.`);
  return parsed;
}

@Injectable()
export class GetCompanyPlanTermUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string): Promise<CompanyPlanTermViewDto> {
    const row = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: TERM_SELECT,
    });
    // No row is a legitimate answer, not a 404: it is how a grandfathered company reads.
    const [activeBranches, activeMembers] = await Promise.all([
      planCapacityUsed.branches(this.prisma.client, companyId),
      planCapacityUsed.members(this.prisma.client, companyId),
    ]);
    return { term: row ? toPlanTermDto(row as PlanTermRow, new Date()) : null,
      sourceVersion: planTermSourceVersion(companyId, row), activeBranches, activeMembers };
  }
}

export type SetCompanyPlanTermCommand = SetCompanyPlanTermBody & {
  packageChangeRequestId?: string;
  companyId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class SetCompanyPlanTermUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create-or-update. Dates are decided ONCE, when the row is created: editing limits, tier or
   * warningDays afterwards must never silently move a customer's deadline (spec §4A). Moving it
   * deliberately is what renew is for.
   */
  async execute(cmd: SetCompanyPlanTermCommand, transaction?: Prisma.TransactionClient): Promise<CompanyPlanTermViewDto> {
    const apply = async (tx: Prisma.TransactionClient): Promise<CompanyPlanTermViewDto> => {
      await lockPlanTermCompany(tx, cmd.companyId);
      const company = await tx.company.findUnique({
        where: { id: cmd.companyId },
        select: { id: true },
      });
      if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

      if (!isPlanTierKey(cmd.tierKey)) {
        throw new UnprocessableEntityException(`tierKey "${String(cmd.tierKey)}" is not a known plan tier.`);
      }
      const branchLimit = positiveInt(cmd.branchLimit, 'branchLimit');
      const employeeLimit = positiveInt(cmd.employeeLimit, 'employeeLimit');
      const monthlySlipLimit = positiveInt(cmd.monthlySlipLimit, 'monthlySlipLimit');
      const warningDays = cmd.warningDays === undefined ? DEFAULT_WARNING_DAYS : positiveInt(cmd.warningDays, 'warningDays');

      const now = new Date();
      const existing = await tx.companyPlanTerm.findUnique({
        where: { companyId: cmd.companyId },
        select: TERM_SELECT,
      });

      const adjustment = await checkPlanTermAdjustment(tx, cmd, PLAN_TERM_SET_ACTION,
        [cmd.tierKey, branchLimit, employeeLimit, monthlySlipLimit, warningDays, cmd.termStartAt ?? null, cmd.termDays ?? null], existing);
      if (adjustment.replayed) return { term: existing ? toPlanTermDto(existing as PlanTermRow, now) : null,
        sourceVersion: planTermSourceVersion(cmd.companyId, existing), replayed: true };
      if (existing?.billingReceiptAccountId) throw paidPlanReviewRequired();
      if (await tx.billingAccount.findFirst({ where: { companyId: cmd.companyId, activeAttemptId: { not: null } }, select: { id: true } }))
        throw paidPlanReviewRequired();

      const termStartAt = parseDate(cmd.termStartAt, 'termStartAt', now);
      const termDays = cmd.termDays === undefined ? DEFAULT_TERM_DAYS : positiveInt(cmd.termDays, 'termDays');

      const saved = await tx.companyPlanTerm.upsert({
        where: { companyId: cmd.companyId },
        create: {
          companyId: cmd.companyId,
          tierKey: cmd.tierKey,
          branchLimit,
          employeeLimit,
          monthlySlipLimit,
          termStartAt,
          termEndsAt: addDays(termStartAt, termDays),
          warningDays,
          createdByUserId: cmd.requestingAdminUserId,
          updatedByUserId: cmd.requestingAdminUserId,
        },
        update: {
          tierKey: cmd.tierKey,
          branchLimit,
          employeeLimit,
          monthlySlipLimit,
          warningDays,
          updatedByUserId: cmd.requestingAdminUserId,
        },
        select: TERM_SELECT,
      });

      // CRITICAL with before/after values, same shape as set-partner-ai-model: limits and dates
      // are numbers and timestamps, not personal data, so the operator sees exactly what moved.
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: PLAN_TERM_SET_ACTION,
          targetType: 'company_plan_term',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            ...adjustment.audit,
            created: existing === null,
            from: existing ? auditValues(existing as PlanTermRow) : null,
            to: auditValues(saved as PlanTermRow),
          },
        },
      });

      return { term: toPlanTermDto(saved as PlanTermRow, now), sourceVersion: planTermSourceVersion(cmd.companyId, saved) };
    };
    return transaction ? apply(transaction) : this.prisma.client.$transaction(apply);
  }
}

/**
 * The one definition of "give this company a term from a preset", shared by the service method
 * above and by admin onboarding — which calls it directly rather than injecting the use-case, so
 * the onboarding module keeps its current dependency graph.
 *
 * Idempotent by design: an existing row is left exactly as the admin last set it, so re-running
 * provisioning can never shorten a term a customer already paid for.
 */
export async function applyPlanTermPreset(
  prisma: { client: { companyPlanTerm: { upsert(args: unknown): Promise<unknown> } } },
  companyId: string,
  tierKey: PlanTierKey,
  days: number,
  actorUserId: string | null,
): Promise<void> {
  const preset = PLAN_TIER_PRESETS[tierKey];
  const now = new Date();
  await prisma.client.companyPlanTerm.upsert({
    where: { companyId },
    create: {
      companyId,
      tierKey,
      branchLimit: preset.branchLimit,
      employeeLimit: preset.employeeLimit,
      monthlySlipLimit: preset.monthlySlipLimit,
      termStartAt: now,
      termEndsAt: addDays(now, days),
      warningDays: DEFAULT_WARNING_DAYS,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
    update: {},
  });
}

export type RenewCompanyPlanTermCommand = RenewCompanyPlanTermBody & {
  companyId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class RenewCompanyPlanTermUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: PartnerLifecycleTransitionUseCase,
  ) {}

  async execute(cmd: RenewCompanyPlanTermCommand): Promise<CompanyPlanTermViewDto> {
    const days = cmd.days === undefined ? DEFAULT_TERM_DAYS : positiveInt(cmd.days, 'days');
    return this.prisma.client.$transaction(async (tx) => {
      await lockPlanTermCompany(tx, cmd.companyId);
      const now = new Date();

      const existing = await tx.companyPlanTerm.findUnique({
        where: { companyId: cmd.companyId },
        select: TERM_SELECT,
      });
      if (!existing) throw new NotFoundException(`Company "${cmd.companyId}" has no plan term to renew.`);

      const adjustment = await checkPlanTermAdjustment(tx, cmd, PLAN_TERM_RENEW_ACTION, [days], existing);
      if (adjustment.replayed) return { term: toPlanTermDto(existing as PlanTermRow, now),
        sourceVersion: planTermSourceVersion(cmd.companyId, existing), replayed: true };
      if (existing.billingReceiptAccountId || await tx.billingAccount.findFirst({ where: { companyId: cmd.companyId, activeAttemptId: { not: null } }, select: { id: true } }))
        throw paidPlanReviewRequired();

      const company = await tx.company.findUnique({
        where: { id: cmd.companyId },
        select: { status: true },
      });
      if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

      // Extend from whichever is later: renewing early keeps the days already paid for; renewing
      // after expiry starts the new term now rather than back-dating it into the past.
      const base = existing.termEndsAt.getTime() > now.getTime() ? existing.termEndsAt : now;
      // Re-enable ONLY what the term system disabled. A company an admin disabled by hand stays
      // disabled until an admin activates it through the lifecycle route (spec §2 rule 3).
      const reactivate = company.status === 'DISABLED' && existing.termDisabledAt !== null;

      const saved = await tx.companyPlanTerm.update({
        where: { companyId: cmd.companyId },
        data: {
          termEndsAt: addDays(base, days),
          renewCount: { increment: 1 },
          lastRenewedAt: now,
          // The next term gets its own ladder: clearing these is what lets 7/3/1 fire again.
          warn7SentAt: null,
          warn3SentAt: null,
          warn1SentAt: null,
          expiredNotifiedAt: null,
          ...(reactivate ? { termDisabledAt: null } : {}),
          updatedByUserId: cmd.requestingAdminUserId,
        },
        select: TERM_SELECT,
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: PLAN_TERM_RENEW_ACTION,
          targetType: 'company_plan_term',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            ...adjustment.audit,
            from: auditValues(existing as PlanTermRow),
            to: auditValues(saved as PlanTermRow),
            days,
            fromTermEndsAt: existing.termEndsAt.toISOString(),
            toTermEndsAt: saved.termEndsAt.toISOString(),
            fromRenewCount: existing.renewCount,
            toRenewCount: saved.renewCount,
            companyStatusBefore: company.status,
            reactivated: reactivate,
          },
        },
      });

      // Same transaction: activation failure rolls back the term AND its success audit.
      if (reactivate) {
        await this.lifecycle.execute({
          companyId: cmd.companyId,
          targetStatus: 'ACTIVE',
          reason: 'term_renewed',
          requestingAdminUserId: cmd.requestingAdminUserId,
          requestId: cmd.requestId,
        }, tx);
      }

      return { term: toPlanTermDto(saved as PlanTermRow, now), sourceVersion: planTermSourceVersion(cmd.companyId, saved) };
    });
  }
}

/**
 * P10-L §9 "ตรวจแล้ว". The warm-up ceiling exists to bound the damage of a shop nobody has looked
 * at yet; once an operator HAS looked, keeping it on is only friction. Ending it early is a
 * one-column write, so the whole recovery is `warmupUntil = now` — the counter reads `now <
 * warmupUntil` and stops applying it (L-A2), with no second flag to keep in step.
 *
 * Idempotent: a warm-up already over is left exactly where it was, and a company with no term row
 * (grandfathered) has no warm-up to end.
 */
@Injectable()
export class EndPlanTermWarmupUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: {
    companyId: string;
    requestingAdminUserId: string;
    requestId: string;
  }): Promise<CompanyPlanTermViewDto> {
    const now = new Date();
    const existing = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId: cmd.companyId },
      select: TERM_SELECT,
    });
    if (!existing) throw new NotFoundException(`Company "${cmd.companyId}" has no plan term.`);
    // Already past, or never had one: nothing to lift and nothing to record.
    if (!existing.warmupUntil || existing.warmupUntil.getTime() <= now.getTime()) {
      return { term: toPlanTermDto(existing as PlanTermRow, now) };
    }

    const saved = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.companyPlanTerm.update({
        where: { companyId: cmd.companyId },
        data: { warmupUntil: now, updatedByUserId: cmd.requestingAdminUserId },
        select: TERM_SELECT,
      });
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: PLAN_TERM_WARMUP_END_ACTION,
          targetType: 'company_plan_term',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            fromWarmupUntil: existing.warmupUntil!.toISOString(),
            warmupSlipLimit: existing.warmupSlipLimit ?? null,
            monthlySlipLimit: existing.monthlySlipLimit,
          },
        },
      });
      return row;
    });
    return { term: toPlanTermDto(saved as PlanTermRow, now) };
  }
}

export type { PlanTermNoticeDto } from '@watchdog-bms/contracts';

@Injectable()
export class GetPlanTermNoticeUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, roles: readonly string[], permissions: readonly string[] = []): Promise<PlanTermNoticeDto> {
    const row = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { termStartAt: true, termEndsAt: true, warningDays: true, renewCount: true },
    });
    if (!row) return null;
    const { derivedState, daysLeft } = derivePlanTermState(row.termEndsAt, row.warningDays, new Date());
    return {
      derivedState,
      ...(derivedState === 'EXPIRED' && await isFreeExpenseDraftCompany(this.prisma.client, companyId) ? { freeExpenseDrafts: true } : {}),
      termEndsAt: row.termEndsAt.toISOString(),
      daysLeft,
      // R2: the locked shell needs to know whether to invite a purchase or a renewal, and only the
      // term row can tell it apart. Absent while the term still runs, so nothing else changes.
      ...(derivedState === 'EXPIRED' ? { lockReason: planTermLockReason(row) } : {}),
      // Keep actual ownership separate from who may purchase a plan. Staff still get the state so
      // the expired screen can route them to the neutral "ask the shop owner" copy.
      isOwner: roles.includes('OWNER'),
      canManagePlan: permissions.includes('company.plan.manage'),
    };
  }
}

function auditValues(row: PlanTermRow) {
  return {
    tierKey: row.tierKey,
    branchLimit: row.branchLimit,
    employeeLimit: row.employeeLimit,
    monthlySlipLimit: row.monthlySlipLimit,
    warningDays: row.warningDays,
    termStartAt: row.termStartAt.toISOString(),
    termEndsAt: row.termEndsAt.toISOString(),
  };
}

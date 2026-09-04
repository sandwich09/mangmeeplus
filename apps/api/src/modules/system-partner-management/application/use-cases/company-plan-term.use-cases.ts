import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CompanyPlanTermViewDto,
  PlanTierKey,
  RenewCompanyPlanTermBody,
  SetCompanyPlanTermBody,
} from '@watchdog-bms/contracts';
import { PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  DEFAULT_TERM_DAYS,
  DEFAULT_WARNING_DAYS,
  addDays,
  derivePlanTermState,
  isPlanTierKey,
  toPlanTermDto,
  type PlanTermRow,
} from '../../domain/logic/plan-term.logic';
import { PartnerLifecycleTransitionUseCase } from './partner-lifecycle-transition.use-case';

export const PLAN_TERM_SET_ACTION = 'system.company_plan_term.set';
export const PLAN_TERM_RENEW_ACTION = 'system.company_plan_term.renew';
/** 403 code the web client routes to the renewal page on (spec §4B). */
export const COMPANY_TERM_EXPIRED_CODE = 'company_term_expired';

const TERM_SELECT = {
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
} as const;

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
    return { term: row ? toPlanTermDto(row as PlanTermRow, new Date()) : null };
  }
}

export type SetCompanyPlanTermCommand = SetCompanyPlanTermBody & {
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
  async execute(cmd: SetCompanyPlanTermCommand): Promise<CompanyPlanTermViewDto> {
    const company = await this.prisma.client.company.findUnique({
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
    const existing = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId: cmd.companyId },
      select: TERM_SELECT,
    });

    const termStartAt = parseDate(cmd.termStartAt, 'termStartAt', now);
    const termDays = cmd.termDays === undefined ? DEFAULT_TERM_DAYS : positiveInt(cmd.termDays, 'termDays');

    const saved = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.companyPlanTerm.upsert({
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
            created: existing === null,
            from: existing ? auditValues(existing as PlanTermRow) : null,
            to: auditValues(row as PlanTermRow),
          },
        },
      });

      return row;
    });

    return { term: toPlanTermDto(saved as PlanTermRow, now) };
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
    const now = new Date();

    const existing = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId: cmd.companyId },
      select: TERM_SELECT,
    });
    if (!existing) throw new NotFoundException(`Company "${cmd.companyId}" has no plan term to renew.`);

    // Idempotency on requestId, read from the audit trail the renew itself writes — a lost
    // response retried with the same requestId must not buy a second month.
    const replay = await this.prisma.client.auditLog.findFirst({
      where: {
        requestId: cmd.requestId,
        action: PLAN_TERM_RENEW_ACTION,
        targetId: cmd.companyId,
        result: 'SUCCESS',
      },
      select: { id: true },
    });
    if (replay) return { term: toPlanTermDto(existing as PlanTermRow, now) };

    const company = await this.prisma.client.company.findUnique({
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

    const saved = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.companyPlanTerm.update({
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
            days,
            fromTermEndsAt: existing.termEndsAt.toISOString(),
            toTermEndsAt: row.termEndsAt.toISOString(),
            fromRenewCount: existing.renewCount,
            toRenewCount: row.renewCount,
            companyStatusBefore: company.status,
            reactivated: reactivate,
          },
        },
      });

      return row;
    });

    // After the dates commit, never before: a re-activation that outlived a rolled-back renew
    // would hand back a company whose term is still expired.
    if (reactivate) {
      await this.lifecycle.execute({
        companyId: cmd.companyId,
        targetStatus: 'ACTIVE',
        reason: 'term_renewed',
        requestingAdminUserId: cmd.requestingAdminUserId,
        requestId: cmd.requestId,
      });
    }

    return { term: toPlanTermDto(saved as PlanTermRow, now) };
  }
}

/** Minimal user-facing payload: state and deadline only, never limits or tier (spec §5). */
export type PlanTermNoticeDto = {
  derivedState: 'ACTIVE' | 'WARNING' | 'EXPIRED';
  termEndsAt: string;
  daysLeft: number;
  isOwner: boolean;
} | null;

@Injectable()
export class GetPlanTermNoticeUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, roles: readonly string[]): Promise<PlanTermNoticeDto> {
    const row = await this.prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { termEndsAt: true, warningDays: true },
    });
    if (!row) return null;
    const { derivedState, daysLeft } = derivePlanTermState(row.termEndsAt, row.warningDays, new Date());
    return {
      derivedState,
      termEndsAt: row.termEndsAt.toISOString(),
      daysLeft,
      // The banner is OWNER-only (Owner 2026-08-30); staff still get the state so the expired
      // screen can route them to the neutral "ask the shop owner" copy.
      isOwner: roles.includes('OWNER'),
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

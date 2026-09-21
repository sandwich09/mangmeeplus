import { UnprocessableEntityException } from '@nestjs/common';
import { branchLimitMessageTh, employeeLimitMessageTh } from '../domain/logic/plan-term.logic';
import { currentCapacityOverride } from '../domain/logic/plan-capacity';

/**
 * P29 §4D — the two create-side quota gates.
 *
 * Both are deliberately shaped the same way and both fail OPEN when the company has no
 * `CompanyPlanTerm` row: a company that predates P29 is grandfathered unlimited (spec §2 rule 7)
 * and must not notice this code exists. Nothing here ever touches an existing branch, membership
 * or employee — a company already over a newly-lowered limit keeps everything it has and is only
 * blocked from adding more (spec §2 rule 2).
 */
type LimitPrisma = {
  client: {
    companyPlanTerm: { findUnique(args: unknown): Promise<{ branchLimit: number; employeeLimit: number; capacityOverride?: unknown;
      billingReceiptAccountId?: string|null; termEndsAt?: Date; termDisabledAt?: Date|null } | null> };
    branch: { count(args: unknown): Promise<number> };
    companyMembership: { count(args: unknown): Promise<number> };
  };
};

/** A company-created role with the same name cannot turn a paid seat into platform access. */
export const PLATFORM_SEAT_EXEMPT_ROLE = { key: 'SYSTEM_ADMIN', status: 'ACTIVE', isSystem: true, scopeKey: 'system', companyId: null } as const;

async function planLimits(prisma: LimitPrisma, companyId: string) {
  const term = await prisma.client.companyPlanTerm.findUnique({
    where: { companyId },
    select: { branchLimit: true, employeeLimit: true, capacityOverride: true, billingReceiptAccountId: true, termEndsAt: true, termDisabledAt: true },
  });
  const temporary = term && currentCapacityOverride(term);
  return temporary ?? term;
}

export async function assertBranchLimit(prisma: LimitPrisma, companyId: string): Promise<void> {
  const term = await planLimits(prisma, companyId);
  if (!term) return; // no term row = unlimited
  const active = await prisma.client.branch.count({ where: { companyId, status: 'ACTIVE' } });
  if (active >= term.branchLimit) {
    throw new UnprocessableEntityException({
      code: 'plan_branch_limit_exceeded',
      message: branchLimitMessageTh(term.branchLimit),
      details: { limit: term.branchLimit, active },
    });
  }
}

export async function assertEmployeeLimit(prisma: LimitPrisma, companyId: string): Promise<void> {
  const term = await planLimits(prisma, companyId);
  if (!term) return; // no term row = unlimited
  // SYSTEM_ADMIN memberships are platform staff, never a seat the company bought.
  const active = await prisma.client.companyMembership.count({
    where: { companyId, status: 'ACTIVE', roles: { none: { role: PLATFORM_SEAT_EXEMPT_ROLE } } },
  });
  if (active >= term.employeeLimit) {
    throw new UnprocessableEntityException(employeeLimitMessageTh(term.employeeLimit));
  }
}

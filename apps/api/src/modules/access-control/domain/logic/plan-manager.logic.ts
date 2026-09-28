// Spec: docs/specs/mangmee-purchase-without-setup-spec-th.md §18.2 R-C11 (Owner D-PF-10): LINE and the
// web answer "who may manage this shop's package" with ONE predicate — an ACTIVE member whose ACTIVE
// role grants `company.plan.manage` — the same rule billing.service.ts assertOwner enforces for
// purchases. OWNER holds every company permission (permission-registry.ts ROLE_GRANTS), so owners
// keep passing; a custom role with the permission now passes too. Plain functions, no Nest wiring.

export const PLAN_MANAGE_PERMISSION_KEY = 'company.plan.manage';

type RoleWithPermissions = {
  status?: string | null;
  permissions?: ReadonlyArray<{ permission: { key: string } }> | null;
};
type MembershipRoleRow = { role?: RoleWithPermissions | null } | null | undefined;

export type PlanManagerDb = {
  companyMembership: { findMany(args: any): Promise<any[]> };
  externalIdentity?: { findMany(args: any): Promise<any[]> };
};

/** Prisma `CompanyMembershipWhereInput` fragment; spread it beside `companyId`/`status`. */
export function planManagerRoleFilter() {
  return {
    roles: { some: { role: { status: 'ACTIVE' as const, permissions: { some: { permission: { key: PLAN_MANAGE_PERMISSION_KEY } } } } } },
  };
}

/** Over loaded rows. A role without `status` is one the caller already filtered to ACTIVE. */
export function canManagePlan(roles: ReadonlyArray<MembershipRoleRow> | null | undefined): boolean {
  return (roles ?? []).some((entry) => !!entry?.role
    && (entry.role.status ?? 'ACTIVE') === 'ACTIVE'
    && (entry.role.permissions ?? []).some((rp) => rp.permission.key === PLAN_MANAGE_PERMISSION_KEY));
}

export async function planManagersOf(db: PlanManagerDb, companyId: string): Promise<Array<{ userId: string }>> {
  return db.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' }, ...planManagerRoleFilter() },
    select: { userId: true },
  });
}

/** Sibling of ownerLineUserIds (package-change-decision.use-case.ts), which stays OWNER-based for support replies. */
export async function planManagerLineUserIds(db: PlanManagerDb, companyId: string, channelId: string): Promise<string[]> {
  const managers = await planManagersOf(db, companyId);
  if (managers.length === 0 || !db.externalIdentity) return [];
  const identities = await db.externalIdentity.findMany({
    where: { userId: { in: managers.map((m) => m.userId) }, provider: 'LINE', providerChannelId: channelId, status: 'ACTIVE' },
    select: { providerUserId: true },
  });
  return [...new Set(identities.map((identity: { providerUserId: string }) => identity.providerUserId))];
}

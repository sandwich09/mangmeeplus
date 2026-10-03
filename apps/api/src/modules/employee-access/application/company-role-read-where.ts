import type { Prisma } from '../../../generated/prisma/client';

/** The demo overview role explains an existing membership; it is not a shop role to choose. */
export function companyRoleReadWhere(companyId: string): Prisma.RoleWhereInput {
  return {
    OR: [{ scopeKey: 'system' }, { scopeKey: companyId }],
    AND: [{ OR: [
      { key: { not: 'COMPANY_VIEW' } },
      { memberships: { some: { membership: { companyId } } } },
    ] }],
  };
}

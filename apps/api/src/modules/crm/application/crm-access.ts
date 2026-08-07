import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { crmCanReadAll, crmCanManageAll } from '../domain/logic/crm.logic';

/** Throws unless the caller holds the permission. */
export function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

/**
 * Read access to a single owned record. Read-context roles see all company
 * records; everyone else (SALES) is scoped to owned/assigned records.
 */
export function assertCanReadOwned(ctx: RequestContext, ownerUserId?: string | null): void {
  if (crmCanReadAll(ctx.roles)) return;
  if (ownerUserId && ownerUserId === ctx.userId) return;
  throw new ForbiddenException('Record is out of scope');
}

/**
 * Mutation access to a single owned record. Admin/Owner manage all; other
 * roles may mutate only explicitly owned/assigned records until team ABAC lands.
 */
export function assertCanManageOwned(ctx: RequestContext, ownerUserId?: string | null): void {
  if (crmCanManageAll(ctx.roles)) return;
  if (ownerUserId && ownerUserId === ctx.userId) return;
  throw new ForbiddenException('Record is out of scope');
}

/** When the caller cannot read all, restrict list queries to their own records. */
export function ownerScopeForList(ctx: RequestContext, requested?: 'own' | 'all'): string | undefined {
  if (!crmCanReadAll(ctx.roles) || requested === 'own') return ctx.userId;
  return undefined;
}

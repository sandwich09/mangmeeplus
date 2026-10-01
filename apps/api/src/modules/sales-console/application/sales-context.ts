/**
 * Shared boundary helpers for the sales console.
 *
 * Spec §10: every endpoint here is reachable ONLY through a membership in the platform tenant.
 * The permission gate alone is not the whole guard — a company-scoped custom role could in
 * principle be named the same thing inside a customer company, and that must not become platform
 * authority (the same reasoning as PLATFORM_SEAT_EXEMPT_ROLE in plan-term-limit.ts).
 */
import {
  BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import type { SalesErrorCode } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';

/**
 * The one platform tenant. Fixed id, not config: `seed.ts`, `add-system-admin.ts` and the
 * production bootstrap `reset-system-admin-password.ts` all write this exact company.
 */
export const PLATFORM_TENANT_ID = 'seed-watchdog-system-company';

export const SALES_LEAD_ROLE = 'MANGMEE_SALES_LEAD';
export const SALES_AGENT_ROLE = 'MANGMEE_SALES';
export const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';

/** Error bodies shaped exactly like billing's, so one web map covers both (`billingError`). */
export function salesError(code: SalesErrorCode, message: string): ConflictException {
  return new ConflictException({ code, message });
}
export function salesBadRequest(code: SalesErrorCode, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}
export function salesNotFound(code: SalesErrorCode, message: string): NotFoundException {
  return new NotFoundException({ code, message });
}
export function salesForbidden(code: SalesErrorCode, message: string): ForbiddenException {
  return new ForbiddenException({ code, message });
}

export function assertPlatformTenant(ctx: RequestContext): void {
  if (ctx.companyId !== PLATFORM_TENANT_ID) {
    // Deliberately not a sales code: this is "you are not in the platform tenant at all", which
    // no sales-console client can act on and no customer should be able to probe.
    throw new ForbiddenException('sales_console_platform_tenant_required');
  }
}

/** A lead and the Owner see every team's deals; an agent sees only their own (R11). */
export function canSeeAllDeals(ctx: RequestContext): boolean {
  return ctx.roles.includes(SALES_LEAD_ROLE) || ctx.roles.includes(SYSTEM_ADMIN_ROLE);
}

export function isSystemAdmin(ctx: RequestContext): boolean {
  return ctx.roles.includes(SYSTEM_ADMIN_ROLE);
}

/**
 * RB-36: suspending an agent keeps the membership and the role (the lead still reads that agent's
 * deals) and only revokes the sessions of that moment, so a fresh login walked straight back in.
 * This is the one place the status refuses the console: on every sales controller, read per
 * request, so reactivating restores access with nothing to re-grant.
 *
 * A caller with no agent profile (the Owner, a lead created outside the console) passes.
 * SYSTEM_ADMIN is exempt outright: the console that lifts a suspension must not be lockable by one.
 */
@Injectable()
export class SalesAgentActiveGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp().getRequest<{ context: RequestContext }>().context;
    if (isSystemAdmin(ctx)) return true;
    const profile = await this.prisma.client.salesAgentProfile.findUnique({
      where: { userId: ctx.userId }, select: { status: true },
    });
    if (profile && profile.status !== 'ACTIVE') throw salesForbidden('SALES_AGENT_SUSPENDED', 'บัญชีทีมขายถูกระงับ');
    return true;
  }
}

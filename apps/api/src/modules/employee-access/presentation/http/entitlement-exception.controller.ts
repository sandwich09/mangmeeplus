/**
 * UAT r7 P0-5 — internal staff surface for normalization dependency exceptions (spec:232-238).
 *
 * Same shape as the launch control plane (`launch-gate.controller.ts`): `/v1/system/*` is the
 * platform-authority surface, its permissions live under `system.`, and `COMPANY_PERMISSION_KEYS`
 * excludes every `system.` key — so no tenant role, partner-facing role, customer role or
 * AI-delegated actor context can hold them, and the deny-by-default guard rejects those callers
 * before the handler runs. There is deliberately NO customer-facing route: the exception is resolved
 * FOR the company, never by asking it (spec:232, zero user interaction).
 *
 * UAT r8 A5 — `system.entitlement_exception.manage` is its OWN authority, not a reuse of
 * `system.partner_feature.manage`. This is the one command that writes entitlements while
 * normalization is pending, which is precisely the state that FREEZES the ordinary partner command
 * (set-partner-features.use-case.ts:82) — so the two are not the same power, and reusing one key
 * meant it could never be granted or withdrawn on its own. It is seeded to the same role that holds
 * the partner key, so nothing changes about who can do this today.
 */
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  ENTITLEMENT_EXCEPTION_RESOLUTIONS,
  EntitlementExceptionUseCase,
  type EntitlementExceptionResolution,
} from '../../application/use-cases/entitlement-exception.use-case';

class ResolveEntitlementExceptionBodyDto {
  @IsString() @IsNotEmpty() companyId!: string;
  @IsIn([...ENTITLEMENT_EXCEPTION_RESOLUTIONS]) action!: EntitlementExceptionResolution;
  /** The `snapshotHash` from the listing — the CAS fence, so a stale screen cannot decide. */
  @Matches(/^[0-9a-f]{64}$/) expectedSnapshotHash!: string;
  /** REQUIRED by the use case for DISABLE_DEPENDENT; that check states the reason, not this DTO. */
  @IsString() @IsOptional() @IsNotEmpty() evidenceRef?: string;
  @IsString() @IsOptional() @IsNotEmpty() reason?: string;
}

type AuthedRequest = Request & { context: RequestContext };

@ApiTags('system-entitlement-exceptions')
@Controller('system/entitlement-exceptions')
export class EntitlementExceptionController {
  constructor(private readonly exceptions: EntitlementExceptionUseCase) {}

  @Get()
  @RequirePermissions('system.entitlement_exception.manage')
  @ApiOperation({ summary: 'Companies blocked on an entitlement dependency, with Thai feature names' })
  @ApiResponse({ status: 200 })
  list() {
    return this.exceptions.list();
  }

  @Post('resolve')
  @HttpCode(200)
  @RequirePermissions('system.entitlement_exception.manage')
  @ApiOperation({ summary: 'Resolve one exception: enable the prerequisite, or disable the dependents' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No open dependency exception for that company' })
  @ApiResponse({ status: 409, description: 'The reviewed snapshot moved, or it is already resolved' })
  @ApiResponse({ status: 422, description: 'DISABLE_DEPENDENT without contract evidence' })
  resolve(@Body() dto: ResolveEntitlementExceptionBodyDto, @Req() req: AuthedRequest) {
    return this.exceptions.resolve({
      companyId: dto.companyId,
      action: dto.action,
      expectedSnapshotHash: dto.expectedSnapshotHash,
      ...(dto.evidenceRef ? { evidenceRef: dto.evidenceRef } : {}),
      ...(dto.reason ? { reason: dto.reason } : {}),
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}

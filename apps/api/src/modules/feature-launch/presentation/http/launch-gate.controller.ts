/**
 * Internal launch control plane (spec:55, AC29, runbook §1-2).
 *
 * `/v1/system/*` is the platform-authority surface: its permissions live under `system.` and
 * `COMPANY_PERMISSION_KEYS` excludes every `system.` key, so no tenant role, partner-facing role,
 * customer role or AI-delegated actor context can ever hold them — the deny-by-default guard
 * rejects those callers before the handler runs. There is deliberately NO customer/partner/AI
 * route to gate state, and no per-tenant scope on this controller at all.
 */
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { GetLaunchHealthUseCase } from '../../application/use-cases/get-launch-health.use-case';
import { LaunchGateCommandUseCase } from '../../application/use-cases/launch-gate-command.use-case';

class ControlPlaneSnapshotDto {
  // P0-3: environment, build and every approver id are EXPECTED values. The server derives the
  // real ones from the deployment and the authenticated actor; a mismatch is rejected, an omission
  // is filled in. Nothing here can establish authority.
  @IsString() @IsOptional() @IsNotEmpty() targetEnvironment?: string;
  @IsString() @IsOptional() @IsNotEmpty() buildReleaseId?: string;
  @IsInt() @Min(0) expectedGeneration!: number;
  @IsString() @IsOptional() @IsNotEmpty() validationEvidenceRef?: string;
  @IsString() @IsOptional() @IsNotEmpty() validationEvidenceHash?: string;
  @IsString() @IsOptional() @IsNotEmpty() specialistApprovedByUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() releaseApprovedByUserId?: string;
  @IsBoolean() @IsOptional() emergencyClose?: boolean;
  @IsString() @IsOptional() @IsNotEmpty() emergencyAuthorityUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() incidentRef?: string;
}

class LaunchGateCommandBodyDto {
  @IsString() @IsNotEmpty() gateKey!: string;
  @IsString() @IsNotEmpty() routeKey!: string;
  @IsIn(['OPEN', 'CLOSE']) action!: 'OPEN' | 'CLOSE';
  /** Idempotency key; falls back to the request id when the caller omits it. */
  @IsString() @IsOptional() @IsNotEmpty() commandId?: string;
  @IsString() @IsOptional() @IsNotEmpty() reason?: string;
  @ValidateNested() @Type(() => ControlPlaneSnapshotDto) snapshot!: ControlPlaneSnapshotDto;
}

type AuthedRequest = Request & { context: RequestContext };

@Controller('system/launch-gates')
export class LaunchGateController {
  constructor(
    private readonly gateCommand: LaunchGateCommandUseCase,
    private readonly launchHealth: GetLaunchHealthUseCase,
  ) {}

  @Post('commands')
  @HttpCode(200)
  @RequirePermissions('system.launch_gate.manage')
  @ApiOperation({ summary: 'Internal control plane: OPEN/CLOSE one exact launch route' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'Command key reuse, or a stale expected generation' })
  @ApiResponse({ status: 422, description: 'Unknown route, blocked route, or an invalid snapshot shape' })
  command(@Body() dto: LaunchGateCommandBodyDto, @Req() req: AuthedRequest) {
    return this.gateCommand.execute({
      gateKey: dto.gateKey,
      routeKey: dto.routeKey,
      action: dto.action,
      commandId: dto.commandId ?? req.context.requestId,
      actorUserId: req.context.userId,
      // The use case re-checks role + permission itself; the guard above is the first of the two.
      actorRoles: req.context.roles ?? [],
      actorPermissions: req.context.permissions ?? [],
      requestId: req.context.requestId,
      reason: dto.reason,
      snapshot: dto.snapshot,
    });
  }

  @Get('health')
  @RequirePermissions('system.launch_gate.read')
  @ApiOperation({ summary: 'Internal launch-health view (tenant-anonymous, read-only)' })
  @ApiResponse({ status: 200 })
  health() {
    return this.launchHealth.execute();
  }
}

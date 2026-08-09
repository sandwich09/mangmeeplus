import { Body, Controller, Param, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SetSharedLineCredentialUseCase } from '../../application/use-cases/set-shared-line-credential.use-case';

class SetSharedLineCredentialBodyDto {
  @IsString() @IsNotEmpty() channelId!: string;
  @IsString() @IsNotEmpty() channelSecret!: string;
  @IsString() @IsOptional() accessToken?: string;
}

type AuthedRequest = Request & { context: RequestContext };

/**
 * Shared LINE credential endpoint — reachable by nobody today, on purpose (audit H-14, owner
 * decision 2026-08-10).
 *
 * `system.shared_line_credential.manage` below is NOT in the permission registry, so this answers
 * 403 to every caller including SYSTEM_ADMIN, whose grants are an explicit list rather than a
 * wildcard. Granting the row by hand does not survive either: sync-permissions revokes grants on
 * system roles that the registry does not declare.
 *
 * That is left standing rather than repaired, because repairing only the permission would be worse
 * than the 403. The LINE webhook verifies signatures with `config.lineMessagingChannelSecret` — the
 * value from AWS/env — and never reads what this endpoint writes. An operator would save
 * successfully, see a green result, and believe a credential had been rotated when nothing had
 * changed. Rotation stays where it works: update the secret in AWS/env and redeploy.
 *
 * Re-enabling means doing both together — declare and grant the permission, AND make the webhook
 * read the stored credential ahead of AWS/env with cache invalidation on write. The web entry
 * points are commented out to match; see SharedLineSettingsPage.
 */
@Controller('system/line')
export class SystemLineController {
  constructor(private readonly setCredential: SetSharedLineCredentialUseCase) {}

  @Put('shared-credentials/:credentialKind')
  @RequirePermissions('system.shared_line_credential.manage')
  @ApiOperation({ summary: 'Create/replace WatchDog shared LINE credential (platform-level)' })
  @ApiResponse({ status: 200, description: 'Metadata only; no secret fields returned' })
  setSharedCredential(
    @Param('credentialKind') credentialKind: string,
    @Body() dto: SetSharedLineCredentialBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setCredential.execute({
      credentialKind: credentialKind as 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF',
      channelId: dto.channelId,
      channelSecret: dto.channelSecret,
      accessToken: dto.accessToken,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}

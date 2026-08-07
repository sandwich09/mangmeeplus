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

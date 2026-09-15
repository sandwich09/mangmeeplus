import { BadRequestException, Body, Controller, Get, HttpException, Param, Put, Req } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { RedisRateLimitService } from '../../../../common/security/redis-rate-limit.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SetSharedLineCredentialUseCase } from '../../application/use-cases/set-shared-line-credential.use-case';

class SetSharedLineCredentialBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(50) channelId!: string;
  @IsString() @MinLength(16) @MaxLength(1024) channelSecret!: string;
  @IsString() @MinLength(16) @MaxLength(4096) accessToken!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsUUID('4') rotationId!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(1024) password!: string;
}

type AuthedRequest = Request & { context: RequestContext };
@Controller('system/line')
export class SystemLineController {
  constructor(private readonly setCredential: SetSharedLineCredentialUseCase, private readonly limits: RedisRateLimitService) {}

  @Get('shared-credentials')
  @RequirePermissions('system.shared_line_credential.manage')
  read(@Req() req: AuthedRequest) { return this.setCredential.read(req.context); }

  @Put('shared-credentials/:credentialKind')
  @RequirePermissions('system.shared_line_credential.manage')
  async setSharedCredential(@Param('credentialKind') kind: string, @Body() dto: SetSharedLineCredentialBodyDto, @Req() req: AuthedRequest) {
    if (kind !== 'LINE_MESSAGING_API') throw new BadRequestException({ code: 'LINE_CREDENTIAL_KIND_UNSUPPORTED', message: 'หน้านี้รองรับการเปลี่ยนกุญแจ Messaging ของ OA เดิมเท่านั้น' });
    const limit = await this.limits.consume('line-credential-publication', req.context.userId, 10, 300);
    if (!limit.allowed) throw new HttpException({ code: 'LINE_CREDENTIAL_RATE_LIMIT', message: 'ลองหลายครั้งแล้ว กรุณารอสักครู่แล้วโหลดสถานะล่าสุด', retryAfterSeconds: limit.retryAfterSeconds }, 429);
    return this.setCredential.execute(req.context, dto);
  }
}

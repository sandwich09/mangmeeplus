import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../../../common/security/public.decorator';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import type { RequestContext } from '../domain/models/request-context.model';
import { PlatformAccessService } from '../application/platform-access.service';

class SetPlatformAccessDto {
  @IsIn(['OPEN', 'CLOSED']) state!: 'OPEN' | 'CLOSED';
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

@Controller('auth/platform-access')
export class PublicPlatformAccessController {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  @Public()
  @Get()
  async status() {
    const status = await this.platformAccess.getStatus();
    return { state: status.effectiveState };
  }
}

@Controller('system/platform-access')
@RequirePermissions('system.launch_gate.manage')
export class SystemPlatformAccessController {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  @Get()
  status() {
    return this.platformAccess.getStatus();
  }

  @Put()
  update(
    @Body() dto: SetPlatformAccessDto,
    @Req() req: { context: RequestContext },
  ) {
    return this.platformAccess.setState({
      state: dto.state,
      reason: dto.reason,
      actorUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}

import { BadRequestException, Controller, Get, Header, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EMAIL_DELIVERY_PURPOSES, type EmailDeliveryPurpose } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import type { RequestContext } from '../domain/models/request-context.model';
import { SystemEmailDeliveryService } from '../application/system-email-delivery.service';

export class SystemEmailHistoryQueryDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(512) cursor?: string;
  @IsOptional() @IsIn(EMAIL_DELIVERY_PURPOSES) purpose?: EmailDeliveryPurpose;
  @IsOptional() @IsIn(['1']) review?: '1';
}

@Controller('system/email-delivery')
@RequirePermissions('system.email_delivery.read')
export class SystemEmailDeliveryController {
  constructor(private readonly delivery: SystemEmailDeliveryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  history(@Req() req: { context: RequestContext }, @Query() query: SystemEmailHistoryQueryDto) {
    return this.delivery.history(req.context, query);
  }

  @Get('connection')
  @Header('Cache-Control', 'no-store')
  connection(@Req() req: { context: RequestContext }, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException();
    return this.delivery.connection(req.context);
  }
}

import { BadRequestException, Body, Controller, Get, Header, Put, Query, Req } from '@nestjs/common';
import { IsBoolean, IsInt, IsUUID, Max, Min, MinLength, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EMAIL_DELIVERY_PURPOSES, type EmailHistoryPolicyInput, type EmailDeliveryPurpose } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import type { RequestContext } from '../domain/models/request-context.model';
import { SystemEmailDeliveryService } from '../application/system-email-delivery.service';

export class EmailHistoryPolicyDto implements EmailHistoryPolicyInput {
  @IsString() @MinLength(1) @MaxLength(128) scopeKey!: string;
  @IsInt() @Min(0) version!: number;
  @IsInt() @Min(1) @Max(3650) retentionDays!: number;
  @IsBoolean() enabled!: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsUUID() commandId!: string;
}

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
  @Get('retention')
  @Header('Cache-Control', 'no-store')
  retention(@Req() req: { context: RequestContext }, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException();
    return this.delivery.retention(req.context);
  }

  @Put('retention')
  @RequirePermissions('system.email_delivery.read', 'system.email_delivery.manage')
  @Header('Cache-Control', 'no-store')
  setRetention(@Req() req: { context: RequestContext }, @Body() input: EmailHistoryPolicyDto, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException();
    return this.delivery.setRetention(req.context, input);
  }

}

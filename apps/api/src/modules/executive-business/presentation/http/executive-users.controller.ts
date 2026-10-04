import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, Header, HttpCode, HttpException, Param, Post, Query, Req, UseFilters } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { EXECUTIVE_ACCOUNT_STATUSES, type ExecutiveAccountStatus, type ExecutiveUserCreateBody, type ExecutiveUserAccessBody, type ExecutiveUserStatusBody, type ExecutiveUserReasonBody, type ExecutiveUserListQuery } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertPlatformTenant } from '../../../sales-console/application/sales-context';
import { ExecutiveUsersService, executiveError } from '../../application/executive-users.service';

export class ExecutiveUserCreateDto implements ExecutiveUserCreateBody {
  @IsString() @Matches(/^[a-zA-Z0-9._-]{3,40}$/) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsOptional() @IsString() @MaxLength(20) phoneNumber?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsBoolean() canExport!: boolean;
  @IsBoolean() canSeeContacts!: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() canManageCompanyNote?: boolean;
}
export class ExecutiveUserCredentialDto implements ExecutiveUserReasonBody {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class ExecutiveUserStatusDto extends ExecutiveUserCredentialDto implements ExecutiveUserStatusBody {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: 'ACTIVE' | 'SUSPENDED';
}
export class ExecutiveUserAccessDto extends ExecutiveUserCredentialDto implements ExecutiveUserAccessBody {
  @IsBoolean() canExport!: boolean;
  @IsBoolean() canSeeContacts!: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() canManageCompanyNote?: boolean;
}
export class ExecutiveUserListQueryDto implements ExecutiveUserListQuery {
  @IsOptional() @IsString() @MaxLength(320) q?: string;
  @IsOptional() @IsIn(EXECUTIVE_ACCOUNT_STATUSES) status?: ExecutiveAccountStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

type ExecutiveRequest = Request & { context: RequestContext };

/** Give the existing validation/permission/platform gates the executive error envelope. */
@Catch(HttpException)
export class ExecutiveAccountExceptionFilter implements ExceptionFilter {
  /** The words of a 403 on this controller's page; the code is EXECUTIVE_ACCESS_DENIED on every executive route. */
  constructor(private readonly deniedMessage?: string) {}

  catch(error: HttpException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<ExecutiveRequest>();
    const status = error.getStatus();
    const payload = error.getResponse();
    const requestId = req.context?.requestId ?? String(req.headers['x-request-id'] ?? '');
    const mapped = status === 403 ? executiveError(requestId, 'EXECUTIVE_ACCESS_DENIED', undefined, this.deniedMessage)
      : status === 400 && !(typeof payload === 'object' && 'code' in payload)
        ? executiveError(requestId, req.method === 'GET' ? 'EXECUTIVE_QUERY_INVALID' : 'INVALID_INPUT') : error;
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    http.getResponse<Response>().status(mapped.getStatus()).json(mapped.getResponse());
  }
}

@Controller('system/executive-users')
@UseFilters(new ExecutiveAccountExceptionFilter())
export class ExecutiveUsersController {
  constructor(private readonly users: ExecutiveUsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  list(@Query() query: ExecutiveUserListQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.list(req.context, query);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  create(@Body() dto: ExecutiveUserCreateDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.create(req.context, dto);
  }

  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  detail(@Param('userId') userId: string, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.detail(req.context, userId);
  }

  @Post(':userId/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  status(@Param('userId') userId: string, @Body() dto: ExecutiveUserStatusDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.setStatus(req.context, userId, dto);
  }

  @Post(':userId/credential')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  credential(@Param('userId') userId: string, @Body() dto: ExecutiveUserCredentialDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.resetCredential(req.context, userId, dto);
  }

  @Post(':userId/access')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive_user.manage')
  access(@Param('userId') userId: string, @Body() dto: ExecutiveUserAccessDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.users.setAccess(req.context, userId, dto);
  }
}

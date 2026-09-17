import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { LookupUsersUseCase } from '../../application/use-cases/lookup-users.use-case';

/** Person-centric counterpart to the per-company partner console, under the same permission as
 *  the member list it reads the same facts from. No route param is named `companyId`: the guard
 *  treats that as tenant scope, and a system admin is never a member of the customer company. */
@Controller('system/users')
export class SystemUserLookupController {
  constructor(private readonly lookupUsers: LookupUsersUseCase) {}

  @Get('lookup')
  @RequirePermissions('system.partner_member.read')
  @ApiOperation({ summary: 'Look up a person by email, username or name across every company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 422, description: 'q is shorter than 2 or longer than 120 characters' })
  lookup(@Query('q') q?: string, @Query('status') status?: string) {
    return this.lookupUsers.execute(q, status);
  }
}

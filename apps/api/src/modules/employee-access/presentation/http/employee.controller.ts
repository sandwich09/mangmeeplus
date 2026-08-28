import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateEmployeeDto, SetEmployeeStatusDto, UpdateEmployeeDto } from './employee-access.dtos';
import { ListEmployeesUseCase } from '../../application/use-cases/list-employees.use-case';
import { GetEmployeeUseCase } from '../../application/use-cases/get-employee.use-case';
import { CreateEmployeeUseCase } from '../../application/use-cases/create-employee.use-case';
import { UpdateEmployeeUseCase } from '../../application/use-cases/update-employee.use-case';
import { SetEmployeeStatusUseCase } from '../../application/use-cases/set-employee-status.use-case';
import { DeleteEmployeeDraftUseCase } from '../../application/use-cases/delete-employee-draft.use-case';
import { RegenerateEmployeeCredentialUseCase } from '../../application/use-cases/regenerate-employee-credential.use-case';
import { IssueEmployeeLineLinkTokenUseCase } from '../../application/use-cases/issue-employee-line-link-token.use-case';
import { RevokeEmployeeLineLinkTokenUseCase } from '../../application/use-cases/revoke-employee-line-link-token.use-case';

@ApiTags('settings-employees')
@Controller('companies/:companyId/settings/employees')
export class EmployeeController {
  constructor(
    private readonly listEmployees: ListEmployeesUseCase,
    private readonly getEmployee: GetEmployeeUseCase,
    private readonly createEmployee: CreateEmployeeUseCase,
    private readonly updateEmployee: UpdateEmployeeUseCase,
    private readonly setEmployeeStatus: SetEmployeeStatusUseCase,
    private readonly regenerateCredential: RegenerateEmployeeCredentialUseCase,
    private readonly issueLineLinkToken: IssueEmployeeLineLinkTokenUseCase,
    private readonly revokeLineLinkToken: RevokeEmployeeLineLinkTokenUseCase,
    private readonly deleteEmployeeDraft: DeleteEmployeeDraftUseCase,
  ) {}

  @Get()
  @RequirePermissions('access.employee.read')
  @ApiOperation({ summary: 'List employee access profiles' })
  list(@ReqCtx() ctx: RequestContext) {
    return this.listEmployees.execute(ctx.companyId);
  }

  @Get(':employeeId')
  @RequireAnyPermission('access.employee.read', 'access.employee.update')
  @ApiOperation({ summary: 'Get employee access profile detail' })
  get(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.getEmployee.execute(ctx.companyId, employeeId);
  }

  @Post()
  @RequirePermissions('access.employee.create')
  @ApiOperation({ summary: 'Create employee access (user, membership, role, temporary password, LINE link QR)' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateEmployeeDto, @Req() req: Request) {
    return this.createEmployee.execute({
      companyId: ctx.companyId,
      requestingUserId: ctx.userId,
      requesterPermissions: ctx.permissions,
      requesterEntitlementDeniedPermissions: ctx.entitlementDeniedPermissions,
      requesterRoles: ctx.roles,
      requestId: ctx.requestId,
      apiBaseUrl: trustedPublicApiBase(req),
      ...body,
    });
  }

  @Post(':employeeId/complete')
  @RequirePermissions('access.employee.create')
  @ApiOperation({ summary: 'Complete an employee draft and activate its company membership' })
  complete(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.createEmployee.completeDraft({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requesterBranchIds: ctx.scopes.branchIds,
      requestId: ctx.requestId,
    });
  }

  @Patch(':employeeId')
  @RequirePermissions('access.employee.update')
  @ApiOperation({ summary: 'Update employee profile, identity, role, and branch assignment' })
  update(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string, @Body() body: UpdateEmployeeDto) {
    return this.updateEmployee.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
      ...body,
      requesterPermissions: ctx.permissions,
      requesterEntitlementDeniedPermissions: ctx.entitlementDeniedPermissions,
      requesterRoles: ctx.roles,
      requesterBranchIds: ctx.scopes.branchIds,
    });
  }

  @Post(':employeeId/disable')
  @RequirePermissions('access.employee.disable')
  @ApiOperation({ summary: 'Disable or suspend employee access' })
  disable(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string, @Body() body: SetEmployeeStatusDto) {
    return this.setEmployeeStatus.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requesterPermissions: ctx.permissions,
      requestId: ctx.requestId,
      status: body.status ?? 'DISABLED',
      reason: body.reason,
    });
  }

  @Delete(':employeeId/draft')
  @HttpCode(204)
  @RequirePermissions('access.employee.disable')
  @ApiOperation({ summary: 'Delete an unfinished company employee draft, preserving its login account' })
  deleteDraft(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.deleteEmployeeDraft.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requesterPermissions: ctx.permissions,
      requestId: ctx.requestId,
    });
  }

  @Post(':employeeId/credentials/regenerate')
  @RequirePermissions('access.employee.credential.issue')
  @ApiOperation({ summary: 'Regenerate a one-time temporary password for the employee' })
  regenerate(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.regenerateCredential.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
    });
  }

  @Post(':employeeId/line-link-token')
  @RequirePermissions('access.employee.line_link.issue')
  @ApiOperation({ summary: 'Issue a short-lived LINE account-link QR/URL package' })
  issueLineLink(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string, @Req() req: Request) {
    return this.issueLineLinkToken.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
      apiBaseUrl: trustedPublicApiBase(req),
    });
  }

  @Post(':employeeId/line-link-token/revoke')
  @RequirePermissions('access.employee.line_link.revoke')
  @ApiOperation({ summary: 'Revoke any pending LINE account-link token for the employee' })
  revokeLineLink(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.revokeLineLinkToken.execute({
      companyId: ctx.companyId,
      employeeId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
    });
  }
}

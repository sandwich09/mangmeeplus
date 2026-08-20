import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateRoleDto, RolePreviewDto, UpdateRoleDto } from './employee-access.dtos';
import { ListRolesUseCase } from '../../application/use-cases/list-roles.use-case';
import { GetRoleUseCase } from '../../application/use-cases/get-role.use-case';
import { CreateRoleUseCase } from '../../application/use-cases/create-role.use-case';
import { UpdateRoleUseCase } from '../../application/use-cases/update-role.use-case';
import { DisableRoleUseCase } from '../../application/use-cases/disable-role.use-case';
import { PreviewRoleUseCase } from '../../application/use-cases/preview-role.use-case';

@ApiTags('settings-roles')
@Controller('companies/:companyId/settings/roles')
export class RoleController {
  constructor(
    private readonly listRoles: ListRolesUseCase,
    private readonly getRole: GetRoleUseCase,
    private readonly createRole: CreateRoleUseCase,
    private readonly updateRole: UpdateRoleUseCase,
    private readonly disableRole: DisableRoleUseCase,
    private readonly previewRole: PreviewRoleUseCase,
  ) {}

  @Get()
  @RequirePermissions('access.role.read')
  @ApiOperation({ summary: 'List system and company custom roles' })
  list(@ReqCtx() ctx: RequestContext) {
    return this.listRoles.execute(ctx.companyId, {
      permissions: ctx.permissions,
      entitlementDeniedPermissions: ctx.entitlementDeniedPermissions,
      isOwner: ctx.roles.includes('OWNER'),
    });
  }

  @Get(':roleId')
  @RequirePermissions('access.role.read')
  @ApiOperation({ summary: 'Get role detail with permission keys' })
  get(@ReqCtx() ctx: RequestContext, @Param('roleId') roleId: string) {
    return this.getRole.execute(ctx.companyId, roleId);
  }

  @Post('preview')
  @RequirePermissions('access.role.read')
  @ApiOperation({ summary: 'Preview effective permissions of packs/preset/keys without saving' })
  preview(@ReqCtx() ctx: RequestContext, @Body() body: RolePreviewDto) {
    return this.previewRole.execute({
      companyId: ctx.companyId,
      granterPermissionKeys: ctx.permissions,
      isOwner: ctx.roles.includes('OWNER'),
      ...body,
    });
  }

  @Post()
  @RequirePermissions('access.role.manage')
  @ApiOperation({ summary: 'Create a company custom role' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateRoleDto) {
    return this.createRole.execute({
      companyId: ctx.companyId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
      granterPermissionKeys: ctx.permissions,
      isOwner: ctx.roles.includes('OWNER'),
      ...body,
    });
  }

  @Patch(':roleId')
  @RequirePermissions('access.role.manage')
  @ApiOperation({ summary: 'Update a company custom role' })
  update(@ReqCtx() ctx: RequestContext, @Param('roleId') roleId: string, @Body() body: UpdateRoleDto) {
    return this.updateRole.execute({
      companyId: ctx.companyId,
      roleId,
      requestingUserId: ctx.userId,
      requestId: ctx.requestId,
      granterPermissionKeys: ctx.permissions,
      isOwner: ctx.roles.includes('OWNER'),
      ...body,
    });
  }

  @Post(':roleId/disable')
  @RequirePermissions('access.role.manage')
  @ApiOperation({ summary: 'Disable a company custom role' })
  disable(@ReqCtx() ctx: RequestContext, @Param('roleId') roleId: string) {
    return this.disableRole.execute({ companyId: ctx.companyId, roleId, requestingUserId: ctx.userId, requestId: ctx.requestId });
  }
}

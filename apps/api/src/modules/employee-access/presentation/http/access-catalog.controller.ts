import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { ListCapabilityPacksUseCase } from '../../application/use-cases/list-capability-packs.use-case';
import { ListRoleTemplatesUseCase } from '../../application/use-cases/list-role-templates.use-case';
import { GetEffectiveAccessUseCase } from '../../application/use-cases/get-effective-access.use-case';
import { GetAccessMatrixUseCase } from '../../application/use-cases/get-access-matrix.use-case';
import { ListThaiAddressesUseCase } from '../../application/use-cases/list-thai-addresses.use-case';

@ApiTags('settings-access-catalog')
@Controller('companies/:companyId/settings')
export class AccessCatalogController {
  constructor(
    private readonly listCapabilityPacks: ListCapabilityPacksUseCase,
    private readonly listRoleTemplates: ListRoleTemplatesUseCase,
    private readonly effectiveAccess: GetEffectiveAccessUseCase,
    private readonly getAccessMatrix: GetAccessMatrixUseCase,
    private readonly listThaiAddresses: ListThaiAddressesUseCase,
  ) {}

  @Get('address-master')
  @RequireAnyPermission('access.employee.read', 'access.employee.create', 'access.employee.update', 'company.setup.read', 'company.legal_identity.read', 'company.legal_identity.manage')
  @ApiOperation({ summary: 'List Thai address master rows for a five-digit postal code' })
  addresses(@Query('postalCode') postalCode = '') {
    return this.listThaiAddresses.execute(postalCode);
  }

  @Get('capability-packs')
  @RequireAnyPermission('access.capability_pack.read', 'access.role.manage')
  @ApiOperation({ summary: 'List capability packs grouped by module with per-company lock/grantable state' })
  packs(@ReqCtx() ctx: RequestContext) {
    return this.listCapabilityPacks.execute(ctx.companyId, ctx.permissions, ctx.roles.includes('OWNER'));
  }

  @Get('role-templates')
  @RequireAnyPermission('access.role_template.read', 'access.role.manage')
  @ApiOperation({ summary: 'List job presets (role templates)' })
  templates() {
    return this.listRoleTemplates.execute();
  }

  @Get('effective-access')
  @RequirePermissions('access.effective.read')
  @ApiOperation({ summary: 'Who-can-do-what matrix for active company members' })
  matrix(@ReqCtx() ctx: RequestContext) {
    return this.effectiveAccess.matrix(ctx.companyId);
  }

  @Get('effective-access/:membershipId')
  @RequirePermissions('access.effective.read')
  @ApiOperation({ summary: 'Effective access for one membership' })
  member(@ReqCtx() ctx: RequestContext, @Param('membershipId') membershipId: string) {
    return this.effectiveAccess.forMembership(ctx.companyId, membershipId);
  }

  @Get('access/matrix')
  @RequireAnyPermission('access.role.read', 'access.role.manage')
  @ApiOperation({ summary: 'Role x menu x action permission matrix (มั่งมี Flow A projection over permission keys)' })
  accessMatrix(@ReqCtx() ctx: RequestContext) {
    return this.getAccessMatrix.execute(ctx.companyId);
  }
}

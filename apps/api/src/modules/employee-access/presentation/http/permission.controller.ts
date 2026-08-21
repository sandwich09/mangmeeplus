import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission } from '../../../../common/security/permissions.decorator';
import { ListPermissionsUseCase } from '../../application/use-cases/list-permissions.use-case';

@ApiTags('settings-permissions')
@Controller('companies/:companyId/settings/permissions')
export class PermissionController {
  constructor(private readonly listPermissions: ListPermissionsUseCase) {}

  @Get()
  @RequireAnyPermission('access.permission.read', 'access.role.manage')
  @ApiOperation({ summary: 'List the registered permission catalog grouped by module' })
  list() {
    return this.listPermissions.execute();
  }
}

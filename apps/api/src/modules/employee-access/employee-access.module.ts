import { Module } from '@nestjs/common';
import { EmployeeController } from './presentation/http/employee.controller';
import { RoleController } from './presentation/http/role.controller';
import { PermissionController } from './presentation/http/permission.controller';
import { AccessCatalogController } from './presentation/http/access-catalog.controller';
import { ListEmployeesUseCase } from './application/use-cases/list-employees.use-case';
import { GetEmployeeUseCase } from './application/use-cases/get-employee.use-case';
import { CreateEmployeeUseCase } from './application/use-cases/create-employee.use-case';
import { UpdateEmployeeUseCase } from './application/use-cases/update-employee.use-case';
import { SetEmployeeStatusUseCase } from './application/use-cases/set-employee-status.use-case';
import { DeleteEmployeeDraftUseCase } from './application/use-cases/delete-employee-draft.use-case';
import { RegenerateEmployeeCredentialUseCase } from './application/use-cases/regenerate-employee-credential.use-case';
import { IssueEmployeeLineLinkTokenUseCase } from './application/use-cases/issue-employee-line-link-token.use-case';
import { RevokeEmployeeLineLinkTokenUseCase } from './application/use-cases/revoke-employee-line-link-token.use-case';
import { ListRolesUseCase } from './application/use-cases/list-roles.use-case';
import { GetRoleUseCase } from './application/use-cases/get-role.use-case';
import { CreateRoleUseCase } from './application/use-cases/create-role.use-case';
import { UpdateRoleUseCase } from './application/use-cases/update-role.use-case';
import { DisableRoleUseCase } from './application/use-cases/disable-role.use-case';
import { ListPermissionsUseCase } from './application/use-cases/list-permissions.use-case';
import { PreviewRoleUseCase } from './application/use-cases/preview-role.use-case';
import { ListCapabilityPacksUseCase } from './application/use-cases/list-capability-packs.use-case';
import { ListRoleTemplatesUseCase } from './application/use-cases/list-role-templates.use-case';
import { GetEffectiveAccessUseCase } from './application/use-cases/get-effective-access.use-case';
import { GetAccessMatrixUseCase } from './application/use-cases/get-access-matrix.use-case';
import { ListThaiAddressesUseCase } from './application/use-cases/list-thai-addresses.use-case';
import { BusinessPolicyController } from './presentation/http/business-policy.controller';
import { BUSINESS_POLICY_REPOSITORY, BusinessPolicyUseCase } from './application/use-cases/business-policy.use-case';
import { PrismaBusinessPolicyRepository } from './infrastructure/prisma-business-policy.repository';
import { EntitlementExceptionController } from './presentation/http/entitlement-exception.controller';
import { EntitlementExceptionUseCase } from './application/use-cases/entitlement-exception.use-case';

@Module({
  controllers: [
    EmployeeController,
    RoleController,
    PermissionController,
    AccessCatalogController,
    BusinessPolicyController,
    EntitlementExceptionController,
  ],
  providers: [
    ListEmployeesUseCase,
    GetEmployeeUseCase,
    CreateEmployeeUseCase,
    UpdateEmployeeUseCase,
    SetEmployeeStatusUseCase,
    DeleteEmployeeDraftUseCase,
    RegenerateEmployeeCredentialUseCase,
    IssueEmployeeLineLinkTokenUseCase,
    RevokeEmployeeLineLinkTokenUseCase,
    ListRolesUseCase,
    GetRoleUseCase,
    CreateRoleUseCase,
    UpdateRoleUseCase,
    DisableRoleUseCase,
    ListPermissionsUseCase,
    PreviewRoleUseCase,
    ListCapabilityPacksUseCase,
    ListRoleTemplatesUseCase,
    GetEffectiveAccessUseCase,
    GetAccessMatrixUseCase,
    ListThaiAddressesUseCase,
    BusinessPolicyUseCase,
    EntitlementExceptionUseCase,
    PrismaBusinessPolicyRepository,
    { provide: BUSINESS_POLICY_REPOSITORY, useExisting: PrismaBusinessPolicyRepository },
  ],
  exports: [ListThaiAddressesUseCase, ListRolesUseCase, CreateEmployeeUseCase, UpdateEmployeeUseCase, SetEmployeeStatusUseCase, IssueEmployeeLineLinkTokenUseCase],
})
export class EmployeeAccessModule {}

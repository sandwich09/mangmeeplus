import { Injectable } from '@nestjs/common';
import type { PermissionCatalogItem } from '@watchdog-bms/contracts';
import { COMPANY_PERMISSION_KEYS, PERMISSIONS } from '../../../auth/permission-registry';
import { toPermissionCatalogItem } from '../dto/employee-access.mapper';

@Injectable()
export class ListPermissionsUseCase {
  execute(): PermissionCatalogItem[] {
    const companyKeys = new Set(COMPANY_PERMISSION_KEYS);
    return PERMISSIONS.filter((p) => companyKeys.has(p.key)).map(toPermissionCatalogItem);
  }
}

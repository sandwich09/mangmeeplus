import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REQUIRED_ANY_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { AccessCatalogController } from './access-catalog.controller';
import { EmployeeController } from './employee.controller';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';

function requiredAny(target: object, method: string): string[] {
  return Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, (target as Record<string, object>)[method]);
}

describe('employee access action-flow permission contracts', () => {
  it('lets employee create/update permissions load only the supporting editor catalogs', () => {
    assert.deepEqual(requiredAny(RoleController.prototype, 'list'), [
      'access.role.read', 'access.role.manage', 'access.employee.create', 'access.employee.update',
    ]);
    assert.deepEqual(requiredAny(EmployeeController.prototype, 'get'), [
      'access.employee.read', 'access.employee.update',
    ]);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'addresses'), [
      'access.employee.read', 'access.employee.create', 'access.employee.update',
    ]);
  });

  it('lets role managers load the role builder without granting employee-list read', () => {
    assert.deepEqual(requiredAny(RoleController.prototype, 'get'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(RoleController.prototype, 'preview'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'packs'), ['access.capability_pack.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'templates'), ['access.role_template.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'accessMatrix'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(PermissionController.prototype, 'list'), ['access.permission.read', 'access.role.manage']);
  });
});

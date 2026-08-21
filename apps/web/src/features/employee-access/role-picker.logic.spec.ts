import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { assignableRoleOptions, isAssignableRoleCatalog, isOperationalRoleTargetReadOnly, isRoleFieldReadOnly, isSelfEmployee } from './role-picker.logic';

function role(id: string, assignableByCurrentUser?: boolean): RoleSummary {
  return { id, key: id.toUpperCase(), name: id, isSystem: true, status: 'ACTIVE', permissionKeys: [], assignableByCurrentUser };
}

// The owner gets a `true` flag on every assignable role; a manager gets it on their subset only.
const OWNER_VIEW = [role('sales', true), role('manager', true), role('finance', true)];
const MANAGER_VIEW = [role('sales', true), role('manager', false), role('finance', false)];

describe('isAssignableRoleCatalog', () => {
  it('accepts both allowed and denied roles when the server supplies a boolean decision', () => {
    assert.equal(isAssignableRoleCatalog(MANAGER_VIEW), true);
    assert.equal(isAssignableRoleCatalog([]), true);
  });

  it('rejects the older cached contract instead of turning it into an empty picker', () => {
    assert.equal(isAssignableRoleCatalog([role('sales')]), false);
    assert.equal(isAssignableRoleCatalog({ roles: MANAGER_VIEW }), false);
  });
});

describe('assignableRoleOptions', () => {
  it('offers the owner every role the server flagged', () => {
    assert.deepEqual(assignableRoleOptions(OWNER_VIEW).map((r) => r.id), ['sales', 'manager', 'finance']);
  });

  it('drops roles a manager cannot grant', () => {
    assert.deepEqual(assignableRoleOptions(MANAGER_VIEW).map((r) => r.id), ['sales']);
  });

  it('pins the employee’s current role even when it is not grantable', () => {
    assert.deepEqual(assignableRoleOptions(MANAGER_VIEW, 'finance').map((r) => r.id), ['sales', 'finance']);
  });

  it('never duplicates the current role or matches an empty id', () => {
    assert.deepEqual(assignableRoleOptions(MANAGER_VIEW, 'sales').map((r) => r.id), ['sales']);
    assert.deepEqual(assignableRoleOptions([role('sales', false)], '').map((r) => r.id), []);
  });
});

describe('isSelfEmployee', () => {
  it('matches only the viewer’s own row', () => {
    assert.equal(isSelfEmployee({ userId: 'user-1' }, 'user-1'), true);
    assert.equal(isSelfEmployee({ userId: 'user-2' }, 'user-1'), false);
  });

  it('stays false without an employee or a known viewer', () => {
    assert.equal(isSelfEmployee(null, 'user-1'), false);
    assert.equal(isSelfEmployee({ userId: '' }, undefined), false);
  });
});

describe('isRoleFieldReadOnly', () => {
  const editable = { canEditEmployee: true, isOwnerTarget: false, isSelfTarget: false, optionCount: 3 };

  it('keeps the picker for an editor with real alternatives', () => {
    assert.equal(isRoleFieldReadOnly(editable), false);
  });

  it('falls back to the badge on owner rows, own row, and for read-only viewers', () => {
    assert.equal(isRoleFieldReadOnly({ ...editable, isOwnerTarget: true }), true);
    assert.equal(isRoleFieldReadOnly({ ...editable, isSelfTarget: true }), true);
    assert.equal(isRoleFieldReadOnly({ ...editable, canEditEmployee: false }), true);
  });

  it('collapses a list holding nothing but the current role', () => {
    assert.equal(isRoleFieldReadOnly({ ...editable, optionCount: 1 }), true);
    assert.equal(isRoleFieldReadOnly({ ...editable, optionCount: 0 }), true);
    assert.equal(isRoleFieldReadOnly({ ...editable, optionCount: 2 }), false);
  });
});

describe('isOperationalRoleTargetReadOnly', () => {
  const hrPermissions = ['access.employee.update', 'access.role.operational.assign'];

  it('lets HR change operational roles', () => {
    for (const role of ['MANAGER', 'SALES', 'INVENTORY', 'MARKETING', 'STAFF']) {
      assert.equal(isOperationalRoleTargetReadOnly(hrPermissions, { key: role, isSystem: true }), false);
    }
  });

  it('keeps privileged, financial, audit, HR, and custom targets read-only for HR', () => {
    for (const role of ['ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'CUSTOM']) {
      assert.equal(isOperationalRoleTargetReadOnly(hrPermissions, { key: role, isSystem: true }), true);
    }
    assert.equal(isOperationalRoleTargetReadOnly(hrPermissions, { key: 'STAFF', isSystem: false }), true);
  });

  it('does not restrict a delegated role manager', () => {
    assert.equal(isOperationalRoleTargetReadOnly([...hrPermissions, 'access.role.manage'], { key: 'ADMIN', isSystem: true }), false);
  });
});

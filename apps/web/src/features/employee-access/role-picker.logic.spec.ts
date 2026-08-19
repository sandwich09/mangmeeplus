import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { assignableRoleOptions, isRoleFieldReadOnly, isSelfEmployee } from './role-picker.logic';

function role(id: string, assignableByCurrentUser?: boolean): RoleSummary {
  return { id, key: id.toUpperCase(), name: id, isSystem: true, status: 'ACTIVE', permissionKeys: [], assignableByCurrentUser };
}

// The owner gets a `true` flag on every assignable role; a manager gets it on their subset only.
const OWNER_VIEW = [role('sales', true), role('manager', true), role('finance', true)];
const MANAGER_VIEW = [role('sales', true), role('manager', false), role('finance', false)];

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

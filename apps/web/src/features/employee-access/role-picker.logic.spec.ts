import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { assignableRoleOptions, hasStandardRoleName, isAssignableRoleCatalog, isOperationalRoleTargetReadOnly, isRoleFieldReadOnly, isSelfEmployee, roleCanDoPacks, roleDisplayName, roleKeyDisplayName, roleTemplateChoices } from './role-picker.logic';
import * as logic from './role-picker.logic';
import { PRIVILEGED_GRANT_KEYS } from '@watchdog-bms/contracts';

it('FIX-R2 status changes follow privileged grants rather than the role name', () => {
  const canChange = (logic as any).canChangeEmployeeStatus;
  assert.equal(typeof canChange, 'function');
  const employee = { status: 'ACTIVE', roles: [{ id: 'r', key: 'CUSTOM' }] };
  const permissions = ['access.employee.disable'];
  for (const key of PRIVILEGED_GRANT_KEYS) {
    const roles = [{ ...role('r'), key: 'CUSTOM', permissionKeys: [key] }];
    assert.equal(canChange(permissions, employee, roles), false, key);
    assert.equal(canChange([...permissions, 'access.role.manage'], employee, roles), true, key);
  }
  assert.equal(canChange(permissions, employee, [{ ...role('r'), permissionKeys: ['expense.read'] }]), true);
  assert.equal(canChange(permissions, employee, []), false, 'unknown roles are not assumed safe');
  assert.equal(canChange([], employee, [role('r')]), false);
  for (const key of ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW']) assert.equal(canChange([...permissions, 'access.role.manage'], { ...employee, roles: [{ id: 'r', key }] }, [role('r')]), false);
  assert.equal(canChange([...permissions, 'access.role.manage'], { ...employee, status: 'DRAFT' }, [role('r')]), false);
});

it('FIX-R2 legacy main-branch access counts the default once and ignores stale selected branches', () => {
  const branchIds = (logic as any).employeeBranchIds;
  assert.equal(typeof branchIds, 'function');
  assert.deepEqual(branchIds({ branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'main', branchScopeBranchIds: [] }), ['main']);
  assert.deepEqual(branchIds({ branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'main', branchScopeBranchIds: ['other', 'main'] }), ['main']);
  assert.deepEqual(branchIds({ branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: 'main', branchScopeBranchIds: ['second'] }), ['second']);
  assert.deepEqual(branchIds({ branchScopeMode: 'DEFAULT_BRANCH_ONLY', branchScopeBranchIds: [] }), []);
});

function role(id: string, assignableByCurrentUser?: boolean): RoleSummary {
  return { id, key: id.toUpperCase(), name: id, isSystem: true, status: 'ACTIVE', permissionKeys: [], assignableByCurrentUser };
}

// The owner gets a `true` flag on every assignable role; a manager gets it on their subset only.
const OWNER_VIEW = [role('sales', true), role('manager', true), role('finance', true)];
const MANAGER_VIEW = [role('sales', true), role('manager', false), role('finance', false)];

describe('isAssignableRoleCatalog', () => {
  it('uses Thai names for system roles without renaming custom roles', () => {
    assert.equal(roleDisplayName(role('accountant')), 'ฝ่ายบัญชี');
    assert.equal(roleDisplayName({ key: 'CUSTOM', name: 'ผู้ช่วยร้าน' }), 'ผู้ช่วยร้าน');
    assert.equal(roleDisplayName({ ...role('finance'), isSystem: false, name: 'ผู้ช่วยการเงินพิเศษ' }), 'ผู้ช่วยการเงินพิเศษ');
  });
  // Owner report 2026-10-02: "Company owner" was printed in English, and so was a standard role once a
  // company had edited it, because the company's copy keeps the English name the API stores.
  it('never prints the English name the API stores for a standard role', () => {
    assert.equal(roleDisplayName({ key: 'COMPANY_VIEW', name: 'Company owner', isSystem: true }), 'ผู้ดูภาพรวมบริษัท');
    assert.equal(roleKeyDisplayName('COMPANY_VIEW'), 'ผู้ดูภาพรวมบริษัท');
    const copy = { key: 'ACCOUNTANT', name: 'Accountant', isSystem: false };
    assert.equal(hasStandardRoleName(copy), true);
    assert.equal(roleDisplayName(copy), 'ฝ่ายบัญชี');
    assert.equal(roleDisplayName({ key: 'AUDITOR_READONLY', name: 'Auditor (Read-only)', isSystem: false }), 'ผู้ตรวจสอบ (ดูอย่างเดียว)');
    // A copy the company named itself, and a custom role, keep their own names.
    assert.equal(hasStandardRoleName({ ...copy, name: 'นักบัญชีอาวุโส' }), false);
    assert.equal(hasStandardRoleName({ key: 'ROLE_2', name: 'Accountant', isSystem: false }), false);
  });
  it('accepts both allowed and denied roles when the server supplies a boolean decision', () => {
    assert.equal(isAssignableRoleCatalog(MANAGER_VIEW), true);
    assert.equal(isAssignableRoleCatalog([]), true);
  });

  it('rejects the older cached contract instead of turning it into an empty picker', () => {
    assert.equal(isAssignableRoleCatalog([role('sales')]), false);
    assert.equal(isAssignableRoleCatalog({ roles: MANAGER_VIEW }), false);
  });
});

it('translates the stored company-view name on every Thai surface and calls it a viewer in English', () => {
  for (const isSystem of [true, false, undefined]) {
    const stored = { key: 'COMPANY_VIEW', name: 'Company owner', isSystem };
    assert.equal(roleDisplayName(stored), 'ผู้ดูภาพรวมบริษัท');
    assert.equal(roleDisplayName(stored, 'en'), 'Company viewer');
  }
  assert.equal(roleDisplayName('Company owner'), 'ผู้ดูภาพรวมบริษัท');
  assert.equal(roleDisplayName('COMPANY_VIEW', 'en'), 'Company viewer');
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

  it('pins every current role for a multi-role employee', () => {
    assert.deepEqual(assignableRoleOptions(MANAGER_VIEW, ['manager', 'finance']).map((r) => r.id), ['sales', 'manager', 'finance']);
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

// Owner report 2026-10-02: six example roles (พนักงานขาย, พนักงานคลัง, ฝ่ายขาย, คลังสินค้า, หน้าร้าน/ต้อนรับ,
// ฝ่ายขาย/ดูแลลูกค้า) were never offered. Each names the claim choice every role holds automatically,
// which has no tick box, and the builder read "no box" as "cannot be given".
describe('roleTemplateChoices', () => {
  const packs = [
    { key: 'pack.core.basics', isCore: true },
    { key: 'pack.reimbursement.self', isCore: true },
    { key: 'pack.crm.view', isCore: false },
    { key: 'pack.expense.self', isCore: false },
    { key: 'pack.inventory.view', isCore: false }, // locked for the company, or beyond what this user may give
  ];
  const tickable = new Set(['pack.crm.view', 'pack.expense.self']);

  it('offers an example that names an automatic choice, and ticks only the boxes there are', () => {
    const example = { capabilityPackKeys: ['pack.crm.view', 'pack.expense.self', 'pack.reimbursement.self'] };
    assert.deepEqual(roleTemplateChoices(example, packs, tickable), ['pack.crm.view', 'pack.expense.self']);
    assert.deepEqual(roleTemplateChoices({ capabilityPackKeys: ['pack.crm.view'] }, packs, tickable), ['pack.crm.view']);
  });

  it('still leaves out an example with a choice that has no box for another reason', () => {
    assert.equal(roleTemplateChoices({ capabilityPackKeys: ['pack.crm.view', 'pack.inventory.view'] }, packs, tickable), null);
    assert.equal(roleTemplateChoices({ capabilityPackKeys: ['pack.crm.view', 'pack.gone'] }, packs, tickable), null);
  });

  it('is the rule the role builder offers and ticks examples by', () => {
    const builder = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
    assert.match(builder, /templates\.filter\(\(tpl\) => roleTemplateChoices\(tpl, allPacks, availablePackKeys\)\)/);
    assert.match(builder, /setSelectedPacks\(settingsViewIncluded\(roleTemplateChoices\(tpl, allPacks, availablePackKeys\) \?\? \[\]\)\)/);
  });
});

// Owner report 2026-10-13: the role page of ฝ่ายบัญชี listed stock, sales bills, bank reconciliation, ledger
// and tax filing in a shop whose package has none of them. A shop reads only what its package has.
describe('roleCanDoPacks', () => {
  const packs = [
    { key: 'pack.core.basics', isCore: true, locked: false, permissionKeys: ['dashboard.read'] },
    { key: 'pack.expense.view', isCore: false, locked: false, permissionKeys: ['expense.read'] },
    { key: 'pack.expense.review', isCore: false, locked: false, permissionKeys: ['expense.read', 'expense.review'] },
    { key: 'pack.inventory.view', isCore: false, locked: true, permissionKeys: ['inventory.read'] },
    { key: 'pack.empty', isCore: false, locked: false, permissionKeys: [] },
  ];
  const keys = (list: Array<{ key: string }>) => list.map((pack) => pack.key);

  it('lists the choices a role holds in full, and leaves out what the shop\u2019s package does not have', () => {
    assert.deepEqual(keys(roleCanDoPacks(['dashboard.read', 'expense.read', 'inventory.read'], packs)), ['pack.expense.view']);
    assert.deepEqual(keys(roleCanDoPacks(['expense.read', 'expense.review', 'inventory.read'], packs)), ['pack.expense.view', 'pack.expense.review']);
    assert.deepEqual(roleCanDoPacks([], packs), []);
  });

  it('is the rule of the role page and of a person\u2019s rights card, and the builder offers no locked choice either', () => {
    const rolePage = readFileSync(new URL('./PermissionMatrixPrototypePage.tsx', import.meta.url), 'utf8');
    const people = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');
    const builder = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
    assert.match(rolePage, /roleCanDoPacks\(selectedRole\.permissionKeys, allPacks\)/);
    assert.match(people, /roleCanDoPacks\(selectedRoles\.flatMap\(\(role\) => role\.permissionKeys\), packs\)/);
    assert.match(builder, /allPacks\.filter\(\(p\) => !p\.isCore && !p\.locked && p\.grantableByCurrentUser\)/);
    // What the builder hides stays in the role: the rights outside its boxes are sent back as they were.
    assert.match(builder, /capabilityPackKeys: selectedPacks, permissionKeys: preservedKeys/);
  });
});

// Lane 3a: the dictionary drives role pages and the footer; the picker drives employees and the switcher.
describe('one Thai standard-role name', () => {
  it('gives every role key the same name on dictionary and picker surfaces', () => {
    const stored = {
      OWNER: 'Owner', SYSTEM_ADMIN: 'System Admin', COMPANY_VIEW: 'Company owner', ADMIN: 'Admin',
      MANAGER: 'Manager', HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', FINANCE: 'Finance',
      ACCOUNTANT: 'Accountant', MARKETING: 'Marketing', STAFF: 'Staff', AUDITOR_READONLY: 'Auditor (Read-only)',
      MANGMEE_SALES_LEAD: 'Mangmee Sales Lead', MANGMEE_SALES: 'Mangmee Sales',
    };
    for (const [key, name] of Object.entries(stored)) {
      const expected = roleKeyDisplayName(key);
      assert.doesNotMatch(expected, /[A-Za-z_]/u, key);
      assert.equal(roleDisplayName(name), expected, `${key} stored name without a key`);
      assert.equal((workspaceDictionary.th as Record<string, string>)[`role.${key}`], expected, key);
      for (const isSystem of [true, false]) assert.equal(roleDisplayName({ key, name, isSystem }), expected, `${key} system=${isSystem}`);
      assert.equal(roleDisplayName({ key, name }), expected, `${key} employee role reference`);
      for (const isSystem of [false, undefined]) assert.equal(roleDisplayName({ key, name: 'ชื่อที่บริษัทตั้งเอง', isSystem }), 'ชื่อที่บริษัทตั้งเอง', key);
    }
  });
});

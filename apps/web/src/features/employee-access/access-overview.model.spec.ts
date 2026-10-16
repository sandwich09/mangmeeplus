import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuDefinition, PermissionMatrixRow } from '@watchdog-bms/contracts';
import { accountAccessNotice, capabilityLabels, grantedActions, projectGrantedMenus } from './access-overview.model';

const MENUS: MenuDefinition[] = [
  { id: 'dashboard', labelTh: 'หน้าแรก', group: 'main', route: '/dashboard', actions: { view: ['dashboard.read'] } },
  {
    id: 'expenses', labelTh: 'ค่าใช้จ่าย+ใบเสร็จ', group: 'fin', route: '/expenses',
    actions: { view: ['expense.read'], create: ['expense.create'], edit: ['expense.review'], del: ['expense.delete'], approve: ['expense.confirm'] },
  },
  { id: 'salesdoc', labelTh: 'เอกสารขาย', group: 'fin', route: '/sales-documents', actions: { view: ['accounting.document.read'] } },
];

function row(roleId: string, menus: PermissionMatrixRow['menus']): PermissionMatrixRow {
  return { roleId, roleKey: roleId, roleLabel: roleId, locked: false, menus };
}

describe('access overview model', () => {
  it('returns no actions when the cell or view grant is absent', () => {
    assert.deepEqual(grantedActions(undefined), []);
    assert.deepEqual(grantedActions({}), []);
    assert.deepEqual(grantedActions({ create: true }), []);
  });

  it('returns granted actions in stable display order', () => {
    assert.deepEqual(grantedActions({ view: true }), ['view']);
    assert.deepEqual(
      grantedActions({ view: true, create: true, edit: false, approve: true }),
      ['view', 'create', 'approve'],
    );
  });

  it('maps granted actions to Thai capability labels', () => {
    assert.deepEqual(capabilityLabels({ view: true, del: true }), ['ดู', 'ลบ']);
  });

  it('distinguishes live, future, and unusable account access', () => {
    assert.match(accountAccessNotice('ACTIVE'), /ขอบเขต/);
    assert.match(accountAccessNotice('DRAFT'), /หลังเปิดใช้งานบัญชี/);
    for (const status of ['INVITED', 'SUSPENDED', 'DISABLED'] as const) {
      assert.match(accountAccessNotice(status), /ยังใช้สิทธิ์ชุดนี้ไม่ได้/);
    }
  });

  it('unions every assigned role, hides denied menus, and removes empty groups', () => {
    const projection = projectGrantedMenus(
      ['role-a', 'role-b'],
      [
        row('role-a', { expenses: { view: true, create: true }, salesdoc: { view: false } }),
        row('role-b', { expenses: { view: true, approve: true }, dashboard: { view: false } }),
      ],
      MENUS,
      new Set(['dashboard', 'expenses', 'salesdoc']),
    );

    assert.equal(projection.complete, true);
    assert.equal(projection.grantedCount, 1);
    assert.deepEqual(projection.groups.map((group) => group.group), ['fin']);
    assert.deepEqual(projection.groups[0]!.menus[0]!.labels, ['ดู', 'เพิ่ม', 'อนุมัติ']);
  });

  it('keeps the summary bounded to supported menu ids', () => {
    const projection = projectGrantedMenus(
      ['role-a'],
      [row('role-a', { dashboard: { view: true }, salesdoc: { view: true } })],
      MENUS,
      new Set(['dashboard']),
    );

    assert.equal(projection.grantedCount, 1);
    assert.equal(projection.groups[0]!.menus[0]!.menu.id, 'dashboard');
  });

  it('returns an honest incomplete result when an assigned role row is missing', () => {
    assert.deepEqual(
      projectGrantedMenus(['role-a', 'role-missing'], [row('role-a', {})], MENUS, new Set(['dashboard'])),
      { complete: false, groups: [], grantedCount: 0, missingRoleIds: ['role-missing'] },
    );
  });

  it('returns a complete zero-menu result when the employee truly has no grants', () => {
    assert.deepEqual(
      projectGrantedMenus(['role-a'], [row('role-a', { dashboard: { view: false } })], MENUS, new Set(['dashboard'])),
      { complete: true, groups: [], grantedCount: 0 },
    );
  });
});

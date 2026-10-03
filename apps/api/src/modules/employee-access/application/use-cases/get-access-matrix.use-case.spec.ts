import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { GetAccessMatrixUseCase } from './get-access-matrix.use-case';

function fakeListRoles(roles: RoleSummary[]) {
  return { execute: async () => roles } as any;
}

/** rows = companyFeatureEntitlement rows; [] = legacy fail-open (every feature entitled). */
function fakePrisma(rows: Array<{ featureKey: string; enabled: boolean }> = []) {
  return { client: { companyFeatureEntitlement: { findMany: async () => rows } } } as any;
}

describe('GetAccessMatrixUseCase', () => {
  it('shows scoped expense access and own editing without granting review or confirmation', async () => {
    for (const readKey of ['expense.read_own', 'expense.read_related']) {
      const role: RoleSummary = {
        id: 'r-scoped', key: 'scoped', name: 'Scoped expense', isSystem: false, status: 'ACTIVE',
        permissionKeys: [readKey, 'expense.create', 'expense.update'],
      };
      const matrix = await new GetAccessMatrixUseCase(fakeListRoles([role]), fakePrisma()).execute('company-1');
      assert.equal(matrix.rows[0]!.menus.expenses?.view, true);
      assert.equal(matrix.rows[0]!.menus.expenses?.create, true);
      assert.equal(matrix.rows[0]!.menus.expenses?.edit, true);
      assert.equal(matrix.rows[0]!.menus.expenses?.approve, false);
      assert.equal(matrix.rows[0]!.menus.expenses?.del, false);
      assert.deepEqual(role.permissionKeys, [readKey, 'expense.create', 'expense.update']);
    }
  });

  it('marks system roles locked and projects granted keys to true menu cells', async () => {
    const owner: RoleSummary = {
      id: 'r-owner', key: 'OWNER', name: 'เจ้าของ', isSystem: true, status: 'ACTIVE',
      permissionKeys: ['dashboard.read', 'crm.inbox.read', 'crm.inbox.reply', 'crm.inbox.assign'],
    };
    const custom: RoleSummary = {
      id: 'r-staff', key: 'staff-custom', name: 'พนักงานทดลอง', isSystem: false, status: 'ACTIVE',
      permissionKeys: ['crm.inbox.read'],
    };
    const useCase = new GetAccessMatrixUseCase(fakeListRoles([owner, custom]), fakePrisma());

    const matrix = await useCase.execute('company-1');

    assert.equal(matrix.rows.length, 2);
    const ownerRow = matrix.rows.find((r) => r.roleId === 'r-owner')!;
    const staffRow = matrix.rows.find((r) => r.roleId === 'r-staff')!;

    assert.equal(ownerRow.locked, true);
    assert.equal(staffRow.locked, false);

    assert.equal(ownerRow.menus.dashboard?.view, true);
    assert.equal(staffRow.menus.dashboard?.view, false);

    assert.equal(ownerRow.menus.inbox?.view, true);
    assert.equal(ownerRow.menus.inbox?.create, true);
    assert.equal(staffRow.menus.inbox?.view, true);
    assert.equal(staffRow.menus.inbox?.create, false);
  });

  it('leaves menus with no mapped permission key (e.g. sales) as an always-empty cell', async () => {
    const owner: RoleSummary = { id: 'r-owner', key: 'OWNER', name: 'เจ้าของ', isSystem: true, status: 'ACTIVE', permissionKeys: ['dashboard.read'] };
    const useCase = new GetAccessMatrixUseCase(fakeListRoles([owner]), fakePrisma());

    const matrix = await useCase.execute('company-1');

    assert.deepEqual(matrix.rows[0]!.menus.sales, {});
  });

  it('strips menus of features the company has not enabled (AC-FE-2), matching the session resolver', async () => {
    const sales: RoleSummary = {
      id: 'r-sales', key: 'SALES', name: 'Sales', isSystem: true, status: 'ACTIVE',
      // report.catalog.read (reports feature, off) + ledger.journal.read (double_entry_ledger, off)
      // must not surface as visible menus; crm stays while dashboard_notifications is also off.
      permissionKeys: ['dashboard.read', 'crm.inbox.read', 'report.catalog.read', 'ledger.journal.read'],
    };
    const useCase = new GetAccessMatrixUseCase(
      fakeListRoles([sales]),
      fakePrisma([
        { featureKey: 'crm', enabled: true },
        { featureKey: 'ai_line_assistant', enabled: true },
        { featureKey: 'expenses', enabled: true },
        { featureKey: 'dashboard_notifications', enabled: false },
        { featureKey: 'reports', enabled: false },
        { featureKey: 'double_entry_ledger', enabled: false },
      ]),
    );

    const matrix = await useCase.execute('company-1');
    const row = matrix.rows[0]!;

    assert.equal(row.menus.dashboard, undefined, 'dashboard entitlement off strips dashboard.read');
    assert.equal(row.menus.inbox?.view, true, 'crm enabled keeps inbox');
    assert.equal(row.menus.reports, undefined, 'reports feature off strips report.catalog.read');
    assert.equal(row.menus.journal, undefined, 'ledger feature off strips ledger.journal.read');
  });

  it('keeps every granted menu when the company has no entitlement rows (legacy fail-open)', async () => {
    const sales: RoleSummary = {
      id: 'r-sales', key: 'SALES', name: 'Sales', isSystem: true, status: 'ACTIVE',
      permissionKeys: ['report.catalog.read'],
    };
    const useCase = new GetAccessMatrixUseCase(fakeListRoles([sales]), fakePrisma([]));

    const matrix = await useCase.execute('company-1');

    assert.equal(matrix.rows[0]!.menus.reports?.view, true);
  });
});

it('STARTER matrix contains only purchased menus, including menus a role has no grant for', async () => {
  const { TIER_FEATURE_PRESETS, ALL_FEATURE_ENTITLEMENT_KEYS } = await import('@watchdog-bms/contracts');
  const keys: readonly string[] = TIER_FEATURE_PRESETS.STARTER_249;
  const matrix = await new GetAccessMatrixUseCase(fakeListRoles([]), fakePrisma(
    ALL_FEATURE_ENTITLEMENT_KEYS.map(featureKey => ({ featureKey, enabled: keys.includes(featureKey) })),
  )).execute('company-1');
  assert.deepEqual(matrix.menus.map(menu => menu.id), ['dashboard', 'expenses', 'roles', 'notifications']);
});

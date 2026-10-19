import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { filterSettingsMenuItems } from './settings-menu.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';
import { t } from '@/common/i18n/workspace-i18n.logic';
import {
  buildNavItems,
  canAccessWorkspacePath,
  filterModulesByPermissions,
} from './web-core-workspace.logic';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const previousSvgLoader = require.extensions['.svg'];
require.extensions['.svg'] = (module) => {
  module.exports = () => null;
};
const { requireRoutePermission } = require('./route-permission-guard') as typeof import('./route-permission-guard');
if (previousSvgLoader) require.extensions['.svg'] = previousSvgLoader;
else delete require.extensions['.svg'];

describe('permission page visibility regression', () => {
  it('opens the expenses certificate child with the API read permissions without widening the expenses group', () => {
    const path = '/companies/company-1/expenses/wht-certificates';
    const items = (permissions: string[]) => buildNavItems(filterModulesByPermissions(WORKSPACE_MODULES, permissions), 'company-1', 'th', {}, permissions)
      .find(item => item.key === 'expenses')?.subItems ?? [];
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['expense.read'], 'company-1', path), false);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['wht.certificate.issue'], 'company-1', path), true);
    for (const permission of ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link']) {
      assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, [permission], 'company-1', path), true);
      assert.equal(requireRoutePermission({ permissions: [permission] }, '/expenses/wht-certificates'), null);
      assert.ok(items(['expense.read', permission]).some(item => item.key === 'expenses.wht_certificates'));
    }
    assert.equal(items(['expense.read']).some(item => item.key === 'expenses.wht_certificates'), false);
    const child = items(['expense.read', 'wht.certificate.issue']).find(item => item.key === 'expenses.wht_certificates');
    // The row says whatever the certificates page calls itself (one key, no second literal).
    assert.equal(child?.href, path); assert.equal(child?.label, t('expenses.certificates.title', 'th'));
    assert.equal(items(['wht.certificate.issue']).length, 0);
    assert.ok(React.isValidElement(requireRoutePermission({ permissions: ['expense.read'] }, '/expenses/wht-certificates')));
    assert.equal(requireRoutePermission({ permissions: ['wht.certificate.issue'] }, '/expenses/wht-certificates'), null);
  });
  it('places certificates after the expense list and recording actions without changing the manual-entry gate', () => {
    const permissions = ['expense.read', 'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'wht.certificate.issue'];
    const modules = filterModulesByPermissions(WORKSPACE_MODULES, permissions);
    const keys = (manual: boolean) => buildNavItems(modules, 'company-1', 'th', {}, permissions, [], manual)
      .find(item => item.key === 'expenses')!.subItems!.map(item => item.key);
    assert.deepEqual(keys(true).slice(0, 5), ['expenses.list', 'expenses.upload', 'expenses.manual', 'expenses.wht_certificates', 'expenses.categories']);
    assert.deepEqual(keys(false).slice(0, 4), ['expenses.list', 'expenses.upload', 'expenses.wht_certificates', 'expenses.categories']);
  });
  it('hides the role matrix at every UI gate from a role reader', () => {
    const permissions = ['access.role.read'];
    const navItems = buildNavItems(
      filterModulesByPermissions(WORKSPACE_MODULES, permissions),
      'company-1',
      'th',
      {},
      permissions,
    );

    assert.ok(!navItems.flatMap((item) => item.subItems ?? []).some((item) => item.key === 'roles.permissions'));
    assert.ok(!filterSettingsMenuItems(permissions).some((item) => item.href === '/settings/permissions'));
    assert.equal(
      canAccessWorkspacePath(
        WORKSPACE_MODULES,
        permissions,
        'company-1',
        '/companies/company-1/settings/permissions',
      ),
      false,
    );
    assert.ok(React.isValidElement(requireRoutePermission({ permissions }, '/settings/permissions')));
    assert.equal(
      requireRoutePermission({ permissions: ['access.role.manage'] }, '/settings/permissions'),
      null,
    );
  });
});

it('withholding menu and both addresses keep the existing narrow permissions', () => {
  const module = WORKSPACE_MODULES.find(item => item.key === 'pnd53')!;
  assert.equal(module.buildHref('co'), '/companies/co/tax/withholding');
  assert.equal(module.labelKey, 'module.pnd53');
  assert.equal(t('module.pnd53', 'th'), 'ภาษีหัก ณ ที่จ่าย');
  for (const path of ['/tax/withholding', '/tax/pnd53']) {
    assert.equal(requireRoutePermission({ permissions: ['wht.pnd53.read'] }, path), null);
    assert.ok(React.isValidElement(requireRoutePermission({ permissions: ['tax.report.read'] }, path)));
  }
});

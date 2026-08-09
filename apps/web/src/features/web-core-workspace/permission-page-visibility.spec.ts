import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { filterSettingsMenuItems } from './settings-menu.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';
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

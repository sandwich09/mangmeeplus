import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isActiveNavSubItem, type SidebarSubItemRef } from './app-sidebar.logic';

const shellDir = dirname(fileURLToPath(import.meta.url));

describe('isActiveNavSubItem', () => {
  it('uses the longest matching sibling href', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'expenses.list', href: '/companies/co/expenses' },
      { key: 'expenses.upload', href: '/companies/co/expenses/upload' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[1], subItems), true);
  });

  it('uses the longest matching href across submenu parents', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'settings.overview', href: '/companies/co/settings' },
      { key: 'roles.permissions', href: '/companies/co/settings/permissions' },
      { key: 'lineoa', href: '/companies/co/settings/line-oa' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[2], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[1], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[0], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[1], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[2], subItems), false);
  });
});

describe('workspace account menu placement', () => {
  it('keeps account actions in the sidebar footer and out of the header', () => {
    const sidebarSource = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    const headerSource = readFileSync(join(shellDir, 'AppHeader.tsx'), 'utf8');

    assert.match(sidebarSource, /id="sidebar-user-menu"/);
    assert.match(sidebarSource, /shell\.reset_password/);
    assert.match(sidebarSource, /logoutCurrentSession/);
    assert.doesNotMatch(headerSource, /shell\.user_menu|shell\.reset_password|logoutCurrentSession/);
  });
});

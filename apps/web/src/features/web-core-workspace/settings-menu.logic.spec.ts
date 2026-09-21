import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCKED_ACCOUNT_CARD,
  filterSettingsMenuItems,
  filterSettingsSidebarItems,
  showsLockedAccountCard,
  SETTINGS_MENU_ITEMS,
} from './settings-menu.logic';
import { canAccessWorkspacePath } from './web-core-workspace.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';
import { findRoutePermissionRule } from './route-permissions';

describe('settings menu', () => {
  it('defines the guided setup entry and existing settings cards on registered routes', () => {
    assert.deepEqual(
      SETTINGS_MENU_ITEMS.map(({ title, href }) => [title, href]),
      [
        ['ข้อมูลร้านและบัญชีของฉัน', '/settings/profile'],
        ['เชื่อมต่อ LINE OA', '/settings/line-oa'],
        ['สินค้าและบริการสำหรับ CRM', '/settings/crm-catalog'],
        ['สาขา', '/settings/branches'],
        ['ตั้งค่าบัญชีและภาษี', '/settings/accounting-tax-setup'],
        ['ตั้งค่าใบรับรองแทนใบเสร็จ', '/settings/substitute-receipt'],
        ['Tax Code และ Tax Profile', '/settings/tax-codes'],
        ['Tax Account Determination', '/settings/tax-accounts'],
        ['ผังบัญชี Master Data', '/settings/chart-of-accounts'],
      ],
    );
    for (const item of SETTINGS_MENU_ITEMS) assert.ok(findRoutePermissionRule(item.href), item.key);
  });

  it('shows all eight cards to a fully permitted user', () => {
    // account-security is parked (owner decision 2026-08-05), so its card no longer counts.
    assert.equal(filterSettingsMenuItems([
      'company.setup.read',
      'crm.channel.manage',
      'inventory.product.read',
      'account.password.change',
      'company.branch.read',
      'tax.profile.read',
      'ledger.posting-rule.read',
      'ledger.account.read',
    ]).length, 8);
  });

  it('filters every card by any listed permission', () => {
    assert.deepEqual(filterSettingsMenuItems([]).map((item) => item.key), []);
    assert.deepEqual(
      filterSettingsMenuItems(['inventory.product.read', 'company.branch.manage']).map((item) => item.key),
      ['crm-catalog', 'branches'],
    );
  });

  it('keeps the parked account-security card out of the menu entirely', () => {
    assert.deepEqual(filterSettingsMenuItems(['account.session.read']), []);
    assert.deepEqual(filterSettingsMenuItems(['account.identity.link']), []);
  });

  // The read-only viewer role holds company.settings.view and can run no step of the accounting
  // and tax wizard, so offering it was a dead end — the same defect as the Tax Code empty state
  // linking every user to a setup they must not complete.
  // A company owning neither double_entry_ledger nor thai_tax has every one of these keys
  // stripped by the resolver, so the card disappears on its own — no menu-level entitlement
  // check needed. The two keys that used to survive that stripping are asserted below.
  it('keeps the accounting/tax wizard off users and companies that cannot run it', () => {
    // Asserted against the wizard by name, not an empty menu: company.setup.manage legitimately
    // owns the substitute-receipt card, and pinning the whole list here would re-break this test
    // every time an unrelated always-on card ships.
    for (const alwaysOn of ['company.settings.view', 'company.setup.manage']) {
      assert.ok(
        !filterSettingsMenuItems([alwaysOn]).some((item) => item.key === 'accounting-tax-setup'),
        `${alwaysOn} must not open the wizard on its own`);
    }
    for (const permission of ['ledger.account.read', 'tax.profile.read', 'tax.config.manage']) {
      assert.ok(
        filterSettingsMenuItems([permission]).some((item) => item.key === 'accounting-tax-setup'),
        `${permission} should still reach the wizard`,
      );
    }
  });

  it('opens each settings route to exactly the registry permissions its card uses', () => {
    const companyId = 'co-1';
    for (const item of SETTINGS_MENU_ITEMS) {
      const path = `/companies/${companyId}${item.href}`;
      const rule = findRoutePermissionRule(item.href);
      assert.ok(rule, `${item.key}: missing route rule`);
      assert.ok(!filterSettingsMenuItems([]).some((candidate) => candidate.key === item.key));
      for (const permission of rule.anyOf) {
        assert.ok(
          filterSettingsMenuItems([permission]).some((candidate) => candidate.key === item.key),
          `${item.key}: card is hidden on ${permission}`,
        );
        assert.ok(
          canAccessWorkspacePath(WORKSPACE_MODULES, [permission], companyId, path),
          `${item.key}: card is offered on ${permission} but the route refuses it`,
        );
      }
    }
    // The inverse for the wizard specifically: the viewer permission opens neither.
    assert.deepEqual(filterSettingsMenuItems(['company.settings.view']).map((i) => i.key), []);
    assert.equal(
      canAccessWorkspacePath(WORKSPACE_MODULES, ['company.settings.view'], companyId,
        `/companies/${companyId}/settings/accounting-tax-setup`),
      false,
    );
  });

  // Owner 2026-09-20 (spec §12): the hub is one of the two pages a shop with no package may open,
  // so every card that leads somewhere the term guard refuses has to be gone from it.
  it('keeps only ข้อมูลร้านและบัญชีของฉัน while the shop has no usable package', () => {
    const everything = [
      'company.setup.read', 'crm.channel.manage', 'inventory.product.read', 'company.branch.read',
      'tax.profile.read', 'ledger.posting-rule.read', 'ledger.account.read',
    ];
    assert.deepEqual(filterSettingsMenuItems(everything, true).map((item) => item.key), ['company-profile']);
    assert.equal(filterSettingsMenuItems(everything).length, 8, 'an unlocked shop keeps every card');
    // Being locked never opens a card the member could not open anyway.
    assert.deepEqual(filterSettingsMenuItems(['company.branch.read'], true), []);
  });

  // ข้อมูลร้านและบัญชีของฉัน needs company.setup.read, which staff do not have — so without this the
  // one menu they are given in the locked shell opened an empty page.
  it('gives a locked member with no company card the account card instead', () => {
    assert.equal(showsLockedAccountCard(['expense.read'], true), true);
    assert.equal(showsLockedAccountCard(['company.setup.read'], true), false, 'the owner gets the shop card');
    assert.deepEqual(filterSettingsMenuItems(['company.setup.read'], true).map((item) => item.key), ['company-profile']);
    // Never outside the locked shell: an unlocked hub already has its own cards.
    assert.equal(showsLockedAccountCard(['expense.read'], false), false);
    // Both pages live outside the company workspace, which is why a locked term still serves them.
    assert.deepEqual(LOCKED_ACCOUNT_CARD.links.map((link) => link.href), ['/change-password', '/account/email']);
  });

  it('orders only company accounting/security routes in the settings sidebar', () => {
    assert.deepEqual(
      filterSettingsSidebarItems([
        'company.settings.view', 'ledger.account.read', 'tax.profile.read',
        'tax.config.read', 'ledger.posting-rule.read', 'company.branch.read', 'account.identity.link',
      ]).map((item) => item.key),
      ['accounting-tax-setup', 'chart-of-accounts', 'tax-codes', 'tax-accounts', 'branches'],
    );
  });
});

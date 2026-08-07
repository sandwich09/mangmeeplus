import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterSettingsMenuItems, filterSettingsSidebarItems, SETTINGS_MENU_ITEMS } from './settings-menu.logic';
import { canAccessWorkspacePath } from './web-core-workspace.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';

describe('settings menu', () => {
  it('defines the guided setup entry and existing settings cards with permission gates', () => {
    assert.deepEqual(
      SETTINGS_MENU_ITEMS.map(({ title, requiredAnyPermissions }) => [title, requiredAnyPermissions]),
      [
        ['เชื่อมต่อ LINE OA', ['crm.channel.read']],
        ['สินค้าและบริการสำหรับ CRM', ['inventory.product.read']],
        ['สาขา', ['company.branch.read', 'company.branch.manage']],
        ['ตั้งค่าบัญชีและภาษี', [
          'ledger.account.read', 'ledger.account.manage',
          'tax.profile.read', 'tax.profile.manage', 'tax.config.read', 'tax.config.manage',
        ]],
        ['ตั้งค่าใบรับรองแทนใบเสร็จ', ['company.setup.manage']],
        ['Tax Code และ Tax Profile', ['tax.profile.read', 'tax.profile.manage', 'tax.config.read', 'tax.config.manage']],
        ['Tax Account Determination', ['tax.config.read', 'tax.config.manage', 'ledger.posting-rule.read', 'ledger.posting-rule.manage']],
        ['ผังบัญชี Master Data', ['ledger.account.read', 'ledger.account.manage']],
      ],
    );
  });

  it('shows all seven cards to a fully permitted user', () => {
    // account-security is parked (owner decision 2026-08-05), so its card no longer counts.
    assert.equal(filterSettingsMenuItems([
      'crm.channel.read',
      'inventory.product.read',
      'account.password.change',
      'company.branch.read',
      'tax.profile.read',
      'ledger.posting-rule.read',
      'ledger.account.read',
    ]).length, 7);
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

  // The card gate and the route guard are two lists describing one door. They drifted once
  // already: the card stopped offering the wizard to a read-only viewer while the route kept
  // letting them in by URL. Every settings card that has a route guard is pinned here.
  it('opens each settings route to exactly the permissions its card is offered on', () => {
    const companyId = 'co-1';
    for (const item of SETTINGS_MENU_ITEMS) {
      const path = `/companies/${companyId}${item.href}`;
      for (const permission of item.requiredAnyPermissions) {
        assert.ok(
          canAccessWorkspacePath(WORKSPACE_MODULES, [permission, 'company.settings.view'], companyId, path),
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

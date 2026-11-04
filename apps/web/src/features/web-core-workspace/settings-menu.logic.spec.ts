import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shopHasSystemWhtCertificates } from '../expenses/expense-wht-certificates.logic';
import {
  LOCKED_ACCOUNT_CARD,
  PACKAGE_MENU,
  filterSettingsMenuItems,
  filterSettingsSidebarItems,
  showsLockedAccountCard,
  SETTINGS_MENU_ITEMS,
} from './settings-menu.logic';
import { canAccessWorkspacePath } from './web-core-workspace.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';
import { findRoutePermissionRule } from './route-permissions';
import { companyProfileReturnLabel } from '../company-profile/company-profile.logic';

it('PWS-SETTINGS keeps the VAT return label and the sold settings wording tied to existing routes', () => {
  assert.equal(companyProfileReturnLabel('/companies/shop/expenses/record#expense-input-vat-review'), 'กลับไปตรวจ VAT สำหรับยื่นภาษี');
  const branches = readFileSync(new URL('../branch-settings/BranchSettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(branches, /5 หลักตามใบทะเบียนภาษี เว้นว่างได้/);
  const payer = readFileSync(new URL('../branch-settings/WhtPayerModeSettings.tsx', import.meta.url), 'utf8');
  assert.match(payer, /ใครจ่ายเงินและหักภาษี/);
  assert.match(payer, /แบบภาษีหัก ณ ที่จ่ายยื่นในนามผู้ที่จ่ายจริง/);
  assert.deepEqual(filterSettingsSidebarItems(['company.setup.read', 'company.branch.read']).map(item => item.title), ['ข้อมูลร้าน', 'สาขา']);
});

describe('settings menu', () => {
  it('WHT-OUTSIDE hides signature setup by shop availability even when the reader manages signatures', () => {
    const permissions = ['company.tax_signature.manage'];
    for (const available of [false, true]) {
      assert.equal(filterSettingsMenuItems(permissions, false, available).some(item => item.key === 'tax-signature'), available);
      assert.equal(filterSettingsSidebarItems(permissions, available).some(item => item.key === 'tax-signature'), available);
    }
    assert.equal(shopHasSystemWhtCertificates(undefined), false);
    assert.equal(shopHasSystemWhtCertificates(null), true, 'the server null sentinel means every feature is entitled for an unconfigured legacy shop');
    assert.equal(shopHasSystemWhtCertificates(['wht.certificate.read', 'company.tax_signature.manage']), false);
    assert.equal(shopHasSystemWhtCertificates(['wht.certificate.issue']), false);
    assert.equal(shopHasSystemWhtCertificates(['thai_tax']), false);
    assert.equal(shopHasSystemWhtCertificates(['wht_50bis']), true);
    const route = readFileSync(new URL('../../../app/(workspace)/companies/[companyId]/settings/tax-signature/page.tsx', import.meta.url), 'utf8');
    assert.match(route, /!shopHasSystemWhtCertificates\(session\?\.entitledFeatureKeys\).*redirect\(/);
  });
  it('defines the guided setup entry and existing settings cards on registered routes', () => {
    assert.deepEqual(
      SETTINGS_MENU_ITEMS.map(({ title, href }) => [title, href]),
      [
        // What a sold shop sees comes first, in the order of the hub (2026-10-13).
        ['ข้อมูลร้าน', '/settings/profile'],
        ['บัญชีของฉัน', '/settings/profile'],
        ['สาขา', '/settings/branches'],
        ['พนักงานและสิทธิ์', '/settings/access-overview'],
        ['ตั้งค่าใบรับรองแทนใบเสร็จ', '/settings/substitute-receipt'],
        ['จ่ายผ่าน e-WHT ของธนาคาร', '/settings/e-wht'],
        ['ลายเซ็นบน 50 ทวิ', '/settings/tax-signature'],
        ['เชื่อมต่อ LINE OA', '/settings/line-oa'],
        ['สินค้าและบริการสำหรับ CRM', '/settings/crm-catalog'],
        ['ตั้งค่าบัญชีและภาษี', '/settings/accounting-tax-setup'],
        ['Tax Code และ Tax Profile', '/settings/tax-codes'],
        ['Tax Account Determination', '/settings/tax-accounts'],
        ['ผังบัญชี Master Data', '/settings/chart-of-accounts'],
      ],
    );
    for (const item of SETTINGS_MENU_ITEMS) assert.ok(findRoutePermissionRule(item.href), item.key);
    // One page, two cards: the second opens the person's own part of it.
    assert.deepEqual(SETTINGS_MENU_ITEMS.filter((item) => item.hash).map((item) => [item.key, item.hash]), [['my-account', '#account']]);
    // The 50 ทวิ signature is an ordinary card: it used to be the only row of a "การตั้งค่าขั้นสูง" block in a sold shop.
    assert.equal(SETTINGS_MENU_ITEMS.find((item) => item.key === 'tax-signature')?.section, undefined);
    // The package page has no settings route: its one top-level entry follows the company grant alone.
    assert.deepEqual([PACKAGE_MENU.title, PACKAGE_MENU.href], ['แพ็กเกจ', '/billing']);
  });

  it('shows all ten cards to a fully permitted user', () => {
    // account-security is parked (owner decision 2026-08-05), so its card no longer counts.
    // Ten since 2026-10-13: the profile page has two cards (the shop's details, the person's own account).
    assert.equal(filterSettingsMenuItems([
      'company.setup.read',
      'crm.channel.manage',
      'inventory.product.read',
      'account.password.change',
      'company.branch.read',
      'tax.profile.read',
      'ledger.posting-rule.read',
      'ledger.account.read',
      'company.tax_signature.manage',
    ]).length, 10);
  });

  it('filters every card by any listed permission', () => {
    assert.deepEqual(filterSettingsMenuItems([]).map((item) => item.key), []);
    assert.deepEqual(
      filterSettingsMenuItems(['inventory.product.read', 'company.branch.manage']).map((item) => item.key),
      ['branches', 'crm-catalog'],
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
  it('keeps only ข้อมูลร้าน and บัญชีของฉัน while the shop has no usable package', () => {
    const everything = [
      'company.setup.read', 'crm.channel.manage', 'inventory.product.read', 'company.branch.read',
      'tax.profile.read', 'ledger.posting-rule.read', 'ledger.account.read',
    ];
    assert.deepEqual(filterSettingsMenuItems(everything, true).map((item) => item.key), ['company-profile', 'my-account']);
    assert.equal(filterSettingsMenuItems(everything).length, 9, 'an unlocked shop keeps every card');
    // Being locked never opens a card the member could not open anyway.
    assert.deepEqual(filterSettingsMenuItems(['company.branch.read'], true), []);
  });

  // ข้อมูลร้าน and บัญชีของฉัน need company.setup.read, which staff do not have — so without this the
  // one menu they are given in the locked shell opened an empty page.
  it('gives a locked member with no company card the account card instead', () => {
    assert.equal(showsLockedAccountCard(['expense.read'], true), true);
    assert.equal(showsLockedAccountCard(['company.setup.read'], true), false, 'the owner gets the shop card');
    assert.deepEqual(filterSettingsMenuItems(['company.setup.read'], true).map((item) => item.key), ['company-profile', 'my-account']);
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

  // 2026-10-13: the shop's details had no row (three names led to one form), and the policy page sat with the daily
  // expense rows. A sold shop reads these four, top to bottom.
  it('gives a sold shop the rows it looks for under ตั้งค่าร้าน', () => {
    assert.deepEqual(
      filterSettingsSidebarItems(['company.setup.read', 'company.setup.manage', 'company.branch.read', 'company.tax_signature.manage'])
        .map((item) => [item.key, item.title]),
      [['company-profile', 'ข้อมูลร้าน'], ['branches', 'สาขา'], ['substitute-receipt', 'ตั้งค่าใบรับรองแทนใบเสร็จ'], ['e-wht', 'จ่ายผ่าน e-WHT ของธนาคาร'], ['tax-signature', 'ลายเซ็นบน 50 ทวิ']],
    );
  });
});

it('settings view-only and manage-only both list profile and branches without granting unrelated cards', () => {
  for (const permissions of [['company.setup.read', 'company.branch.read', 'document.sequence.read'], ['company.setup.manage', 'company.branch.manage', 'document.sequence.manage']]) {
    const keys = filterSettingsSidebarItems(permissions).map(item => item.key);
    assert.ok(keys.includes('company-profile'));
    assert.ok(keys.includes('branches'));
    assert.ok(!keys.includes('tax-signature'));
    assert.ok(!keys.includes('accounting-tax-setup'));
  }
});

it('the overview has no second package entry', () => {
  const source = readFileSync(new URL('./SettingsMenu.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /PACKAGE_CARD|PACKAGE_MENU|packageCard|showsPackageCard/);
  assert.equal(filterSettingsMenuItems(['company.plan.manage']).length, 0);
});

describe('e-WHT settings', () => {
  it('R20 card and sidebar require setup manage in every paid pack and are absent from the free shell', () => {
    for (const permissions of [[], ['expense.review'], ['company.setup.manage']]) {
      const allowed = permissions.includes('company.setup.manage');
      assert.equal(filterSettingsMenuItems(permissions).some(row => row.key === 'e-wht'), allowed);
      assert.equal(filterSettingsSidebarItems(permissions).some(row => row.key === 'e-wht'), allowed);
      assert.equal(filterSettingsMenuItems(permissions, true).some(row => row.key === 'e-wht'), false);
    }
    assert.deepEqual(findRoutePermissionRule('/settings/e-wht')?.anyOf, ['company.setup.manage']);
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['company.setup.manage'], 'co', '/companies/co/settings/e-wht', true), false);
  });
});

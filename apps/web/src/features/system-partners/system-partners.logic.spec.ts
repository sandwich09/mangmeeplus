import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  FEATURE_CATALOG,
  FEATURE_PACKAGE_PRESETS,
  MENU_ENTITLEMENT_BINDINGS,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  applyPreset,
  buildMenuCards,
  cascadeOffItems,
  changedEntitlements,
  commandFailureMessage,
  isAmbiguousCommandFailure,
  dependencyBlockMessage,
  disableBlockForChange,
  diffEntitlements,
  entitlementEnabled,
  featurePackageEditingNotice,
  filterMenuCards,
  isNormalizationPending,
  previewNavGroups,
  toggleMenuCard,
  toggleMenuGroup,
  toggleSubmenu,
  manualWebEntryRow,
  MANUAL_WEB_ENTRY_COPY,
  MANUAL_WEB_ENTRY_SUBMENU_KEY,
  NORMALIZATION_PENDING_NOTICE,
  NOT_DISABLED_NOTICE,
} from './system-partners.logic';

const binding = (navKey: string) => {
  const found = MENU_ENTITLEMENT_BINDINGS.find((candidate) => candidate.navKey === navKey);
  assert.ok(found, `missing binding ${navKey}`);
  return found;
};

const enabledState = (...disabledKeys: string[]) => (
  ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
    featureKey,
    enabled: !disabledKeys.includes(featureKey),
  }))
);

describe('buildMenuCards', () => {
  it('keeps binding order and applies parent, child, default, and legacy inheritance', () => {
    const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, [
      { featureKey: 'crm', enabled: true },
      { featureKey: 'crm.bookings', enabled: false },
      { featureKey: 'inventory', enabled: true },
    ]);

    assert.deepEqual(
      cards.map((card) => card.navKey),
      MENU_ENTITLEMENT_BINDINGS.filter((item) => item.navigation !== 'contextual').map((item) => item.navKey),
    );
    assert.equal(cards.find((card) => card.navKey === 'inbox')?.enabled, true);
    assert.equal(cards.find((card) => card.navKey === 'booking')?.enabled, false);
    assert.equal(cards.find((card) => card.navKey === 'crmsettings')?.enabled, true);
    assert.equal(cards.find((card) => card.navKey === 'lineoa')?.enabled, true);
  });

  it('renders foundation cards as always on and attaches only owned submenu rows', () => {
    const cards = buildMenuCards(
      MENU_ENTITLEMENT_BINDINGS,
      FEATURE_CATALOG,
      enabledState('company_settings'),
    );
    const settings = cards.find((card) => card.navKey === 'settings');
    const procurement = cards.find((card) => card.navKey === 'procurement');
    const payable = cards.find((card) => card.navKey === 'accounts-payable');

    assert.equal(settings?.enabled, true);
    assert.deepEqual(
      settings?.submenus.map(({ key, enabled }) => ({ key, enabled })),
      [
        { key: 'company_settings.branches', enabled: false },
        { key: 'company_settings.security', enabled: false },
      ],
    );
    assert.deepEqual(
      procurement?.submenus.map((submenu) => submenu.key),
      [
        'procurement.suppliers',
        'procurement.purchase_requests',
        'procurement.purchase_orders',
        'procurement.goods_receipts',
      ],
    );
    assert.deepEqual(
      payable?.submenus.map((submenu) => submenu.key),
      [
        'procurement.vendor_bills',
        'procurement.supplier_payments',
        'procurement.ap_aging',
      ],
    );
    assert.deepEqual(cards.find((card) => card.navKey === 'dashboard')?.submenus, []);
    assert.deepEqual(
      cards.find((card) => card.navKey === 'notifications')?.submenus.map((submenu) => submenu.key),
      ['dashboard_notifications.preferences', 'dashboard_notifications.rules'],
    );
  });

  it('uses the actual workspace route and mirrors the API fail-open for a zero-row company', () => {
    const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, []);
    assert.equal(cards.find((card) => card.navKey === 'crmsettings')?.route, '/settings/crm-catalog');
    assert.ok(cards.every((card) => card.enabled));
    // No rows is the API's legacy fail-open sentinel (entitlement.helper.ts returns null, so
    // EVERY key reads as entitled). Display must not claim otherwise.
    assert.equal(entitlementEnabled([], 'expense_auto_post'), true);
    assert.equal(entitlementEnabled([], 'double_entry_ledger'), true);
  });

  it('mirrors the API platform-baseline rule: absent row on, legacy explicit false still wins', () => {
    for (const featureKey of ['employee_access', 'company_settings']) {
      assert.equal(entitlementEnabled([{ featureKey: 'crm', enabled: true }], featureKey), true);
      assert.equal(entitlementEnabled([{ featureKey, enabled: false }], featureKey), false);
    }
  });
});

describe('toggleMenuCard', () => {
  it('enables the parent and every owned entitlement', () => {
    const next = toggleMenuCard(
      enabledState('procurement', 'procurement.suppliers', 'procurement.purchase_orders'),
      binding('procurement'),
      true,
    );
    const values = new Map(next.map((row) => [row.featureKey, row.enabled]));

    assert.equal(values.get('procurement'), true);
    for (const key of binding('procurement').entitlementKeys) {
      assert.equal(values.get(key), true);
    }
  });

  it('disables a singleton parent but leaves a multi-key card parent and siblings alone', () => {
    const singleton = toggleMenuCard(enabledState(), binding('expenses'), false);
    assert.equal(entitlementEnabled(singleton, 'expenses'), false);

    const procurementOff = toggleMenuCard(enabledState(), binding('procurement'), false);
    const procurementValues = new Map(procurementOff.map((row) => [row.featureKey, row.enabled]));
    assert.equal(procurementValues.get('procurement'), true);
    assert.equal(procurementValues.get('procurement.vendor_bills'), true);
    assert.ok(binding('procurement').entitlementKeys.every((key) => procurementValues.get(key) === false));

    const payableOff = toggleMenuCard(enabledState(), binding('accounts-payable'), false);
    const payableValues = new Map(payableOff.map((row) => [row.featureKey, row.enabled]));
    assert.equal(payableValues.get('procurement'), true);
    assert.equal(payableValues.get('procurement.suppliers'), true);
    assert.ok(binding('accounts-payable').entitlementKeys.every((key) => payableValues.get(key) === false));
  });

  it('does nothing for a foundation card', () => {
    const state = [{ featureKey: 'expenses', enabled: true }];
    assert.deepEqual(toggleMenuCard(state, binding('settings'), false), state);
  });

  it('preserves sparse inheritance so pending preview matches the post-save API state', () => {
    const state = [{ featureKey: 'expenses', enabled: true }];
    const next = toggleMenuCard(state, binding('expenses'), false);

    assert.deepEqual(next, [{ featureKey: 'expenses', enabled: false }]);
    assert.equal(entitlementEnabled(next, 'reimbursement'), false);
    assert.deepEqual(
      changedEntitlements(state, next).map((item) => item.featureKey),
      ['expenses'],
    );
    assert.ok(
      diffEntitlements(state, next).turningOff.some((item) => item.featureKey === 'reimbursement'),
    );
  });
});

describe('toggleMenuGroup', () => {
  it('composes card write rules and ignores foundation bindings', () => {
    const operateBindings = MENU_ENTITLEMENT_BINDINGS.filter((item) => item.group === 'operate');
    const next = toggleMenuGroup(enabledState(), operateBindings, false);
    const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, next);

    assert.ok(cards.filter((card) => card.group === 'operate').every((card) => !card.enabled));
    assert.equal(entitlementEnabled(next, 'procurement'), true);
    assert.equal(entitlementEnabled(next, 'procurement.vendor_bills'), true);
    assert.equal(entitlementEnabled(next, 'company_settings'), true);
  });
});

  describe('toggleSubmenu', () => {
  it('changes only the requested latent child value', () => {
    const state = enabledState();
    const next = toggleSubmenu(state, 'expenses.upload', false);
    const changed = diffEntitlements(state, next);

    assert.deepEqual(changed.turningOn, []);
    assert.deepEqual(changed.turningOff.map((item) => item.featureKey), ['expenses.upload']);
    assert.equal(entitlementEnabled(next, 'expenses.upload'), false);
  });

  it('enables the parent when restoring a foundation submenu', () => {
    const state = enabledState('company_settings');
    const next = toggleSubmenu(state, 'company_settings.branches', true);

    assert.equal(entitlementEnabled(state, 'company_settings.branches'), false);
    assert.equal(entitlementEnabled(next, 'company_settings'), true);
    assert.equal(entitlementEnabled(next, 'company_settings.branches'), true);
  });
});

describe('applyPreset', () => {
  for (const presetKey of ['starter', 'standard', 'full'] as const) {
    it(`applies the exact ${presetKey} contract set and always turns auto-post off`, () => {
      const next = applyPreset(enabledState(), presetKey);
      const enabledKeys = next.filter((row) => row.enabled).map((row) => row.featureKey).sort();

      assert.deepEqual(enabledKeys, [...FEATURE_PACKAGE_PRESETS[presetKey].featureKeys].sort());
      assert.equal(entitlementEnabled(next, 'expense_auto_post'), false);
    });
  }
});

describe('diffEntitlements', () => {
  it('keeps background AI editable and names its actual capability in the review', () => {
    const before = applyPreset([], 'starter');
    assert.equal(entitlementEnabled(before, 'ai_line_assistant'), true);
    assert.equal(buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, before).some(card => card.navKey === 'ai-suggestions'), false);
    const next = toggleSubmenu(before, 'ai_line_assistant', false);
    assert.deepEqual(changedEntitlements(before, next), [{ featureKey: 'ai_line_assistant', enabled: false }]);
    assert.equal(diffEntitlements(before, next).turningOff[0]?.labelTh, 'ผู้ช่วย AI ทาง LINE');
  });
  it('reports every effective child restored by a parent with Thai labels', () => {
    const server = enabledState('expenses');
    const pending = toggleMenuCard(server, binding('expenses'), true);
    const diff = diffEntitlements(server, pending);

    assert.deepEqual(diff.turningOff, []);
    // expenses.signatures is sellable again (265f8578) even though its nav entry stays hidden —
    // FEATURE_CATALOG decides what a company may buy, the nav decides what it can reach.
    assert.deepEqual(
      diff.turningOn.map((item) => item.featureKey),
      [
        'expenses',
        'expenses.list',
        'expenses.upload',
        'expenses.manual',
        'expenses.categories',
        'expenses.evidence',
        'expenses.signatures',
      ],
    );
    assert.equal(diff.turningOn[0]?.labelTh, 'ค่าใช้จ่ายและใบเสร็จ / คู่ค้า');
    assert.deepEqual(changedEntitlements(server, pending), [
      { featureKey: 'expenses', enabled: true },
    ]);
  });

  it('reports separate on and off lists', () => {
    const server = enabledState('reports');
    const pending = toggleSubmenu(server, 'expenses.upload', false);
    const withReports = toggleMenuCard(pending, binding('reports'), true);
    const diff = diffEntitlements(server, withReports);

    assert.deepEqual(diff.turningOn.map((item) => item.featureKey), ['reports']);
    assert.deepEqual(diff.turningOff.map((item) => item.featureKey), ['expenses.upload']);
  });

  it('materializes the fail-open snapshot on every first write from zero rows', () => {
    const full = applyPreset([], 'full');
    const presetDiff = diffEntitlements([], full);
    const direct = toggleMenuCard([], binding('expenses'), false);
    const directDiff = diffEntitlements([], direct);
    const directWrites = changedEntitlements([], direct);
    const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, direct);

    // The zero-row company displays the API's fail-open set (everything on). Normalising it to an
    // explicit set genuinely turns expense_auto_post off — CC7 (spec:236) enables it only with
    // execution evidence, and the API refuses it until chart-posting readiness passes. The review
    // diff must say so instead of hiding the one real change.
    assert.deepEqual(presetDiff, {
      turningOn: [],
      turningOff: [{
        featureKey: 'expense_auto_post',
        labelTh: 'ลงบัญชีค่าใช้จ่ายอัตโนมัติ',
        enabled: false,
      }],
    });
    assert.equal(changedEntitlements([], full).length, ALL_FEATURE_ENTITLEMENT_KEYS.length);
    assert.deepEqual(
      directDiff.turningOff.map((item) => item.featureKey),
      [
        'expenses',
        'expenses.list',
        'expenses.upload',
        'expenses.manual',
        'expenses.categories',
        'expenses.evidence',
        'expenses.signatures',
        'expense_auto_post',
      ],
    );
    assert.equal(directWrites.length, ALL_FEATURE_ENTITLEMENT_KEYS.length);
    assert.equal(cards.find((card) => card.navKey === 'expenses')?.enabled, false);
    // `counterparties` is parented to `expenses`, so it goes dark with it. The registry serves the
    // sales side too, but a binding has one parent and CON-3 rules out making it `sales_documents`
    // — a shop with sales closed must keep the vendor side. A sales-only company reaches the same
    // rows through the accounting page's own list.
    assert.equal(cards.find((card) => card.navKey === 'counterparties')?.enabled, false);
    assert.ok(cards
      .filter((card) => card.navKey !== 'expenses' && card.navKey !== 'counterparties')
      .every((card) => card.enabled));
  });
});

describe('previewNavGroups', () => {
  it('preserves sidebar group and card order with enabled state', () => {
    const cards = buildMenuCards(
      MENU_ENTITLEMENT_BINDINGS,
      FEATURE_CATALOG,
      enabledState('crm.inbox'),
    );
    const groups = previewNavGroups(cards);

    assert.deepEqual(groups.map((group) => group.group), [
      'main',
      'operate',
      'finance',
      'growth',
      'admin',
    ]);
    assert.equal(groups.find((group) => group.group === 'operate')?.labelTh, 'ลูกค้าและการขาย');
    assert.equal(groups[1]?.items[0]?.navKey, 'inbox');
    assert.equal(groups[1]?.items[0]?.enabled, false);
  });
});

describe('filterMenuCards', () => {
  const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, enabledState());

  it('matches Thai labels, route, and normalized internal keys', () => {
    assert.deepEqual(filterMenuCards(cards, 'การเบิกจ่าย').map((card) => card.navKey), ['reimbursements']);
    assert.deepEqual(filterMenuCards(cards, '/settings/crm-catalog').map((card) => card.navKey), ['crmsettings']);
    assert.deepEqual(filterMenuCards(cards, 'accounts payable').map((card) => card.navKey), ['accounts-payable']);
  });

  it('auto-expands a child-only match and returns all cards for a blank query', () => {
    const [result] = filterMenuCards(cards, 'expenses.upload');
    assert.equal(result.autoExpand, true);
    assert.deepEqual(result.visibleSubmenus.map((submenu) => submenu.key), ['expenses.upload']);
    assert.equal(filterMenuCards(cards, '   ').length, cards.length);
    assert.equal(filterMenuCards(cards, 'ไม่พบ').length, 0);
  });
});

describe('dependencyBlockMessage', () => {
  it('accepts a set that satisfies the contracts matrix', () => {
    assert.equal(dependencyBlockMessage(enabledState(), enabledState()), null);
    assert.equal(
      dependencyBlockMessage(
        enabledState('expense_auto_post', 'double_entry_ledger'),
        enabledState('expense_auto_post', 'double_entry_ledger'),
      ),
      null,
    );
  });

  it('blocks a child enabled without its prerequisite', () => {
    const current = enabledState('double_entry_ledger', 'expense_auto_post');
    const next = toggleSubmenu(current, 'expense_auto_post', true);
    const message = dependencyBlockMessage(current, next);
    assert.match(message ?? '', /double_entry_ledger/);
    assert.match(message ?? '', /expense_auto_post/);
  });

  it('routes a parent disable under an active child to explicit cascade preview', () => {
    const current = enabledState();
    const next = toggleSubmenu(current, 'procurement.vendor_bills', false);
    assert.equal(dependencyBlockMessage(current, next), null);
    assert.deepEqual(
      cascadeOffItems(next).map(({ featureKey }) => featureKey),
      ['procurement.ap_aging', 'procurement.supplier_payments'],
    );
  });
});

describe('disableBlockForChange — directional readiness', () => {
  const readiness = (canDisable: boolean) => ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
    featureKey,
    canDisable,
    disableReason: canDisable ? undefined : 'ยังปิดไม่ได้',
  }));

  it('blocks ON→OFF but leaves OFF→ON available', () => {
    const on = enabledState();
    const off = toggleMenuCard(on, binding('inventory'), false);
    assert.deepEqual(disableBlockForChange(on, off, readiness(false)), {
      reason: 'ยังปิดไม่ได้',
      featureKeys: [
        'inventory',
        'inventory.locations',
        'inventory.movements',
        'inventory.stock_report',
      ],
    });
    assert.equal(disableBlockForChange(off, on, readiness(false)), null);
  });

  it('lets an initially-OFF feature return to OFF after a temporary unsaved ON', () => {
    const server = enabledState('inventory');
    const temporaryOn = toggleMenuCard(server, binding('inventory'), true);
    const reverted = toggleMenuCard(temporaryOn, binding('inventory'), false);

    assert.deepEqual(changedEntitlements(server, reverted), []);
    assert.equal(disableBlockForChange(server, reverted, readiness(false)), null);
  });

  it('blocks a preset downgrade and checks every cascade-dependent key', () => {
    const full = enabledState();
    assert.ok(disableBlockForChange(full, applyPreset(full, 'starter'), readiness(false)));

    const next = toggleSubmenu(full, 'procurement.vendor_bills', false);
    const block = disableBlockForChange(full, next, readiness(false));
    assert.deepEqual(block?.featureKeys, [
      'procurement.vendor_bills',
      'procurement.ap_aging',
      'procurement.supplier_payments',
    ]);
  });

  it('fails closed when an older detail response has no readiness field', () => {
    const current = enabledState();
    const next = toggleMenuCard(current, binding('inventory'), false);
    assert.equal(
      disableBlockForChange(current, next, current)?.reason,
      'ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้',
    );
  });

  it('keeps zero-row legacy features on without suggesting reload will normalize them', () => {
    const current: { featureKey: string; enabled: boolean }[] = [];
    const cards = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, current);
    assert.ok(cards.every((card) => card.enabled), 'legacy effective access must not change');
    const next = toggleMenuCard(current, binding('inventory'), false);
    const block = disableBlockForChange(current, next, current);
    assert.ok(block);
    assert.equal(block.reason, 'ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้');
    assert.doesNotMatch(block.reason, /โหลด|รีเฟรช/);
    assert.deepEqual(current, [], 'copy resolution must not materialize legacy rows');
  });
});

describe('feature package editing guidance', () => {
  it('says neither direction is available while the existing controls are locked', () => {
    assert.equal(featurePackageEditingNotice(true), 'ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้');
    for (const pending of [true, undefined]) {
      assert.equal(
        featurePackageEditingNotice(isNormalizationPending(pending)),
        'ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้',
      );
    }
  });

  // The manual-expense web menu switch is no entitlement: it still works while the package switches
  // wait for their rights to be prepared, so a notice that said nothing could change would be untrue.
  it('names the one switch that still works while the package switches are locked, and only while it does', () => {
    assert.equal(featurePackageEditingNotice(true, true), 'ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้ ยกเว้นสวิตช์ “แสดงเมนูบันทึกด้วยมือบนเว็บ”');
    assert.equal(featurePackageEditingNotice(true, false), 'ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้');
    assert.equal(featurePackageEditingNotice(false, true), 'ตรวจสอบรายการที่เลือกก่อนบันทึก การเปลี่ยนแปลงจะมีผลเมื่อบันทึกสำเร็จ');
  });

  it('explains review and save when editable without promising every feature can change', () => {
    assert.equal(
      featurePackageEditingNotice(false),
      'ตรวจสอบรายการที่เลือกก่อนบันทึก การเปลี่ยนแปลงจะมีผลเมื่อบันทึกสำเร็จ',
    );
    assert.doesNotMatch(featurePackageEditingNotice(false), /เปิดเพิ่มยังทำได้/);
  });
});

/**
 * F1.5.1 item 1 — the partner screen must (a) go read-only with the API's own sentence while the
 * company's entitlement rows are being normalized, and (b) never leave a switch reading OFF after
 * a refused save, because a refusal writes nothing.
 */
describe('entitlement command refusal copy (F1.5.1)', () => {
  it('uses exactly the sentence the API error map renders for the pending code', () => {
    assert.equal(
      translateApiError('company_entitlement_normalization_pending'),
      NORMALIZATION_PENDING_NOTICE,
      'the banner and the toast must not drift apart',
    );
    assert.equal(NORMALIZATION_PENDING_NOTICE, 'ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ');
  });

  it('adds "ยังไม่ได้ปิด" when the refused save was trying to turn something off', () => {
    // The remaining disable refusal is the platform invariant: freeze-in-place (owner decision
    // 2026-08-04) removed `feature_disable_pending_runoff` along with the rule behind it.
    const refusal = translateApiError('platform_feature_not_disableable') ?? '';
    const message = commandFailureMessage(refusal, 1);
    assert.ok(message.startsWith(refusal), 'the server reason still leads');
    assert.ok(message.includes(NOT_DISABLED_NOTICE));
    assert.equal(NOT_DISABLED_NOTICE, 'ยังไม่ได้ปิด');
    assert.ok(!refusal.includes('ข้อมูลจะหาย'), 'never imply data loss — the entitlement did not change');
  });

  it('leaves a pure-enable failure alone — nothing was being turned off', () => {
    assert.equal(commandFailureMessage('บันทึกไม่สำเร็จ', 0), 'บันทึกไม่สำเร็จ');
    assert.ok(!commandFailureMessage('บันทึกไม่สำเร็จ', 0).includes(NOT_DISABLED_NOTICE));
  });

  it('never renders an empty toast', () => {
    assert.ok(commandFailureMessage('', 0).length > 0);
    assert.ok(commandFailureMessage('', 2).includes(NOT_DISABLED_NOTICE));
  });
});

describe('ambiguous entitlement command failure', () => {
  it('keeps the idempotency key for network, timeout, throttling and 5xx outcomes', () => {
    for (const status of [undefined, 408, 429, 500, 502, 504]) {
      assert.equal(isAmbiguousCommandFailure(status), true);
    }
  });

  it('treats explicit client refusals and conflicts as final', () => {
    for (const status of [400, 401, 403, 409, 422]) {
      assert.equal(isAmbiguousCommandFailure(status), false);
    }
  });
});

/**
 * F1.5.1 item 1, mixed-version window: the field is typed as required, but a rolling deploy can
 * still serve this page a detail response from an API build that predates it. The unsafe default
 * is "not pending" — that leaves the toggles editable against a build whose entitlement commands
 * are all refused. Absent must fail closed.
 */
describe('isNormalizationPending — mixed-version default', () => {
  it('treats an old API response with no field as pending, not as normalized', () => {
    assert.equal(isNormalizationPending(undefined), true);
    // How the value actually arrives off an untyped JSON body.
    const legacyDetail = JSON.parse('{"featureEntitlements":[]}') as {
      entitlementNormalizationPending?: boolean;
    };
    assert.equal(isNormalizationPending(legacyDetail.entitlementNormalizationPending), true);
  });

  it('unlocks the switches only on an explicit false', () => {
    assert.equal(isNormalizationPending(false), false);
    assert.equal(isNormalizationPending(true), true);
  });
});

/**
 * The refused-save reset: the page snaps `pending` back to the server rows. The observable
 * contract is that the reset state produces zero changes and zero visible diff again.
 */
describe('refused save resets pending state', () => {
  it('a reset back to the server rows leaves no pending change', () => {
    const server = enabledState();
    const attempted = toggleMenuCard(server, binding('inbox'), false);
    assert.ok(changedEntitlements(server, attempted).length > 0, 'the attempt really did change something');
    assert.ok(diffEntitlements(server, attempted).turningOff.length > 0);

    // What `saveChanges` does on failure: pending := server rows.
    const reset = server.map(({ featureKey, enabled }) => ({ featureKey, enabled }));
    assert.deepEqual(changedEntitlements(server, reset), []);
    assert.deepEqual(diffEntitlements(server, reset), { turningOn: [], turningOff: [] });
  });
});

// manual-expense-web-entry-flag spec §8. "แสดงเมนูบันทึกด้วยมือบนเว็บ" sits under the "บันทึกด้วยมือ" row
// but is a per-company screen setting with its own command — never a key of the entitlement set.
describe('manual-expense web entry row', () => {
  const setting = (enabled: boolean) => ({ enabled, version: enabled ? 1 : 0 });

  it('hangs under the manual-expense submenu and is no entitlement key', () => {
    assert.equal(MANUAL_WEB_ENTRY_SUBMENU_KEY, 'expenses.manual');
    const expenses = FEATURE_CATALOG.find((feature) => feature.key === 'expenses')!;
    assert.ok(expenses.submenus.some((submenu) => submenu.key === MANUAL_WEB_ENTRY_SUBMENU_KEY));
    // AC01: the catalog did not grow, and nothing in it names a web entry.
    assert.equal(ALL_FEATURE_ENTITLEMENT_KEYS.length, 62);
    assert.ok(!ALL_FEATURE_ENTITLEMENT_KEYS.some((key) => /web_entry|webEntry/i.test(key)));
  });

  it('never rides in a preset, a group or card toggle, or the entitlement change set', () => {
    const server = enabledState();
    const onlyCatalogKeys = (rows: ReadonlyArray<{ featureKey: string }>) => rows.every((row) => ALL_FEATURE_ENTITLEMENT_KEYS.includes(row.featureKey));
    for (const presetKey of Object.keys(FEATURE_PACKAGE_PRESETS) as Array<keyof typeof FEATURE_PACKAGE_PRESETS>) {
      const next = applyPreset(server, presetKey);
      assert.ok(onlyCatalogKeys(next), presetKey);
      assert.ok(onlyCatalogKeys(changedEntitlements(server, next)), presetKey);
    }
    const expensesCard = buildMenuCards(MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, server).find((card) => card.navKey === 'expenses')!;
    for (const next of [toggleMenuGroup(server, [expensesCard], false), toggleMenuCard(server, binding('expenses'), false), toggleSubmenu(server, 'expenses.manual', false)]) {
      assert.ok(onlyCatalogKeys(next));
      assert.ok(onlyCatalogKeys(changedEntitlements(server, next)));
      const diff = diffEntitlements(server, next);
      assert.ok(onlyCatalogKeys([...diff.turningOn, ...diff.turningOff]));
    }
  });

  it('can be switched for a shop whose manual-expense feature is on, also a shop without entitlement rows', () => {
    for (const saved of [enabledState(), []]) {
      const row = manualWebEntryRow(saved, setting(false));
      assert.equal(row.parentOpen, true);
      assert.equal(row.parentOffMessage, null);
    }
  });

  it('cannot be switched while the parent features that are SAVED are off, and says what to do', () => {
    for (const off of ['expenses.manual', 'expenses']) {
      for (const stored of [true, false]) {
        const row = manualWebEntryRow(enabledState(off), setting(stored));
        assert.equal(row.parentOpen, false, off);
        assert.equal(row.parentOffMessage, 'เปิดฟีเจอร์บันทึกด้วยมือและบันทึกก่อน จึงจะตั้งค่านี้ได้', off);
        // With the feature off nobody can create at all, and the row already says why.
        assert.equal(row.uploadOffNote, null, off);
      }
    }
  });

  // A state word next to the switch says what the shop sees. With the manual-expense feature saved off,
  // or the company closed, the shop sees no menu whatever is stored, so the row must not say "แสดง".
  it('says the menu is shown only while the shop can see it', () => {
    assert.equal(manualWebEntryRow(enabledState(), setting(true)).shown, true);
    assert.equal(manualWebEntryRow(enabledState(), setting(false)).shown, false);
    for (const off of ['expenses.manual', 'expenses']) {
      assert.equal(manualWebEntryRow(enabledState(off), setting(true)).shown, false, off);
    }
    assert.equal(manualWebEntryRow(enabledState(), setting(true), true).shown, false, 'disabled or archived company');
  });

  it('can be pressed only while the company is open and the manual-expense feature is saved on', () => {
    assert.equal(manualWebEntryRow(enabledState(), setting(true)).editable, true);
    assert.equal(manualWebEntryRow([], setting(false)).editable, true, 'a shop without entitlement rows');
    assert.equal(manualWebEntryRow(enabledState('expenses.manual'), setting(true)).editable, false);
    assert.equal(manualWebEntryRow(enabledState(), setting(false), true).editable, false);
  });

  it('asks before hiding only, and never before showing', () => {
    assert.deepEqual(manualWebEntryRow(enabledState(), setting(false)).confirmLines(true), []);
    assert.deepEqual(manualWebEntryRow(enabledState('expenses.upload'), setting(false)).confirmLines(true), []);
    assert.deepEqual(manualWebEntryRow(enabledState(), setting(true)).confirmLines(false), [
      'ซ่อนเมนูบันทึกด้วยมือของร้านนี้ใช่ไหม พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน',
    ]);
  });

  it('adds the receipt-upload warning to the confirmation when the shop has upload off', () => {
    assert.deepEqual(manualWebEntryRow(enabledState('expenses.upload'), setting(true)).confirmLines(false), [
      'ซ่อนเมนูบันทึกด้วยมือของร้านนี้ใช่ไหม พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน',
      'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ ถ้าซ่อนเมนูนี้ด้วย พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจะไม่มีปุ่มสร้างรายจ่ายบนเว็บ',
    ]);
  });

  it('keeps a standing note while upload is off and the menu is not shown, whoever pressed nothing', () => {
    const note = 'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ และไม่ได้แสดงเมนูบันทึกด้วยมือ พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจึงไม่มีปุ่มสร้างรายจ่ายบนเว็บ';
    assert.equal(manualWebEntryRow(enabledState('expenses.upload'), setting(false)).uploadOffNote, note);
    // Shown, or upload on: staff have a create button, so there is nothing to note.
    assert.equal(manualWebEntryRow(enabledState('expenses.upload'), setting(true)).uploadOffNote, null);
    assert.equal(manualWebEntryRow(enabledState(), setting(false)).uploadOffNote, null);
  });

  it('reads the SAVED entitlements, never the pending ones the operator has not saved yet', () => {
    const saved = enabledState('expenses.manual');
    const pending = toggleSubmenu(saved, 'expenses.manual', true);
    assert.equal(entitlementEnabled(pending, 'expenses.manual'), true);
    // The page passes `entitlements` (the server rows): the row stays closed until the save.
    assert.equal(manualWebEntryRow(saved, setting(false)).parentOpen, false);
  });

  it('words the switch, its description and the result exactly as the spec does', () => {
    assert.deepEqual(MANUAL_WEB_ENTRY_COPY, {
      label: 'แสดงเมนูบันทึกด้วยมือบนเว็บ',
      description: 'ค่าเริ่มต้นของทุกร้านคือไม่แสดง เปิดเพื่อให้ร้านนี้เห็นเมนูและปุ่มที่พาไปหน้าบันทึกด้วยมือบนเว็บ การปิดไม่ได้ห้ามการบันทึกรายจ่ายด้วยมือ ใบรับรองแทนใบเสร็จ การพิมพ์ใน LINE และการแก้รายการเดิมยังใช้ได้ตามสิทธิ์และช่องทางที่ร้านมี',
      shown: 'แสดง',
      notShown: 'ไม่แสดง',
      confirmHideLabel: 'ซ่อนเมนู',
      cancelHideLabel: 'ยังไม่ซ่อน',
      savedShown: 'แสดงเมนูบันทึกด้วยมือแล้ว',
      savedHidden: 'ซ่อนเมนูบันทึกด้วยมือแล้ว',
    });
    // The 409 text lives with the other API codes, one place for the page and for any other caller.
    assert.equal(translateApiError('manual_expense_web_entry_version_conflict'), 'ค่านี้ถูกเปลี่ยนไปแล้ว กรุณาตรวจค่าล่าสุดก่อนบันทึกอีกครั้ง');
    // No sentence speaks of a missing permission of the reader, a closed system, or "not yet".
    const all = [...Object.values(MANUAL_WEB_ENTRY_COPY), ...manualWebEntryRow(enabledState('expenses.upload'), setting(true)).confirmLines(false),
      manualWebEntryRow(enabledState('expenses.upload'), setting(false)).uploadOffNote, manualWebEntryRow(enabledState('expenses.manual'), setting(false)).parentOffMessage].join(' ');
    // …and none carries an English word or a code token; LINE is the product's own name.
    assert.doesNotMatch(all, /คุณไม่มีสิทธิ์|ระบบถูกปิด|ยังไม่แสดง|ยังไม่เปิดใช้|(?<![A-Za-z])(?!LINE(?![A-Za-z]))[A-Za-z]{2,}/);
  });
});

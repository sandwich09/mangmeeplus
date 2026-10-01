import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  FEATURE_CATALOG,
  FEATURE_PACKAGE_PRESETS,
  MENU_ENTITLEMENT_BINDINGS,
  SALES_DEAL_ALLOWED_FEATURE_KEYS,
  salesDealFeatureKeys,
} from '@watchdog-bms/contracts';
import { billingFeaturePlan } from '../../../billing/application/billing-feature-entitlements';
import { dealOffer, dealSnapshot } from '../../../billing/domain/deal-offer';
import { buildDealSnapshot } from '../../../sales-console/domain/sales-deal.logic';
import { loadEntitledFeatureKeys } from '../../application/entitlement.helper';
import { NORMALIZER_VERSION } from '../../application/normalize-entitlements';
import { filterPermissionsByEntitlement } from './feature-gate.logic';

const ALL_ENTITLEMENTS = new Set(ALL_FEATURE_ENTITLEMENT_KEYS);

function prismaWithEntitlements(rows: Array<{ featureKey: string; enabled: boolean }>) {
  return {
    client: {
      companyFeatureEntitlement: {
        findMany: async () => rows,
      },
    },
  } as any;
}

describe('MENU_ENTITLEMENT_BINDINGS', () => {
  it('contains unique, complete bindings that reference only registered entitlement keys', () => {
    const navKeys = MENU_ENTITLEMENT_BINDINGS.map((binding) => binding.navKey);
    assert.ok(navKeys.length > 0, 'at least one menu binding is required');
    assert.equal(new Set(navKeys).size, navKeys.length, 'navKey values must be unique');

    for (const binding of MENU_ENTITLEMENT_BINDINGS) {
      assert.ok(binding.navKey, 'navKey is required');
      assert.ok(binding.labelTh, `${binding.navKey}: labelTh is required`);
      assert.ok(binding.iconKey, `${binding.navKey}: iconKey is required`);
      assert.ok(binding.gatePermissions.length > 0, `${binding.navKey}: gatePermissions must not be empty`);
      assert.equal(
        new Set([...(binding.gatePermissions), ...(binding.retainedGatePermissions ?? [])]).size,
        binding.gatePermissions.length + (binding.retainedGatePermissions?.length ?? 0),
        `${binding.navKey}: ordinary and retained gates must not overlap`,
      );
      const foundation = binding.entitlementKeys.length === 0;
      assert.ok(
        foundation || binding.parentFeatureKey !== null,
        `${binding.navKey}: non-foundation bindings require a parent entitlement`,
      );
      if (binding.parentFeatureKey) {
        assert.ok(
          ALL_ENTITLEMENTS.has(binding.parentFeatureKey),
          `${binding.navKey}: unknown parent entitlement ${binding.parentFeatureKey}`,
        );
      }
      for (const entitlementKey of binding.entitlementKeys) {
        assert.ok(
          ALL_ENTITLEMENTS.has(entitlementKey),
          `${binding.navKey}: unknown entitlement ${entitlementKey}`,
        );
      }
    }
  });

  it('strips every gate permission when a sellable binding is disabled and restores its menu when re-enabled', () => {
    const sellableBindings = MENU_ENTITLEMENT_BINDINGS.filter(({ entitlementKeys }) => entitlementKeys.length > 0);
    assert.ok(sellableBindings.length > 0, 'at least one sellable binding is required');

    // Owner decision 2026-08-10 (runoff, launch matrix §6.3 r5): disabling reimbursement blocks
    // NEW claims only — its menu gates stay alive so in-flight approvals/payouts remain reachable.
    const RUNOFF_NAV_KEYS = new Set(['reimbursements']);

    for (const binding of sellableBindings) {
      const disabled = new Set(ALL_ENTITLEMENTS);
      for (const entitlementKey of binding.entitlementKeys) disabled.delete(entitlementKey);

      if (RUNOFF_NAV_KEYS.has(binding.navKey)) {
        assert.deepEqual(
          filterPermissionsByEntitlement(binding.gatePermissions, disabled),
          binding.gatePermissions,
          `${binding.navKey}: runoff keeps its gate permissions while disabled`,
        );
      } else {
        assert.deepEqual(
          filterPermissionsByEntitlement(binding.gatePermissions, disabled),
          [],
          `${binding.navKey}: disabling its entitlements must remove every OR gate`,
        );
      }
      for (const entitlementKey of binding.entitlementKeys) disabled.add(entitlementKey);
      assert.ok(
        filterPermissionsByEntitlement(binding.gatePermissions, disabled).length > 0,
        `${binding.navKey}: re-enabling its entitlements must restore at least one gate`,
      );
    }
  });

  it('keeps at least one gate permission for foundation bindings when every entitlement is disabled', () => {
    const foundationBindings = MENU_ENTITLEMENT_BINDINGS.filter(({ entitlementKeys }) => entitlementKeys.length === 0);
    // Pinned: a foundation binding is one no company can ever switch off, so the list must stay
    // deliberate. นโยบายส่วนลด used to sit here on company.setup.read while its API required
    // crm.customer.read — visible on CRM-off companies, loadable on none of them.
    assert.deepEqual(foundationBindings.map(({ navKey }) => navKey), ['settings']);

    for (const binding of foundationBindings) {
      assert.ok(
        filterPermissionsByEntitlement(binding.gatePermissions, new Set()).length > 0,
        `${binding.navKey}: foundation menu must survive every entitlement being disabled`,
      );
    }
  });

  it('keeps only the explicit Reports history gate after the commercial entitlement is disabled', () => {
    const retainedBindings = MENU_ENTITLEMENT_BINDINGS.filter(
      ({ retainedGatePermissions }) => retainedGatePermissions?.length,
    );
    assert.deepEqual(retainedBindings.map(({ navKey }) => navKey), ['reports']);

    const reports = retainedBindings[0]!;
    const disabled = new Set(ALL_ENTITLEMENTS);
    for (const entitlementKey of reports.entitlementKeys) disabled.delete(entitlementKey);
    assert.deepEqual(
      filterPermissionsByEntitlement(reports.retainedGatePermissions ?? [], disabled),
      ['report.snapshot.read'],
    );
  });
});

describe('FEATURE_PACKAGE_PRESETS menu parity', () => {
  it('starter retains AI access while exposing seven navigation entries and contextual AI', async () => {
    const presetKeys = new Set(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
    const rows = ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
      featureKey,
      enabled: presetKeys.has(featureKey),
    }));
    const entitled = await loadEntitledFeatureKeys(prismaWithEntitlements(rows), 'company-1');

    assert.ok(entitled);
    assert.deepEqual(
      MENU_ENTITLEMENT_BINDINGS
        .filter((binding) => binding.navigation !== 'contextual')
        .filter((binding) => binding.entitlementKeys.length === 0 || (
          binding.parentFeatureKey !== null
          && entitled.has(binding.parentFeatureKey)
          && binding.entitlementKeys.some((key) => entitled.has(key))
        ))
        .map((binding) => binding.navKey),
      // `counterparties` joins starter because starter has `expenses`, and expense capture writes
      // into the counterparty registry by itself. Without the menu the "ดู" link on the
      // "เพิ่มร้านนี้ลงทะเบียนแล้ว" toast would lead nowhere and a wrong auto-saved address would
      // have no screen to correct it on.
      ['dashboard', 'expenses', 'counterparties', 'reimbursements', 'roles', 'settings', 'notifications'],
    );
    // ...and the screen must be able to correct it, not just show it (owner 2026-09-25).
    assert.deepEqual(
      filterPermissionsByEntitlement(['accounting.counterparty.read', 'accounting.counterparty.manage'], entitled),
      ['accounting.counterparty.read', 'accounting.counterparty.manage'],
    );
    assert.ok(entitled.has('ai_line_assistant'));
    assert.deepEqual(filterPermissionsByEntitlement(['ai.suggestion.read', 'crm.ai.read'], entitled), ['ai.suggestion.read', 'crm.ai.read']);
  });

  for (const [presetKey, preset] of Object.entries(FEATURE_PACKAGE_PRESETS)) {
    it(`${presetKey} keeps package cards aligned with permission-gated menus`, async () => {
      const presetKeys = new Set(preset.featureKeys);
      const rows = ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
        featureKey,
        enabled: featureKey !== 'expense_auto_post' && presetKeys.has(featureKey),
      }));
      const entitled = await loadEntitledFeatureKeys(prismaWithEntitlements(rows), 'company-1');
      assert.ok(entitled, `${presetKey}: applying a preset must materialize entitlement rows`);

      for (const binding of MENU_ENTITLEMENT_BINDINGS) {
        // Annotated because `prismaWithEntitlements` is `any`: without it `entitled` infers as
        // any and tsc reports TS7022 on both locals.
        const cardEnabled: boolean = binding.entitlementKeys.length === 0 || (
          binding.parentFeatureKey !== null
          && entitled.has(binding.parentFeatureKey)
          && binding.entitlementKeys.some((key) => entitled.has(key))
        );
        const menuVisible: boolean = filterPermissionsByEntitlement(
          binding.gatePermissions,
          entitled,
        ).length > 0;
        assert.equal(
          cardEnabled,
          menuVisible,
          `${presetKey}/${binding.navKey}: card=${cardEnabled} menu=${menuVisible}`,
        );
      }
    });
  }
});

// B3. Paying a package writes every catalog key that is not in its menu list as OFF. A deal built
// one menu at a time carried the parent key alone, so the shop paid and lost every submenu of it.
describe('a sales deal that names a parent menu without its submenus (B3)', () => {
  const EXPENSE_KEYS = ALL_FEATURE_ENTITLEMENT_KEYS.filter((key) => key === 'expenses' || key.startsWith('expenses.'));
  // What the deal builder sent after "ล้างทั้งหมด" and two taps, and what an older deal has stored.
  const draft = {
    base: 'STARTER_249', priceSatang: 249_000, months: 12, branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 100,
    featureKeys: ['expenses', 'dashboard_notifications'], aiMonthlyBudgetSatang: null, description: 'ข้อเสนอสำหรับร้านเปิดใหม่',
  };

  /** A shop on the complete catalog with the starter menus on: the state a paying shop is in. */
  function starterShop() {
    const starter = new Set<string>(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
    const rows = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort().map((featureKey) => (
      { featureKey, enabled: starter.has(featureKey), epoch: 0, lastSeq: 0, grantOrigin: null }));
    return {
      companyFeatureEntitlement: { findMany: async () => rows.map((row) => ({ ...row })) },
      companyEntitlementSet: { findUnique: async () => ({ setVersion: 0 }) },
      companyEntitlementNormalization: { findUnique: async () => ({ status: 'COMPLETED', normalizerVersion: NORMALIZER_VERSION, cohortKind: 'EXPLICIT' }) },
      entitlementTransition: { findMany: async () => [], count: async () => 0 },
    } as unknown as Parameters<typeof billingFeaturePlan>[0];
  }

  it('means every submenu for every parent menu, and exactly the named ones when some are named', () => {
    const parents = FEATURE_CATALOG.filter((feature) => feature.submenus.length > 0);
    assert.ok(parents.length >= 5, 'expected the catalog parents that carry submenus');
    for (const feature of parents) {
      const submenus = feature.submenus.map((submenu) => submenu.key);
      assert.deepEqual(salesDealFeatureKeys([feature.key], ALL_FEATURE_ENTITLEMENT_KEYS), [feature.key, ...submenus], feature.key);
      assert.deepEqual(salesDealFeatureKeys([feature.key, submenus[0]!], ALL_FEATURE_ENTITLEMENT_KEYS), [feature.key, submenus[0]!], feature.key);
      // A deal implies only what a deal may sell, so the list it saves can be saved again.
      assert.deepEqual(salesDealFeatureKeys([feature.key]),
        [feature.key, ...submenus.filter((key) => SALES_DEAL_ALLOWED_FEATURE_KEYS.includes(key))], feature.key);
    }
    // The preset every deal starts from is already complete, so the rule leaves it exactly as it is.
    assert.deepEqual(salesDealFeatureKeys(FEATURE_PACKAGE_PRESETS.starter.featureKeys), [...FEATURE_PACKAGE_PRESETS.starter.featureKeys]);
  });

  it('is saved with the submenus, and a list that names some submenus is saved as sent', () => {
    assert.deepEqual(buildDealSnapshot(draft).featureKeys,
      ['expenses', 'dashboard_notifications', ...EXPENSE_KEYS.filter((key) => key !== 'expenses')]);
    assert.deepEqual(buildDealSnapshot({ ...draft, featureKeys: ['expenses', 'expenses.upload'] }).featureKeys, ['expenses', 'expenses.upload']);
  });

  it('pays into working expense menus even when the deal was stored before the rule existed', async () => {
    // The row as an earlier release wrote it: the parent alone. Billing reads it through dealSnapshot.
    const deal = dealSnapshot({ ...draft, version: 4, autoRenew: false, cadence: null, cycles: null });
    assert.deepEqual(dealOffer(deal).featureKeys, deal.featureKeys, 'the offer card and the plan must name the same menus');

    const { plan, impact } = await billingFeaturePlan(starterShop(), 'company', deal.featureKeys);
    const on = new Set(plan.rows.filter((row) => row.enabled).map((row) => row.featureKey));
    assert.deepEqual(EXPENSE_KEYS.filter((key) => !on.has(key)), [], 'paying the deal must not switch an expense submenu off');
    // The checkout page lists `impact.removed` as the menus that will stop.
    assert.deepEqual(impact.removed.map((item) => item.featureKey).filter((key) => key.startsWith('expenses')), []);
    assert.ok(impact.removed.some((item) => item.featureKey === 'reimbursement'), 'a menu the deal really leaves out is still listed');
  });
});

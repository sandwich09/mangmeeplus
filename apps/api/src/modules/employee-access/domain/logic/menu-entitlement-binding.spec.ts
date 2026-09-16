import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  FEATURE_PACKAGE_PRESETS,
  MENU_ENTITLEMENT_BINDINGS,
} from '@watchdog-bms/contracts';
import { loadEntitledFeatureKeys } from '../../application/entitlement.helper';
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
  it('starter retains AI access while exposing six navigation entries and contextual AI', async () => {
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
      ['dashboard', 'expenses', 'reimbursements', 'roles', 'settings', 'notifications'],
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

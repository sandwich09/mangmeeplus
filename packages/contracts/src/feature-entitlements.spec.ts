import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  DEFAULT_ON_FEATURE_KEYS,
  FEATURE_CATALOG,
  FEATURE_DEPENDENCIES,
  FEATURE_KEYS,
  PLATFORM_INVARIANT_FEATURE_KEYS,
  dependentFeatureKeys,
  requiredFeatureKeys,
  unmetFeatureDependencies,
} from './feature-entitlements.js';

const onlyThese = (...on: string[]) => (key: string) => on.includes(key);

describe('feature catalog shape (spec §6.1)', () => {
  it('freezes 18 top-level keys, 16 of them sellable', () => {
    assert.equal(FEATURE_KEYS.length, 18);
    assert.equal(FEATURE_CATALOG.filter((feature) => feature.sellable).length, 16);
    assert.deepEqual(
      FEATURE_CATALOG.filter((feature) => !feature.sellable).map((feature) => feature.key).sort(),
      ['company_settings', 'employee_access'],
    );
  });

  it('marks exactly the platform-invariant keys non-sellable', () => {
    for (const key of PLATFORM_INVARIANT_FEATURE_KEYS) {
      const feature = FEATURE_CATALOG.find((candidate) => candidate.key === key);
      assert.ok(feature, `${key} must exist in the catalog`);
      assert.equal(feature.sellable, false);
    }
    // One list, two readings — they must never drift apart.
    assert.deepEqual([...DEFAULT_ON_FEATURE_KEYS], [...PLATFORM_INVARIANT_FEATURE_KEYS]);
  });
});

describe('FEATURE_DEPENDENCIES (spec:264)', () => {
  it('declares exactly one top-level dependency plus the two structural procurement children', () => {
    assert.deepEqual(Object.keys(FEATURE_DEPENDENCIES).sort(), [
      'expense_auto_post',
      'procurement.ap_aging',
      'procurement.supplier_payments',
    ]);
    assert.deepEqual(requiredFeatureKeys('expense_auto_post'), ['double_entry_ledger']);
    assert.deepEqual(requiredFeatureKeys('procurement.ap_aging'), ['procurement.vendor_bills']);
    assert.deepEqual(requiredFeatureKeys('procurement.supplier_payments'), ['procurement.vendor_bills']);
    assert.deepEqual(requiredFeatureKeys('crm'), []);
  });

  it('contains no reimbursement ⇒ expenses and no thai_tax ⇒ double_entry_ledger', () => {
    assert.deepEqual(requiredFeatureKeys('reimbursement'), []);
    assert.deepEqual(requiredFeatureKeys('thai_tax'), []);
  });

  it('references only keys that exist in the catalog', () => {
    const known = new Set(ALL_FEATURE_ENTITLEMENT_KEYS);
    for (const [child, parents] of Object.entries(FEATURE_DEPENDENCIES)) {
      assert.ok(known.has(child), `${child} is not a catalog key`);
      for (const parent of parents) assert.ok(known.has(parent), `${parent} is not a catalog key`);
    }
  });

  it('never makes a platform-invariant key a prerequisite or a dependent', () => {
    for (const key of PLATFORM_INVARIANT_FEATURE_KEYS) {
      assert.deepEqual(requiredFeatureKeys(key), []);
      assert.deepEqual(dependentFeatureKeys(key), []);
    }
  });

  it('has no dependency cycle', () => {
    for (const child of Object.keys(FEATURE_DEPENDENCIES)) {
      const seen = new Set<string>();
      const stack = [...requiredFeatureKeys(child)];
      while (stack.length > 0) {
        const next = stack.pop()!;
        assert.notEqual(next, child, `${child} depends on itself`);
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(...requiredFeatureKeys(next));
      }
    }
  });

  it('lists dependents for a cascade preview in canonical order', () => {
    assert.deepEqual(dependentFeatureKeys('double_entry_ledger'), ['expense_auto_post']);
    assert.deepEqual(dependentFeatureKeys('procurement.vendor_bills'), [
      'procurement.ap_aging',
      'procurement.supplier_payments',
    ]);
    assert.deepEqual(dependentFeatureKeys('crm'), []);
  });
});

describe('unmetFeatureDependencies — both directions', () => {
  it('flags a child enabled without its prerequisite', () => {
    assert.deepEqual(unmetFeatureDependencies(onlyThese('expense_auto_post')), [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
    ]);
  });

  it('flags the same pair when the parent is being turned off under an active child', () => {
    // Direction B is the identical predicate over the proposed FINAL set.
    const finalSet = onlyThese('expense_auto_post', 'expenses');
    assert.deepEqual(unmetFeatureDependencies(finalSet), [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
    ]);
  });

  it('accepts a consistent set and an all-off set', () => {
    assert.deepEqual(unmetFeatureDependencies(onlyThese('expense_auto_post', 'double_entry_ledger')), []);
    assert.deepEqual(unmetFeatureDependencies(() => false), []);
  });

  it('reports every violation, sorted, not just the first', () => {
    assert.deepEqual(
      unmetFeatureDependencies(onlyThese('expense_auto_post', 'procurement.supplier_payments', 'procurement.ap_aging')),
      [
        { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
        { featureKey: 'procurement.ap_aging', requiresFeatureKey: 'procurement.vendor_bills' },
        { featureKey: 'procurement.supplier_payments', requiresFeatureKey: 'procurement.vendor_bills' },
      ],
    );
  });
});

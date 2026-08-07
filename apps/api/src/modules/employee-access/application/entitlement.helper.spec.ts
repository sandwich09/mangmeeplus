import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FEATURE_NOT_ENABLED,
  FEATURE_TEMPORARILY_UNAVAILABLE,
  assertFeatureEnabled,
  featureTemporarilyUnavailable,
  loadEntitledFeatureKeys,
} from './entitlement.helper';

function prismaWith(rows: Array<{ featureKey: string; enabled: boolean }>): any {
  return { client: { companyFeatureEntitlement: { findMany: async () => rows } } };
}

describe('assertFeatureEnabled — error contract (spec:333)', () => {
  it('passes when the feature is entitled', () => {
    assert.doesNotThrow(() => assertFeatureEnabled(new Set(['crm']), 'crm'));
  });

  it('passes on the legacy fail-open sentinel', () => {
    assert.doesNotThrow(() => assertFeatureEnabled(null, 'crm'));
  });

  it('throws 403 feature_not_enabled with the featureKey — never a 400', () => {
    let thrown: unknown;
    try {
      assertFeatureEnabled(new Set(['crm']), 'thai_tax');
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof ForbiddenException);
    assert.ok(!(thrown instanceof BadRequestException));
    const response = (thrown as ForbiddenException).getResponse() as Record<string, unknown>;
    assert.equal((thrown as ForbiddenException).getStatus(), 403);
    assert.notEqual((thrown as ForbiddenException).getStatus(), 400);
    assert.equal(response.code, 'feature_not_enabled');
    assert.equal(response.featureKey, 'thai_tax');
  });

  it('throws for an empty entitlement set — empty is not the fail-open sentinel', () => {
    assert.throws(() => assertFeatureEnabled(new Set<string>(), 'crm'), ForbiddenException);
  });
});

describe('featureTemporarilyUnavailable — DISTINCT purchased-but-closed state (spec:65)', () => {
  it('is 403 with its own code, never reusing feature_not_enabled', () => {
    const error = featureTemporarilyUnavailable('thai_tax');
    assert.ok(error instanceof ForbiddenException);
    assert.equal(error.getStatus(), 403);
    const response = error.getResponse() as Record<string, unknown>;
    assert.equal(response.code, 'feature_temporarily_unavailable');
    assert.equal(response.featureKey, 'thai_tax');
    assert.notEqual(FEATURE_TEMPORARILY_UNAVAILABLE, FEATURE_NOT_ENABLED);
  });
});

describe('loadEntitledFeatureKeys — platform invariants (spec:262)', () => {
  it('keeps the legacy fail-open null for a company with no rows at all', async () => {
    assert.equal(await loadEntitledFeatureKeys(prismaWith([]), 'co-1'), null);
  });

  it('keeps the platform baseline on when its row is absent', async () => {
    const entitled = await loadEntitledFeatureKeys(prismaWith([{ featureKey: 'crm', enabled: true }]), 'co-1');
    assert.ok(entitled);
    assert.equal(entitled.has('employee_access'), true);
    assert.equal(entitled.has('company_settings'), true);
  });

  // Residual documented in the helper: a legacy explicit false still wins at read time, and only
  // CC7/F2 normalization may clear it. The write path (SetPartnerFeaturesUseCase) is what stops a
  // NEW one from being created.
  it('still honours a pre-existing explicit false on a platform key at read time', async () => {
    const entitled = await loadEntitledFeatureKeys(prismaWith([
      { featureKey: 'crm', enabled: true },
      { featureKey: 'company_settings', enabled: false },
    ]), 'co-1');
    assert.ok(entitled);
    assert.equal(entitled.has('company_settings'), false);
  });

  it('still honours an explicit false on a sellable feature', async () => {
    const entitled = await loadEntitledFeatureKeys(prismaWith([
      { featureKey: 'crm', enabled: true },
      { featureKey: 'thai_tax', enabled: false },
    ]), 'co-1');
    assert.ok(entitled);
    assert.equal(entitled.has('thai_tax'), false);
    assert.equal(entitled.has('crm'), true);
  });

  it('auto-enables submenus with their parent and still allows an explicit submenu false', async () => {
    const entitled = await loadEntitledFeatureKeys(prismaWith([
      { featureKey: 'expenses', enabled: true },
      { featureKey: 'expenses.categories', enabled: false },
    ]), 'co-1');
    assert.ok(entitled);
    assert.equal(entitled.has('expenses.list'), true);
    assert.equal(entitled.has('expenses.categories'), false);
  });
});

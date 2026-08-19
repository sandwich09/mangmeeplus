import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentIntentPlan, LineUserContext } from '@watchdog-bms/contracts';
import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import { normalizePlanToolAccess, toolAccessOutcome } from './tool-availability';

function user(overrides: Partial<LineUserContext> = {}): LineUserContext {
  return {
    lineUserId: '[REDACTED]', internalUserId: 'u1', companyId: 'c1', membershipId: 'm1',
    permissions: [], roles: ['OWNER'], locale: 'th-TH', ...overrides,
  };
}

function plan(tools: string[]): AgentIntentPlan {
  return {
    status: 'ROUTABLE', language: 'th', refusals: [], requiresHumanReview: false,
    intents: [{ intent: 'read_summary', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: tools, missingContext: [] }],
  };
}

function tool(name: string) {
  return LINE_TOOL_REGISTRY.find((entry) => entry.name === name)!;
}

describe('LINE AI server-derived tool availability', () => {
  it('keeps product catalog separate from inventory stock', () => {
    const ctx = user({ permissions: ['inventory.product.read', 'inventory.report.read'], entitledFeatureKeys: ['product_catalog'] });
    assert.equal(toolAccessOutcome(tool('inventory.search_products'), ctx), 'allowed');
    assert.equal(toolAccessOutcome(tool('inventory.list_low_stock'), ctx), 'feature_disabled');
  });

  it('detects cross-feature tools even when their shared permission still passes', () => {
    const ctx = user({ permissions: ['crm.report.read'], entitledFeatureKeys: ['crm', 'crm.overview'] });
    assert.equal(toolAccessOutcome(tool('sales.get_sales_summary'), ctx), 'feature_disabled');
  });

  it('distinguishes a permission stripped by entitlement from a genuine role gap', () => {
    const disabled = user({ entitlementDeniedPermissions: {
      'inventory.product.read': 'inventory', 'inventory.report.read': 'inventory',
    }, entitledFeatureKeys: [] });
    assert.equal(toolAccessOutcome(tool('inventory.list_low_stock'), disabled), 'feature_disabled');
    assert.equal(toolAccessOutcome(tool('inventory.list_low_stock'), user({ entitledFeatureKeys: ['inventory'] })), 'forbidden');
  });

  it('removes blocked tools before every executor and preserves an answerable clause as PARTIAL', () => {
    const input = plan(['inventory.search_products', 'inventory.list_low_stock']);
    const result = normalizePlanToolAccess(input, 'มีสินค้า A ไหม และของอะไรใกล้หมด', user({
      permissions: ['inventory.product.read', 'inventory.report.read'],
      entitledFeatureKeys: ['product_catalog'],
    }));
    assert.equal(result.plan.status, 'PARTIAL');
    assert.deepEqual(result.plan.intents[0]?.requiredTools, ['inventory.search_products']);
    assert.deepEqual(result.featureDisabledTools, ['inventory.list_low_stock']);
    assert.equal(result.plan.refusals[0]?.reason, 'feature_disabled');
  });

  it('preserves legacy fail-open feature behavior while still enforcing permissions', () => {
    assert.equal(toolAccessOutcome(tool('inventory.list_low_stock'), user({
      permissions: ['inventory.product.read', 'inventory.report.read'], entitledFeatureKeys: null,
    })), 'allowed');
  });
});

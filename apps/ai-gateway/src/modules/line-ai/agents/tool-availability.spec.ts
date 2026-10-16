import { scopePolicyOverride } from '../domain/logic/line-ai-scope-policy.logic';
import { TIER_FEATURE_PRESETS, hasToolFeature } from '@watchdog-bms/contracts';
import { featureDisabledReply } from './response-composer.agent';
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


describe('round 5A sold-pack WHT gating', () => {
  it('allows enterprise WHT reads, politely refuses starter, and keeps full tax closed', () => {
    const permissions = ['wht.certificate.read', 'wht.pnd53.read', 'expense.create', 'tax.period.read', 'tax.event.read'];
    for (const name of ['wht.get_month_summary', 'wht.calculate_withholding']) {
      assert.equal(toolAccessOutcome(tool(name), user({ permissions, entitledFeatureKeys: [...TIER_FEATURE_PRESETS.ENTERPRISE_1999] })), 'allowed');
      assert.equal(toolAccessOutcome(tool(name), user({ permissions, entitledFeatureKeys: [...TIER_FEATURE_PRESETS.STARTER_249] })), 'feature_disabled');
      assert.match(featureDisabledReply([name], 'th'), /^แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่องนี้ค่ะ.*อยู่ในแพ็กธุรกิจค่ะ$/);
    }
    for (const name of ['tax.get_wht_summary', 'tax.get_vat_summary', 'tax.get_cit_calendar', 'tax.get_transaction_tax_summary']) {
      assert.equal(hasToolFeature(tool(name), new Set(TIER_FEATURE_PRESETS.ENTERPRISE_1999)), false, name);
    }
    assert.equal(toolAccessOutcome(tool('wht.get_month_summary'), user({ permissions: [], entitledFeatureKeys: ['wht_50bis'] })), 'forbidden');
  });
});

describe('round 5A sold withholding scope', () => {
  it('lets definitions use general knowledge while retaining package limits on WHT operations', () => {
    for (const kind of ['read', 'help', 'general'] as const) for (const text of ['50 ทวิ คืออะไร', 'ภงด.53 ต้องยื่นเมื่อไหร่', 'หัก ณ ที่จ่ายคิดยังไง']) {
      const result = scopePolicyOverride(text, kind, [], ['expenses'], 'th');
      if (kind === 'general' || text === '50 ทวิ คืออะไร') { assert.equal(result, undefined); continue; }
      assert.equal(result?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED'); assert.match(result!.text, /^แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่องนี้ค่ะ.*แพ็กธุรกิจค่ะ$/);
    }
  });
  it('leaves sold WHT reads to tool permission checks without opening unrelated modules', () => {
    assert.equal(scopePolicyOverride('50 ทวิจากรายได้เท่าไหร่', 'read', ['wht.certificate.read'], ['wht_50bis'], 'th'), undefined);
    assert.equal(scopePolicyOverride('ภงด.53 เดือนนี้', 'read', ['wht.pnd53.read'], ['wht_pnd53'], 'th'), undefined);
    assert.equal(scopePolicyOverride('ต้องหักเท่าไหร่', 'read', [], ['expenses'], 'th', 'wht.calculate_withholding')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
  });
});
